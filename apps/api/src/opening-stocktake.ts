import { createHash } from "node:crypto";
import { isISO8601 } from "class-validator";
import type * as D from "./dto";
import { cellBusyReasons } from "./stocktake-versions";
import { rowIsStale } from "./stocktake-plan";
import { finishedMetrics, packagingError, placementError } from "./physical";
export const OPENING_MAX_BOXES = 5000;
export const OPENING_MAX_BOXES_PER_LOCATION = 2000;
export interface OpeningDocumentIdentity {
  id: string;
  code: string;
  createdAt: string;
}
export interface OpeningLocationResult {
  palletId: string | null;
  boxIds: string[];
}
/** No guessed inventory: an empty, active, unreserved address is mandatory. */
export function openingLocationIssues(
  s: D.WorkspaceDto,
  locationId: string,
): string[] {
  const location = s.locations.find((entry) => entry.id === locationId);
  const reasons = [...cellBusyReasons(s, locationId)];
  if (
    location?.sectionId &&
    !s.sections.some(
      (section) => section.id === location.sectionId && !section.archived,
    )
  )
    reasons.push("Секция адреса недоступна");
  if (
    s.pallets.some(
      (pallet) =>
        pallet.locationId === locationId && pallet.status !== "retired",
    ) ||
    s.boxes.some(
      (box) =>
        box.locationId === locationId &&
        ["stored", "in_transit"].includes(box.status),
    )
  )
    reasons.push(
      "На адресе уже есть учтённый товар или физическая паллета. Используйте обычную сверку",
    );
  return [...new Set(reasons)];
}
function identity(docId: string, locationId: string, type: string, index = 0) {
  const bytes = createHash("sha256")
    .update(
      JSON.stringify(["opening-stocktake-v1", docId, locationId, type, index]),
    )
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function receivedAt(value: unknown, clock: Date): string | null {
  if (typeof value !== "string" || !isISO8601(value, { strict: true }))
    return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!dateOnly && !/(Z|[+-]\d{2}:?\d{2})$/i.test(value)) return null;
  const time = Date.parse(dateOnly ? `${value}T00:00:00+03:00` : value);
  return Number.isFinite(time) && time <= clock.getTime()
    ? new Date(time).toISOString()
    : null;
}
function warehouseDate(value: string) {
  return new Date(Date.parse(value) + 3 * 3600000).toISOString().slice(0, 10);
}
function packagingProblem(profile: D.PackagingProfileDto | null | undefined) {
  if (
    !profile ||
    profile.palletWidthMm !== 1200 ||
    profile.palletDepthMm !== 800
  )
    return "Настройте известный профиль упаковки на европаллете 1200×800 мм";
  if (
    ![
      profile.boxWidthMm,
      profile.boxDepthMm,
      profile.boxHeightMm,
      profile.palletBaseHeightMm,
      profile.boxesPerLayer,
      profile.maxLayers,
    ].every((value) => Number.isFinite(value) && value > 0) ||
    !Number.isSafeInteger(profile.boxesPerLayer) ||
    !Number.isSafeInteger(profile.maxLayers) ||
    [profile.boxWeightKg, profile.palletWeightKg].some(
      (value) => value !== null && (!Number.isFinite(value) || value <= 0),
    )
  )
    return "Проверьте размеры и вместимость профиля упаковки";
  return packagingError(profile);
}
export function openingStocktakePlan(
  s: D.WorkspaceDto,
  rows: D.StocktakeRowSnapshotDto[],
  versions: Map<string, number>,
  revision: number,
  doc: OpeningDocumentIdentity,
  clock = new Date(),
): {
  state: D.WorkspaceDto | null;
  preview: D.StocktakePreviewDto;
  results: Record<string, OpeningLocationResult>;
} {
  const issues: D.StocktakeIssueDto[] = [],
    changes: D.StocktakeChangeDto[] = [];
  const results: Record<string, OpeningLocationResult> = {};
  const next = structuredClone(s);
  const staleLocationIds: string[] = [];
  let boxesGenerated = 0;
  const issue = (
    row: D.StocktakeRowSnapshotDto,
    code: string,
    message: string,
  ) =>
    issues.push({
      code,
      message: `${row.locationCode}: ${message}`,
      locationIds: [row.locationId],
      entityId: null,
    });
  const scoped = new Set<string>();
  for (const [rowIndex, row] of [...rows]
    .sort((a, b) => a.locationId.localeCompare(b.locationId))
    .entries()) {
    const localStart = issues.length;
    if (scoped.has(row.locationId))
      issue(row, "DUPLICATE_LOCATION", "Адрес повторяется в документе");
    scoped.add(row.locationId);
    if (rowIsStale(row, versions.get(row.locationId) ?? 0)) {
      staleLocationIds.push(row.locationId);
      issue(
        row,
        "STALE",
        "Адрес изменился. Обновите исходные данные и пересчитайте его",
      );
    }
    for (const reason of openingLocationIssues(s, row.locationId))
      issue(row, "UNAVAILABLE", reason);
    if (
      row.baseline.pallet ||
      row.baseline.rawPallets.length ||
      row.baseline.boxes.length
    )
      issue(
        row,
        "NONEMPTY_BASELINE",
        "Первичный ввод возможен только для пустого исходного адреса",
      );
    const count = row.count;
    if (!count) {
      issue(
        row,
        "NOT_COUNTED",
        "Подтвердите фактический остаток или пустое место",
      );
      continue;
    }
    if (count.rawPallets.length || count.boxCodes.length)
      issue(
        row,
        "MIXED_MODES",
        "Для первичного ввода укажите новую паллету, а не коды уже учтённого товара",
      );
    if (
      !Object.prototype.hasOwnProperty.call(count, "openingPallet") ||
      count.openingPallet === undefined
    ) {
      issue(
        row,
        "MISSING_OPENING_COUNT",
        "Укажите паллету или явно подтвердите пустое место",
      );
      continue;
    }
    const entry = count.openingPallet;
    results[row.locationId] = { palletId: null, boxIds: [] };
    if (entry === null) continue;
    const sku = s.skus.find((item) => item.id === entry.skuId);
    if (!sku) issue(row, "UNKNOWN_SKU", "Выберите существующую тематику");
    if (!["raw", "finished"].includes(entry.kind))
      issue(row, "INVALID_KIND", "Выберите сырьё или готовые короба");
    if (
      !Array.isArray(entry.batches) ||
      !entry.batches.length ||
      entry.batches.length > 2000
    ) {
      issue(
        row,
        "INVALID_BATCHES",
        "Укажите от 1 до 2000 партий с фактическими датами поступления",
      );
      continue;
    }
    if (entry.kind === "raw" && entry.unitsPerBox !== undefined)
      issue(
        row,
        "RAW_UNITS_PER_BOX",
        "Количество в коробе указывают только для готовых коробов; сырьё считают поштучно",
      );
    if (entry.kind === "raw" && entry.batches.length !== 1)
      issue(
        row,
        "RAW_BATCH_COUNT",
        "На сырьевой паллете должна быть ровно одна партия",
      );
    if (entry.batches.some((batch) => !batch || typeof batch !== "object")) {
      issue(row, "INVALID_BATCHES", "Проверьте строки партий");
      continue;
    }
    const batches = entry.batches.map((batch) => ({
      quantity: batch.quantity,
      receivedAt: receivedAt(batch.receivedAt, clock),
    }));
    if (
      batches.some(
        (batch) =>
          !Number.isSafeInteger(batch.quantity) ||
          batch.quantity < 1 ||
          batch.quantity > 100000000,
      )
    )
      issue(
        row,
        "INVALID_QUANTITY",
        "Количество должно быть положительным целым числом не более 100000000",
      );
    if (batches.some((batch) => batch.receivedAt === null))
      issue(
        row,
        "INVALID_RECEIVED_AT",
        "Укажите известную корректную дату поступления, не позднее сегодняшнего дня",
      );
    const quantity = batches.reduce((sum, batch) => sum + batch.quantity, 0);
    if (!Number.isSafeInteger(quantity))
      issue(row, "QUANTITY_OVERFLOW", "Суммарное количество слишком велико");
    if (
      entry.kind === "raw" &&
      (!Number.isSafeInteger(entry.heightMm) ||
        entry.heightMm! < 150 ||
        entry.heightMm! > 10000)
    )
      issue(
        row,
        "RAW_HEIGHT",
        "Укажите полную высоту сырьевой паллеты вместе с поддоном: от 150 до 10000 мм",
      );
    if (
      entry.weightKg !== undefined &&
      entry.weightKg !== null &&
      (!Number.isFinite(entry.weightKg) || entry.weightKg <= 0)
    )
      issue(
        row,
        "INVALID_WEIGHT",
        "Масса паллеты должна быть положительным числом или неизвестной",
      );
    if (entry.kind === "finished") {
      if (entry.heightMm !== undefined || entry.weightKg !== undefined)
        issue(
          row,
          "FINISHED_MEASUREMENTS",
          "Высота и масса готовой паллеты рассчитываются по профилю коробов; уберите отдельные размеры",
        );
      if (
        !Number.isSafeInteger(entry.unitsPerBox) ||
        entry.unitsPerBox! < 1 ||
        entry.unitsPerBox! > 1000
      )
        issue(
          row,
          "UNITS_PER_BOX",
          "Укажите фактическое количество товара в одном коробе: от 1 до 1000",
        );
      const problem = packagingProblem(sku?.packaging);
      if (problem) issue(row, "UNKNOWN_PACKAGING", problem);
      if (quantity > OPENING_MAX_BOXES_PER_LOCATION)
        issue(
          row,
          "ADDRESS_BOX_LIMIT",
          `На одном адресе можно ввести не более ${OPENING_MAX_BOXES_PER_LOCATION} коробов`,
        );
      if (
        quantity > OPENING_MAX_BOXES ||
        boxesGenerated + quantity > OPENING_MAX_BOXES
      )
        issue(
          row,
          "BOX_LIMIT",
          `В одном документе можно ввести не более ${OPENING_MAX_BOXES} коробов`,
        );
    }
    if (issues.length !== localStart || !sku) continue;
    const palletId = identity(doc.id, row.locationId, "pallet");
    const position = String(rowIndex + 1).padStart(3, "0");
    const palletCode = `PAL-${doc.code}-${position}`;
    if (s.pallets.some((p) => p.id === palletId || p.code === palletCode)) {
      issue(
        row,
        "IDENTITY_COLLISION",
        "Паллета этого документа уже зарегистрирована",
      );
      continue;
    }
    const lots: D.LotDto[] = batches.map((batch, index) => ({
      id: identity(doc.id, row.locationId, "lot", index),
      skuId: sku.id,
      openingStocktakeId: doc.id,
      receivedAt: batch.receivedAt!,
      name: `${doc.code} · ${sku.name} · ${warehouseDate(batch.receivedAt!)}`,
    }));
    if (lots.some((lot) => s.lots.some((old) => old.id === lot.id))) {
      issue(
        row,
        "IDENTITY_COLLISION",
        "Партия этого документа уже зарегистрирована",
      );
      continue;
    }
    const profile =
      entry.kind === "finished" ? structuredClone(sku.packaging) : null;
    const pallet: D.PalletDto = {
      id: palletId,
      code: palletCode,
      skuId: sku.id,
      lotId: entry.kind === "raw" ? lots[0].id : null,
      kind: entry.kind,
      quantity,
      locationId: row.locationId,
      returnLocationId: null,
      status: "stored",
      packagingSnapshot: profile,
      openingStocktakeId: doc.id,
      ...(profile
        ? finishedMetrics(profile, quantity)
        : {
            widthMm: 1200,
            depthMm: 800,
            heightMm: entry.heightMm!,
            weightKg: entry.weightKg ?? null,
          }),
    };
    if (profile && quantity > profile.boxesPerLayer * profile.maxLayers) {
      issue(
        row,
        "PALLET_CAPACITY",
        "Короба не помещаются на одну паллету по профилю упаковки",
      );
      continue;
    }
    const location = next.locations.find((item) => item.id === row.locationId)!;
    const placement = placementError(next, location, pallet);
    if (placement) {
      issue(row, "PHYSICAL_CONFLICT", placement);
      continue;
    }
    const boxes: D.BoxDto[] = [];
    if (profile) {
      let ordinal = 0;
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++)
        for (let index = 0; index < batches[batchIndex].quantity; index++) {
          const id = identity(doc.id, row.locationId, "box", ordinal++);
          const code = `BOX-${doc.code}-${position}-${String(ordinal).padStart(4, "0")}`;
          if (s.boxes.some((box) => box.id === id || box.code === code)) {
            issue(
              row,
              "IDENTITY_COLLISION",
              "Короб этого документа уже зарегистрирован",
            );
            break;
          }
          boxes.push({
            id,
            code,
            skuId: sku.id,
            units: entry.unitsPerBox!,
            packagingSnapshot: structuredClone(profile),
            lotContents: [
              { lotId: lots[batchIndex].id, quantity: entry.unitsPerBox! },
            ],
            packedAt: null,
            registeredAt: clock.toISOString(),
            openingStocktakeId: doc.id,
            locationId: row.locationId,
            palletId,
            status: "stored",
          });
        }
      boxesGenerated += boxes.length;
    }
    if (issues.length !== localStart) continue;
    next.lots.push(...lots);
    next.pallets.push(pallet);
    next.boxes.push(...boxes);
    results[row.locationId] = { palletId, boxIds: boxes.map((box) => box.id) };
    const dates = [
      ...new Set(batches.map((batch) => warehouseDate(batch.receivedAt!))),
    ].sort();
    changes.push({
      kind: entry.kind === "raw" ? "opening_raw" : "opening_finished",
      entityId: palletId,
      code: `${sku.name} · ${dates[0]}${dates.length > 1 ? ` — ${dates.at(-1)}` : ""}`,
      fromLocationId: null,
      toLocationId: row.locationId,
      expectedQuantity: 0,
      countedQuantity: quantity,
      unitsDelta:
        quantity * (entry.kind === "finished" ? entry.unitsPerBox! : 1),
    });
  }
  return {
    state: issues.length ? null : next,
    results,
    preview: {
      revision,
      canApprove: issues.length === 0,
      issues,
      changes,
      unitsDelta: changes.reduce((sum, change) => sum + change.unitsDelta, 0),
      staleLocationIds,
    },
  };
}
