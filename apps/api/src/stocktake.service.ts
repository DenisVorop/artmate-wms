import {
  Injectable,
  Inject,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { WarehouseService } from "./warehouse.service";
import { Queryable } from "./database";
import { requireAuth } from "./auth-policy";
import {
  stocktakeRow,
  rowIsStale,
  stocktakePlan,
  locationMatches,
} from "./stocktake-plan";
import { cellVersions, cellBusyReasons } from "./stocktake-versions";
import * as D from "./dto";
type Document = D.StocktakeSummaryDto & {
  finalPreview?: D.StocktakePreviewDto;
};
type Account = Awaited<ReturnType<typeof requireAuth>>;
const active = (d: Document) => !["approved", "cancelled"].includes(d.status);
@Injectable()
export class StocktakeService {
  constructor(
    @Inject(WarehouseService) private readonly warehouse: WarehouseService,
  ) {}
  private async _load(tx: Queryable, id: string) {
    const result = await tx.query<{ payload: Document }>(
      "SELECT payload FROM stocktakes WHERE id=$1",
      [id],
    );
    if (!result.rows[0])
      throw new NotFoundException("Документ инвентаризации не найден");
    const rows = await tx.query<{ payload: D.StocktakeRowSnapshotDto }>(
      "SELECT payload FROM stocktake_rows WHERE document_id=$1 ORDER BY location_id",
      [id],
    );
    const history = await tx.query<{ payload: D.StocktakeHistoryDto }>(
      "SELECT payload FROM stocktake_history WHERE document_id=$1 ORDER BY payload->>'createdAt',id",
      [id],
    );
    return {
      doc: result.rows[0].payload,
      rows: rows.rows.map((r) => r.payload),
      history: history.rows.map((r) => r.payload),
    };
  }
  private _visible(a: Account, d: Document) {
    return (
      a.role === "manager" ||
      d.employeeId === a.employee_id ||
      (d.status === "queued" && d.employeeId === null)
    );
  }
  private _owner(a: Account, d: Document) {
    if (d.employeeId !== a.employee_id)
      throw new ForbiddenException(
        "Подсчёт может выполнять только взявший документ сотрудник",
      );
  }
  private _working(a: Account, s: D.WorkspaceDto) {
    if (s.employees.find((e) => e.id === a.employee_id)?.status !== "working")
      throw new ForbiddenException(
        "Для этого действия начните свою смену и завершите перерыв",
      );
  }
  private _manager(a: Account) {
    if (a.role !== "manager")
      throw new ForbiddenException("Нужны права руководителя");
  }
  private async _render(
    tx: Queryable,
    id: string,
    s: D.WorkspaceDto,
    a: Account,
  ): Promise<D.StocktakeDto> {
    const { doc, rows, history } = await this._load(tx, id);
    if (!this._visible(a, doc))
      throw new ForbiddenException("Документ принадлежит другому сотруднику");
    const versions = await cellVersions(tx),
      isActive = active(doc),
      own = doc.employeeId === a.employee_id,
      working =
        s.employees.find((e) => e.id === a.employee_id)?.status === "working";
    const viewRows = rows.map((r) => ({
      ...r,
      currentVersion: isActive
        ? (versions.get(r.locationId) ?? 0)
        : (r.countVersion ?? r.baselineVersion),
      stale: isActive && rowIsStale(r, versions.get(r.locationId) ?? 0),
      busyReasons: isActive ? cellBusyReasons(s, r.locationId) : [],
    }));
    const preview =
      doc.finalPreview ??
      stocktakePlan(s, rows, versions, doc.revision).preview;
    const { finalPreview, ...stored } = doc;
    return {
      ...stored,
      locationsTotal: rows.length,
      locationsCounted: rows.filter((r) => r.count !== null).length,
      staleLocations: viewRows.filter((r) => r.stale).length,
      rows: viewRows,
      history,
      preview: {
        ...preview,
        canApprove: preview.canApprove && doc.status === "review",
      },
      canClaim: doc.status === "queued" && working,
      canCount: own && working && ["counting", "review"].includes(doc.status),
      canSubmit:
        own &&
        working &&
        doc.status === "counting" &&
        rows.every((r) => r.count !== null) &&
        viewRows.every((r) => !r.stale),
      canRefresh: isActive && (a.role === "manager" || (own && working)),
      canApprove:
        a.role === "manager" &&
        working &&
        doc.status === "review" &&
        preview.canApprove,
      canCancel: a.role === "manager" && isActive,
    };
  }
  async getStocktakes(q: D.StocktakeListQueryDto): Promise<D.StocktakeListDto> {
    return this.warehouse.authTransaction(async (tx) => {
      const a = await requireAuth(tx),
        s = await this.warehouse.stocktakeState(tx),
        all = await tx.query<{ payload: Document }>(
          "SELECT payload FROM stocktakes ORDER BY payload->>'createdAt' DESC,id DESC",
        );
      const docs = all.rows
          .map((r) => r.payload)
          .filter((d) => this._visible(a, d))
          .filter((d) => !q.bucket || (q.bucket === "active") === active(d))
          .filter((d) => !q.status || d.status === q.status),
        page = q.page ?? 1,
        pageSize = q.pageSize ?? 25;
      const items = [] as D.StocktakeSummaryDto[];
      for (const d of docs.slice((page - 1) * pageSize, page * pageSize)) {
        const v = await this._render(tx, d.id, s, a);
        const {
          rows,
          history,
          preview,
          canClaim,
          canCount,
          canSubmit,
          canRefresh,
          canApprove,
          canCancel,
          finalPreview,
          ...summary
        } = v as D.StocktakeDto & { finalPreview?: D.StocktakePreviewDto };
        items.push(summary);
      }
      return { items, total: docs.length, page, pageSize };
    });
  }
  async getStocktake(id: string) {
    return this.warehouse.authTransaction(async (tx) => {
      const a = await requireAuth(tx);
      return this._render(tx, id, await this.warehouse.stocktakeState(tx), a);
    });
  }
  async getStocktakePreview(id: string) {
    return (await this.getStocktake(id)).preview;
  }
  private async _command(
    operation: string,
    id: string | null,
    b: D.CommandDto,
    mutate: (
      tx: Queryable,
      a: Account,
      s: D.WorkspaceDto,
      data: Awaited<ReturnType<StocktakeService["_load"]>> | null,
    ) => Promise<string>,
  ) {
    return this.warehouse.authTransaction(async (tx) => {
      const op = operation.split("/")[0];
      const a = await requireAuth(tx, true),
        s = await this.warehouse.stocktakeState(tx),
        data = id ? await this._load(tx, id) : null;
      if (
        ["createStocktake", "approveStocktake", "cancelStocktake"].includes(op)
      )
        this._manager(a);
      if (data && !this._visible(a, data.doc))
        throw new ForbiddenException("Документ принадлежит другому сотруднику");
      // Authorization is deliberately before replay; status/revision validation is after it.
      if (data && ["countStocktakeLocation", "submitStocktake"].includes(op)) {
        this._owner(a, data.doc);
        this._working(a, s);
      }
      if (op === "claimStocktake" || op === "approveStocktake")
        this._working(a, s);
      if (data && op === "refreshStocktakeLocation" && a.role !== "manager") {
        this._owner(a, data.doc);
        this._working(a, s);
      }
      if (
        (
          await tx.query(
            "SELECT request_id FROM commands WHERE request_id=$1 UNION ALL SELECT request_id FROM box_label_commands WHERE request_id=$1",
            [b.requestId],
          )
        ).rows.length
      )
        throw new ConflictException(
          "Этот requestId уже использован для другой операции",
        );
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify([
            operation,
            id,
            b,
            { accountId: a.id, employeeId: a.employee_id },
          ]),
        )
        .digest("hex");
      const cached = await tx.query<{
        fingerprint: string;
        response: D.StocktakeDto;
      }>(
        "SELECT fingerprint,response FROM stocktake_commands WHERE request_id=$1",
        [b.requestId],
      );
      if (cached.rows[0]) {
        if (cached.rows[0].fingerprint !== fingerprint)
          throw new ConflictException(
            "Этот requestId уже использован для другой операции",
          );
        return cached.rows[0].response;
      }
      if (data) {
        if (!active(data.doc))
          throw new ConflictException("Документ уже завершён");
        if (data.doc.revision !== (b as D.StocktakeCommandDto).expectedRevision)
          throw new ConflictException(
            "Документ изменился. Обновите данные перед продолжением",
          );
      }
      const resultId = await mutate(tx, a, s, data),
        response = await this._render(tx, resultId, s, a);
      await tx.query(
        "INSERT INTO stocktake_commands(request_id,fingerprint,response) VALUES($1,$2,$3)",
        [b.requestId, fingerprint, JSON.stringify(response)],
      );
      return response;
    });
  }
  private async _save(
    tx: Queryable,
    d: Document,
    rows: D.StocktakeRowSnapshotDto[],
  ) {
    await tx.query(
      "INSERT INTO stocktakes(id,payload) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload",
      [d.id, JSON.stringify(d)],
    );
    for (const r of rows)
      await tx.query(
        "INSERT INTO stocktake_rows(document_id,location_id,payload) VALUES($1,$2,$3) ON CONFLICT(document_id,location_id) DO UPDATE SET payload=EXCLUDED.payload",
        [d.id, r.locationId, JSON.stringify(r)],
      );
  }
  private async _history(
    tx: Queryable,
    d: Document,
    a: Account,
    kind: D.StocktakeHistoryDto["kind"],
    message: string,
    row?: D.StocktakeRowSnapshotDto,
  ) {
    const h: D.StocktakeHistoryDto = {
      id: randomUUID(),
      kind,
      createdAt: new Date().toISOString(),
      actorEmployeeId: a.employee_id,
      actorName: a.name,
      locationId: row?.locationId ?? null,
      message,
      previousRow: row ? structuredClone(row) : null,
    };
    await tx.query(
      "INSERT INTO stocktake_history(id,document_id,payload) VALUES($1,$2,$3)",
      [h.id, d.id, JSON.stringify(h)],
    );
  }
  async createStocktake(b: D.CreateStocktakeDto) {
    return this._command("createStocktake", null, b, async (tx, a, s) => {
      if (new Set(b.locationIds).size !== b.locationIds.length)
        throw new BadRequestException("Адреса не должны повторяться");
      for (const id of b.locationIds) {
        const l = s.locations.find((l) => l.id === id);
        if (
          !l ||
          l.archived ||
          s.sections.find((x) => x.id === l.sectionId)?.archived ||
          !["rack", "floor"].includes(l.kind)
        )
          throw new BadRequestException(
            "Выберите действующие адреса хранения: стеллаж или пол",
          );
      }
      const versions = await cellVersions(tx),
        count = await tx.query<{ n: string }>(
          "SELECT COUNT(*) AS n FROM stocktakes",
        ),
        id = randomUUID();
      const d: Document = {
        id,
        code: `INV-${String(Number(count.rows[0].n) + 1).padStart(4, "0")}`,
        status: "queued",
        revision: 1,
        createdAt: new Date().toISOString(),
        createdByEmployeeId: a.employee_id,
        createdByName: a.name,
        employeeId: null,
        employeeName: null,
        approvedAt: null,
        cancelledAt: null,
        reason: null,
        locationsTotal: b.locationIds.length,
        locationsCounted: 0,
        staleLocations: 0,
      };
      await this._save(
        tx,
        d,
        b.locationIds.map((id) => stocktakeRow(s, id, versions.get(id) ?? 0)),
      );
      await this._history(tx, d, a, "created", "Документ создан");
      return id;
    });
  }
  async claimStocktake(id: string, b: D.StocktakeCommandDto) {
    return this._command("claimStocktake", id, b, async (tx, a, s, data) => {
      const { doc, rows } = data!;
      if (doc.status !== "queued" || doc.employeeId)
        throw new ConflictException("Документ уже взят в работу");
      if (
        s.movements.some(
          (m) => m.employeeId === a.employee_id && m.status === "in_transit",
        ) ||
        s.putawayTasks.some(
          (t) => t.employeeId === a.employee_id && t.status === "in_transit",
        )
      )
        throw new ConflictException(
          "Сначала подтвердите размещение товара в пути",
        );
      doc.status = "counting";
      doc.employeeId = a.employee_id;
      doc.employeeName = a.name;
      doc.revision++;
      await this._save(tx, doc, rows);
      await this._history(tx, doc, a, "claimed", "Документ взят в работу");
      return id;
    });
  }
  async countStocktakeLocation(
    id: string,
    locationId: string,
    b: D.CountStocktakeLocationDto,
  ) {
    return this._command(
      `countStocktakeLocation/${locationId}`,
      id,
      b,
      async (tx, a, s, data) => {
        const { doc, rows } = data!;
        if (!["counting", "review"].includes(doc.status))
          throw new ConflictException("Сначала возьмите документ в работу");
        const row = rows.find((r) => r.locationId === locationId);
        if (!row) throw new NotFoundException("Адрес не входит в документ");
        if (!locationMatches(s, locationId, b.locationCode))
          throw new BadRequestException("Отсканирован другой адрес");
        const versions = await cellVersions(tx);
        if (rowIsStale(row, versions.get(locationId) ?? 0))
          throw new ConflictException(
            "Адрес изменился. Обновите исходные данные ячейки и пересчитайте её",
          );
        await this._history(
          tx,
          doc,
          a,
          "counted",
          "Результат подсчёта сохранён",
          row,
        );
        row.count = {
          rawPallets: structuredClone(b.rawPallets),
          boxCodes: [...b.boxCodes],
        };
        row.countVersion = versions.get(locationId) ?? 0;
        row.countedAt = new Date().toISOString();
        row.countedByEmployeeId = a.employee_id;
        row.countedByName = a.name;
        doc.status = "counting";
        doc.revision++;
        await this._save(tx, doc, rows);
        return id;
      },
    );
  }
  async refreshStocktakeLocation(
    id: string,
    locationId: string,
    b: D.StocktakeCommandDto,
  ) {
    return this._command(
      `refreshStocktakeLocation/${locationId}`,
      id,
      b,
      async (tx, a, s, data) => {
        const { doc, rows } = data!,
          index = rows.findIndex((r) => r.locationId === locationId);
        if (index < 0)
          throw new NotFoundException("Адрес не входит в документ");
        await this._history(
          tx,
          doc,
          a,
          "refreshed",
          "Исходные данные обновлены, подсчёт сброшен",
          rows[index],
        );
        const versions = await cellVersions(tx);
        rows[index] = stocktakeRow(
          s,
          locationId,
          versions.get(locationId) ?? 0,
        );
        if (doc.status === "review") doc.status = "counting";
        doc.revision++;
        await this._save(tx, doc, rows);
        return id;
      },
    );
  }
  async submitStocktake(id: string, b: D.StocktakeCommandDto) {
    return this._command("submitStocktake", id, b, async (tx, a, s, data) => {
      const { doc, rows } = data!,
        versions = await cellVersions(tx);
      if (doc.status !== "counting")
        throw new ConflictException("Документ не находится на подсчёте");
      if (rows.some((r) => !r.count))
        throw new ConflictException("Пересчитайте все адреса");
      if (rows.some((r) => rowIsStale(r, versions.get(r.locationId) ?? 0)))
        throw new ConflictException(
          "Адрес изменился. Обновите исходные данные и пересчитайте его",
        );
      doc.status = "review";
      doc.revision++;
      await this._save(tx, doc, rows);
      await this._history(
        tx,
        doc,
        a,
        "submitted",
        "Документ передан на проверку",
      );
      return id;
    });
  }
  async approveStocktake(id: string, b: D.ReasonStocktakeDto) {
    return this._command("approveStocktake", id, b, async (tx, a, s, data) => {
      const { doc, rows } = data!;
      if (doc.status !== "review")
        throw new ConflictException("Сначала передайте документ на проверку");
      const plan = stocktakePlan(s, rows, await cellVersions(tx), doc.revision);
      if (!plan.state || !plan.preview.canApprove)
        throw new ConflictException(
          plan.preview.issues.map((i) => i.message).join("; "),
        );
      await this.warehouse.commitStocktake(tx, s, plan.state, b, doc);
      Object.assign(s, plan.state);
      doc.status = "approved";
      doc.approvedAt = new Date().toISOString();
      doc.reason = b.reason.trim();
      doc.revision++;
      doc.finalPreview = {
        ...plan.preview,
        revision: doc.revision,
        canApprove: false,
      };
      await this._save(tx, doc, rows);
      await this._history(tx, doc, a, "approved", `Утверждено: ${doc.reason}`);
      return id;
    });
  }
  async cancelStocktake(id: string, b: D.ReasonStocktakeDto) {
    return this._command("cancelStocktake", id, b, async (tx, a, s, data) => {
      const { doc, rows } = data!;
      doc.finalPreview = {
        ...stocktakePlan(s, rows, await cellVersions(tx), doc.revision + 1)
          .preview,
        canApprove: false,
      };
      doc.status = "cancelled";
      doc.cancelledAt = new Date().toISOString();
      doc.reason = b.reason.trim();
      doc.revision++;
      await this._save(tx, doc, rows);
      await this._history(tx, doc, a, "cancelled", `Отменено: ${doc.reason}`);
      return id;
    });
  }
}
