import {
  Injectable,
  Inject,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { WarehouseService } from "./warehouse.service";
import { Queryable } from "./database";
import { requireAuth } from "./auth-policy";
import * as D from "./dto";
@Injectable()
export class PalletLabelService {
  constructor(
    @Inject(WarehouseService) private readonly warehouse: WarehouseService,
  ) {}
  private async _manager(tx: Queryable, write = false) {
    const actor = await requireAuth(tx, write);
    if (actor.role !== "manager")
      throw new ForbiddenException("Нужны права руководителя");
    return actor;
  }
  private async _batch(
    tx: Queryable,
    id: string,
  ): Promise<D.PalletLabelBatchDto> {
    const result = await tx.query<{
      id: string;
      code: string;
      count: number;
      created_at: string | Date;
      assigned: string;
    }>(
      `SELECT b.id,b.code,b.count,b.created_at,COUNT(l.pallet_id) AS assigned FROM pallet_label_batches b LEFT JOIN preprinted_pallet_labels l ON l.batch_id=b.id WHERE b.id=$1 GROUP BY b.id`,
      [id],
    );
    const b = result.rows[0];
    if (!b) throw new NotFoundException("Тираж этикеток не найден");
    return {
      id: b.id,
      code: b.code,
      count: b.count,
      assignedCount: Number(b.assigned),
      freeCount: b.count - Number(b.assigned),
      createdAt: new Date(b.created_at).toISOString(),
    };
  }
  async createPalletLabelBatch(
    body: D.CreatePalletLabelBatchDto,
  ): Promise<D.PalletLabelBatchDto> {
    if (!body.requestId?.trim())
      throw new BadRequestException("Для операции нужен уникальный requestId");
    if (!Number.isInteger(body.count) || body.count < 1 || body.count > 1000)
      throw new BadRequestException("Можно выпустить от 1 до 1000 этикеток");
    return this.warehouse.authTransaction(async (tx) => {
      const a = await this._manager(tx, true);
      const hash = createHash("sha256")
        .update(
          JSON.stringify([
            "createPalletLabelBatch",
            body,
            { accountId: a.id, employeeId: a.employee_id },
          ]),
        )
        .digest("hex");
      const other = await tx.query(
        "SELECT request_id FROM commands WHERE request_id=$1 UNION ALL SELECT request_id FROM stocktake_commands WHERE request_id=$1 UNION ALL SELECT request_id FROM automation_commands WHERE request_id=$1 UNION ALL SELECT request_id FROM box_label_commands WHERE request_id=$1",
        [body.requestId],
      );
      if (other.rows.length)
        throw new ConflictException(
          "Этот requestId уже использован для другой операции",
        );
      const cached = await tx.query<{
        fingerprint: string;
        response: D.PalletLabelBatchDto;
      }>(
        "SELECT fingerprint,response FROM pallet_label_commands WHERE request_id=$1",
        [body.requestId],
      );
      if (cached.rows[0]) {
        if (cached.rows[0].fingerprint !== hash)
          throw new ConflictException(
            "Этот requestId уже использован для другой операции",
          );
        return cached.rows[0].response;
      }
      const id = randomUUID(),
        code = `PALLET-LABELS-${randomUUID().slice(0, 8).toUpperCase()}`;
      await tx.query(
        "INSERT INTO pallet_label_batches(id,code,count,created_at,account_id) VALUES($1,$2,$3,$4,$5)",
        [id, code, body.count, new Date().toISOString(), a.id],
      );
      const labels = Array.from({ length: body.count }, (_, i) => ({
        id: randomUUID(),
        ordinal: i + 1,
        code: `PLT-PRE-${randomUUID().toUpperCase()}`,
      }));
      await tx.query(
        `INSERT INTO preprinted_pallet_labels(id,batch_id,ordinal,code) SELECT x.id,$1,x.ordinal,x.code FROM jsonb_to_recordset($2::jsonb) AS x(id TEXT,ordinal INTEGER,code TEXT)`,
        [id, JSON.stringify(labels)],
      );
      const response = await this._batch(tx, id);
      await tx.query(
        "INSERT INTO pallet_label_commands(request_id,fingerprint,response) VALUES($1,$2,$3)",
        [body.requestId, hash, JSON.stringify(response)],
      );
      return response;
    });
  }
  async getPalletLabelBatches(
    query: D.PalletLabelBatchQueryDto,
  ): Promise<D.PalletLabelBatchListDto> {
    const { page, pageSize, offset } = this._paging(query);
    return this.warehouse.authTransaction(async (tx) => {
      await this._manager(tx);
      const rows = await tx.query<{ id: string }>(
        "SELECT id FROM pallet_label_batches ORDER BY created_at DESC,id DESC LIMIT $1 OFFSET $2",
        [pageSize, offset],
      );
      const count = await tx.query<{ total: string }>(
        "SELECT COUNT(*) AS total FROM pallet_label_batches",
      );
      const items = [];
      for (const row of rows.rows) items.push(await this._batch(tx, row.id));
      return { items, total: Number(count.rows[0].total), page, pageSize };
    });
  }
  getPalletLabelBatch(id: string): Promise<D.PalletLabelBatchDto> {
    return this.warehouse.authTransaction(async (tx) => {
      await this._manager(tx);
      return this._batch(tx, id);
    });
  }
  async getPalletLabelBatchLabels(
    id: string,
    query: D.PalletLabelQueryDto,
  ): Promise<D.PalletLabelPageDto> {
    const { page, pageSize, offset } = this._paging(query);
    if (
      query.status !== undefined &&
      !["free", "assigned"].includes(query.status)
    )
      throw new BadRequestException("Неизвестный статус этикеток");
    const result = await this.warehouse.authTransaction(async (tx) => {
      await this._manager(tx);
      const batch = await this._batch(tx, id);
      const filter =
        query.status === "free"
          ? " AND pallet_id IS NULL"
          : query.status === "assigned"
            ? " AND pallet_id IS NOT NULL"
            : "";
      const rows = await tx.query<{
        id: string;
        code: string;
        ordinal: number;
        pallet_id: string | null;
        receipt_id: string | null;
      }>(
        `SELECT id,code,ordinal,pallet_id,receipt_id FROM preprinted_pallet_labels WHERE batch_id=$1${filter} ORDER BY ordinal LIMIT $2 OFFSET $3`,
        [id, pageSize, offset],
      );
      const count = await tx.query<{ total: string }>(
        `SELECT COUNT(*) AS total FROM preprinted_pallet_labels WHERE batch_id=$1${filter}`,
        [id],
      );
      return { batch, rows: rows.rows, total: Number(count.rows[0].total) };
    });
    // QR rendering is outside the warehouse lock. The registry and binding remain transactional.
    const items: D.PalletLabelDto[] = [];
    for (const row of result.rows) {
      const payload = `artmate-wms:pallet:${row.code}`;
      items.push({
        id: row.id,
        code: row.code,
        ordinal: row.ordinal,
        payload,
        svg: await QRCode.toString(payload, {
          type: "svg",
          margin: 2,
          width: 256,
        }),
        status: row.pallet_id ? "assigned" : "free",
        palletId: row.pallet_id,
        receiptId: row.receipt_id,
      });
    }
    return { batch: result.batch, items, total: result.total, page, pageSize };
  }
  private _paging(q: D.PalletLabelBatchQueryDto) {
    const page = q.page ?? 1,
      pageSize = q.pageSize ?? 20;
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > 1000000 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    )
      throw new BadRequestException("Некорректная страница этикеток");
    return { page, pageSize, offset: (page - 1) * pageSize };
  }
}
