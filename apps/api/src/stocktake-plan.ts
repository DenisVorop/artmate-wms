import { randomUUID } from "node:crypto";
import * as D from "./dto";
import { cellBusyReasons } from "./stocktake-versions";
import { finishedMetrics, placementError, samePackaging } from "./physical";
export function stocktakeInventory(
  s: D.WorkspaceDto,
  locationId: string,
): D.StocktakeInventoryDto {
  const pallet =
    s.pallets.find(
      (p) => p.status === "stored" && p.locationId === locationId,
    ) ?? null;
  const rawPallets: D.StocktakeRawPalletDto[] = [];
  if (pallet?.kind === "raw" && pallet.skuId && pallet.lotId) {
    const sku = s.skus.find((x) => x.id === pallet.skuId),
      lot = s.lots.find((x) => x.id === pallet.lotId);
    if (sku && lot && lot.skuId === sku.id)
      rawPallets.push({
        palletId: pallet.id,
        palletCode: pallet.code,
        skuId: sku.id,
        skuName: sku.name,
        lotId: lot.id,
        lotName: lot.name,
        receivedAt: lot.receivedAt,
        quantity: pallet.quantity,
      });
  }
  const boxes = s.boxes
    .filter((b) => b.status === "stored" && b.locationId === locationId)
    .map((b) => ({
      id: b.id,
      code: b.code,
      skuId: b.skuId,
      skuName: s.skus.find((x) => x.id === b.skuId)?.name ?? b.skuId,
      units: b.units,
      palletId: b.palletId!,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
  return { pallet: pallet ? structuredClone(pallet) : null, rawPallets, boxes };
}
export function stocktakeRow(
  s: D.WorkspaceDto,
  locationId: string,
  version: number,
): D.StocktakeRowSnapshotDto {
  const l = s.locations.find((l) => l.id === locationId)!;
  return {
    locationId,
    locationCode: l.code,
    locationName: l.name,
    baselineVersion: version,
    countVersion: null,
    baseline: stocktakeInventory(s, locationId),
    count: null,
    countedAt: null,
    countedByEmployeeId: null,
    countedByName: null,
  };
}
export function rowIsStale(row: D.StocktakeRowSnapshotDto, current: number) {
  return (
    row.baselineVersion !== current ||
    (row.count !== null && row.countVersion !== current)
  );
}
function codeValue(value: string, type: string) {
  const v = value.trim();
  return v.startsWith(`artmate-wms:${type}:`)
    ? v.slice(`artmate-wms:${type}:`.length)
    : v;
}
export function locationMatches(s: D.WorkspaceDto, id: string, value: string) {
  const v = codeValue(value.toLowerCase(), "location"),
    l = s.locations.find((l) => l.id === id);
  return l && (v === l.id.toLowerCase() || v === l.code.toLowerCase());
}
export function stocktakePalletByCode(s: D.WorkspaceDto, scan: string) {
  const value = codeValue(scan.toLowerCase(), "pallet");
  return s.pallets.find(
    (pallet) =>
      pallet.id.toLowerCase() === value || pallet.code.toLowerCase() === value,
  );
}
export function stocktakePalletAddressError(
  s: D.WorkspaceDto,
  pallet: D.PalletDto,
) {
  const address = s.locations.find(
    (location) => location.id === pallet.locationId,
  );
  return address
    ? `Паллета ${pallet.code} числится в ячейке ${address.code}. Проверьте QR паллеты.`
    : `Паллета ${pallet.code} числится в другой ячейке. Проверьте QR паллеты.`;
}
export function stocktakePlan(
  s: D.WorkspaceDto,
  rows: D.StocktakeRowSnapshotDto[],
  versions: Map<string, number>,
  revision: number,
) {
  const issues: D.StocktakeIssueDto[] = [],
    changes: D.StocktakeChangeDto[] = [],
    scope = new Set(rows.map((r) => r.locationId));
  const issue = (
    code: string,
    message: string,
    locationIds: string[],
    entityId: string | null = null,
  ) =>
    issues.push({
      code,
      message,
      locationIds: [...new Set(locationIds)],
      entityId,
    });
  const staleLocationIds = rows
    .filter((r) => rowIsStale(r, versions.get(r.locationId) ?? 0))
    .map((r) => r.locationId);
  for (const row of rows) {
    if (row.count === null)
      issue("NOT_COUNTED", `${row.locationCode}: ячейка ещё не пересчитана`, [
        row.locationId,
      ]);
    if (staleLocationIds.includes(row.locationId))
      issue(
        "STALE",
        `${row.locationCode}: товар или резервы изменились. Явно обновите эту ячейку и пересчитайте заново`,
        [row.locationId],
      );
    for (const message of cellBusyReasons(s, row.locationId))
      issue("BUSY", `${row.locationCode}: ${message}`, [row.locationId]);
    if (row.baseline.pallet?.kind === "raw" && !row.baseline.rawPallets.length)
      issue(
        "UNKNOWN_LOT",
        `${row.locationCode}: сырьевая паллета без известной партии не может быть скорректирована`,
        [row.locationId],
        row.baseline.pallet.id,
      );
  }
  const rawFound = new Map<string, { locationId: string; quantity: number }>(),
    boxFound = new Map<string, string>();
  const unresolvedRawLocations = new Set(
    rows.filter((row) => !row.count).map((row) => row.locationId),
  );
  for (const row of rows)
    if (row.count) {
      for (const count of row.count.rawPallets) {
        const p = stocktakePalletByCode(s, count.palletCode);
        if (!p) {
          unresolvedRawLocations.add(row.locationId);
          issue(
            "UNKNOWN_PALLET",
            `${row.locationCode}: неизвестный код паллеты «${count.palletCode}». Проверьте код и пересчитайте`,
            [row.locationId],
          );
          continue;
        }
        if (
          p.kind !== "raw" ||
          p.status !== "stored" ||
          !p.locationId ||
          !p.skuId ||
          !p.lotId ||
          !s.lots.some((l) => l.id === p.lotId && l.skuId === p.skuId)
        ) {
          unresolvedRawLocations.add(row.locationId);
          issue(
            "UNAVAILABLE_PALLET",
            `${p.code}: паллета не является размещённым сырьём с известной партией`,
            [row.locationId],
            p.id,
          );
          continue;
        }
        if (!scope.has(p.locationId)) {
          unresolvedRawLocations.add(row.locationId);
          issue(
            "OUTSIDE_SCOPE",
            stocktakePalletAddressError(s, p),
            [p.locationId, row.locationId],
            p.id,
          );
          continue;
        }
        const previous = rawFound.get(p.id);
        if (previous) {
          unresolvedRawLocations.add(previous.locationId);
          unresolvedRawLocations.add(row.locationId);
          issue(
            "DUPLICATE_PALLET",
            `${p.code}: одна паллета указана более одного раза`,
            [previous.locationId, row.locationId],
            p.id,
          );
          continue;
        }
        rawFound.set(p.id, {
          locationId: row.locationId,
          quantity: count.quantity,
        });
      }
      for (const scan of row.count.boxCodes) {
        const value = codeValue(scan, "box"),
          box = s.boxes.find((b) => b.id === value || b.code === value);
        if (!box) {
          issue(
            "UNKNOWN_BOX",
            `${row.locationCode}: неизвестный код короба «${scan}». Излишек без известной партии не создаётся`,
            [row.locationId],
          );
          continue;
        }
        const pallet = s.pallets.find((p) => p.id === box.palletId);
        if (
          box.status !== "stored" ||
          !box.locationId ||
          !pallet ||
          pallet.kind !== "finished" ||
          pallet.status !== "stored" ||
          pallet.locationId !== box.locationId
        ) {
          issue(
            "UNAVAILABLE_BOX",
            `${box.code}: короб в пути, списан, отгружен или ещё не размещён на паллете хранения`,
            [row.locationId],
            box.id,
          );
          continue;
        }
        if (!scope.has(box.locationId)) {
          issue(
            "OUTSIDE_SCOPE",
            `${box.code}: исходный адрес не включён в сверку. Нужна новая сверка с обоими адресами или обычное перемещение`,
            [box.locationId, row.locationId],
            box.id,
          );
          continue;
        }
        if (boxFound.has(box.id)) {
          issue(
            "DUPLICATE_BOX",
            `${box.code}: один короб найден в нескольких строках или просканирован повторно`,
            [boxFound.get(box.id)!, row.locationId],
            box.id,
          );
          continue;
        }
        boxFound.set(box.id, row.locationId);
      }
    }
  const rawExpected = new Set(
      rows.flatMap((r) => r.baseline.rawPallets.map((p) => p.palletId)),
    ),
    boxExpected = new Set(
      rows.flatMap((r) => r.baseline.boxes.map((b) => b.id)),
    );
  for (const id of rawExpected) {
    const pallet = s.pallets.find((p) => p.id === id);
    if (!pallet) continue;
    const found = rawFound.get(id);
    // An unresolved scan or an uncounted address cannot establish a shortage.
    if (pallet.locationId && unresolvedRawLocations.has(pallet.locationId))
      continue;
    if (found && unresolvedRawLocations.has(found.locationId)) continue;
    const qty = found?.quantity ?? 0;
    if (found && found.locationId !== pallet.locationId)
      changes.push({
        kind: "raw_pallet_relocation",
        entityId: id,
        code: pallet.code,
        fromLocationId: pallet.locationId,
        toLocationId: found.locationId,
        expectedQuantity: pallet.quantity,
        countedQuantity: qty,
        unitsDelta: 0,
      });
    if (qty < pallet.quantity) {
      const reserved = s.tasks
        .filter((task) => task.status === "queued")
        .flatMap((task) => task.reservations)
        .filter((reservation) => reservation.palletId === id)
        .reduce((sum, reservation) => sum + reservation.quantity, 0);
      if (qty < reserved)
        issue(
          "ASSEMBLY_RESERVATION_SHORTAGE",
          `${pallet.code}: насчитано ${qty} шт., а задания в очереди требуют ${reserved} шт. Перед утверждением освободите лишний резерв сборки`,
          [pallet.locationId!],
          id,
        );
    }
    if (qty !== pallet.quantity)
      changes.push({
        kind: "raw_count",
        entityId: id,
        code: pallet.code,
        fromLocationId: pallet.locationId,
        toLocationId: found?.locationId ?? pallet.locationId,
        expectedQuantity: pallet.quantity,
        countedQuantity: qty,
        unitsDelta: qty - pallet.quantity,
      });
  }
  for (const id of boxExpected) {
    const box = s.boxes.find((b) => b.id === id);
    if (!box) continue;
    const target = boxFound.get(id);
    if (!target)
      changes.push({
        kind: "box_writeoff",
        entityId: id,
        code: box.code,
        fromLocationId: box.locationId,
        toLocationId: box.locationId,
        expectedQuantity: 1,
        countedQuantity: 0,
        unitsDelta: -box.units,
      });
    else if (target !== box.locationId)
      changes.push({
        kind: "box_relocation",
        entityId: id,
        code: box.code,
        fromLocationId: box.locationId,
        toLocationId: target,
        expectedQuantity: 1,
        countedQuantity: 1,
        unitsDelta: 0,
      });
  }
  let result: D.WorkspaceDto | null = null;
  if (!issues.length) {
    const next = structuredClone(s);
    try {
      for (const change of changes) {
        if (change.kind === "raw_count")
          next.pallets.find((p) => p.id === change.entityId)!.quantity =
            change.countedQuantity;
        if (change.kind === "raw_pallet_relocation")
          next.pallets.find((p) => p.id === change.entityId)!.locationId =
            change.toLocationId;
        if (change.kind === "box_writeoff")
          next.boxes.find((b) => b.id === change.entityId)!.status =
            "written_off";
        if (change.kind === "box_relocation") {
          const box = next.boxes.find((b) => b.id === change.entityId)!;
          box.locationId = change.toLocationId;
          box.palletId = null;
        }
      }
      for (const [id, target] of boxFound) {
        const box = next.boxes.find((b) => b.id === id)!;
        if (box.palletId !== null) continue;
        let pallet = next.pallets.find(
          (p) => p.status === "stored" && p.locationId === target,
        );
        if (!pallet) {
          const profile = structuredClone(box.packagingSnapshot),
            metrics = finishedMetrics(profile, 0);
          pallet = {
            id: randomUUID(),
            code: `PAL-${randomUUID().slice(0, 8).toUpperCase()}`,
            kind: "finished",
            skuId: box.skuId,
            lotId: null,
            quantity: 0,
            locationId: target,
            status: "stored",
            returnLocationId: null,
            packagingSnapshot: profile,
            ...metrics,
          };
          next.pallets.push(pallet);
        }
        if (
          pallet.kind !== "finished" ||
          pallet.skuId !== box.skuId ||
          !pallet.packagingSnapshot ||
          !samePackaging(pallet.packagingSnapshot, box.packagingSnapshot)
        )
          throw new Error(
            `${box.code}: адрес назначения занят несовместимой паллетой. Одна паллета хранения — одна тематика и профиль`,
          );
        box.palletId = pallet.id;
      }
      for (const pallet of next.pallets.filter(
        (p) => p.kind === "finished" && p.locationId && scope.has(p.locationId),
      )) {
        pallet.quantity = next.boxes.filter(
          (b) => b.status === "stored" && b.palletId === pallet.id,
        ).length;
        if (
          pallet.quantity >
          pallet.packagingSnapshot!.boxesPerLayer *
            pallet.packagingSnapshot!.maxLayers
        )
          throw new Error(
            `${pallet.code}: превышена вместимость паллеты по профилю упаковки`,
          );
        Object.assign(
          pallet,
          finishedMetrics(pallet.packagingSnapshot!, pallet.quantity),
        );
      }
      for (const pallet of next.pallets.filter(
        (p) => p.status === "stored" && p.locationId && scope.has(p.locationId),
      )) {
        const location = next.locations.find(
          (l) => l.id === pallet.locationId,
        )!;
        const error = placementError(next, location, pallet, pallet.id);
        if (error) throw new Error(`${location.code}: ${error}`);
      }
      result = next;
    } catch (error) {
      issue(
        "PHYSICAL_CONFLICT",
        error instanceof Error
          ? error.message
          : "Невозможно безопасно применить физическое размещение",
        rows.map((r) => r.locationId),
      );
    }
  }
  return {
    state: result,
    preview: {
      revision,
      canApprove: issues.length === 0,
      issues,
      changes,
      unitsDelta: changes.reduce((n, c) => n + c.unitsDelta, 0),
      staleLocationIds,
    } satisfies D.StocktakePreviewDto,
  };
}
