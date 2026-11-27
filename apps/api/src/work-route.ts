import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import type * as D from "./dto";
import type { RequestAuthContext } from "./auth-context";
import { workRouteLayoutKey } from "./route-layout-key";
import { placementRoutePath } from "./placement-routing";
import {
  rankPlacementLocations,
  receiptSourceLocation,
} from "./placement-ranking";
import { placementError, putawayPlacementError } from "./physical";
import { activeZoneLocation, canonicalAssemblyLocation } from "./work-zones";

export function validateWorkRouteQuery(q: D.WorkRouteQueryDto) {
  if (
    !["assembly", "receiving", "putaway", "movement", "shipping"].includes(
      q.kind,
    ) ||
    typeof q.id !== "string" ||
    !q.id.trim() ||
    q.id.length > 160 ||
    [q.palletId, q.boxId].some(
      (v) =>
        v !== undefined &&
        (typeof v !== "string" || !v.trim() || v.length > 160),
    ) ||
    (q.kind === "receiving" ? !q.palletId : q.palletId !== undefined) ||
    (q.kind !== "shipping" && q.boxId !== undefined)
  )
    throw new BadRequestException(
      "Укажите тип задания и соответствующие ему идентификаторы",
    );
}
function find<T extends { id: string }>(
  rows: T[],
  id: string,
  title: string,
): T {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new NotFoundException(`${title} не найдено`);
  return row;
}
function active(s: D.WorkspaceDto, id: string | null | undefined) {
  if (!id) return null;
  const l = activeZoneLocation(s, id);
  return l && !l.blocked ? l.id : null;
}
function zoneEndpoint(s: D.WorkspaceDto, zoneId: string, kind: string) {
  const zone = s.warehouse.workZones.find(
    (z) => z.id === zoneId && z.kind === kind && !z.archived,
  );
  if (!zone) return null;
  const ids = [...new Set(zone.locationIds)].filter((id) => {
    const l = s.locations.find((l) => l.id === active(s, id));
    return (
      l &&
      (kind === "assembly"
        ? l.kind === "assembly"
        : ["shipping", "picking"].includes(l.kind))
    );
  });
  return ids.length === 1 ? ids[0] : null;
}
/** Resolve both endpoints from one authenticated full-state read. Never claims or scans. */
export function workRoute(
  s: D.WorkspaceDto,
  q: D.WorkRouteQueryDto,
  actor?: Pick<RequestAuthContext, "role" | "employeeId">,
): D.WorkRouteDto {
  validateWorkRouteQuery(q);
  let sourceLocationId: string | null = null,
    targetLocationId: string | null = null;
  const worker = actor && actor.role !== "manager";
  const own = (employeeId: string | null | undefined, free = false) => {
    if (worker && employeeId !== actor.employeeId && !(free && !employeeId))
      throw new ForbiddenException("Задание принадлежит другому сотруднику");
  };
  const unavailable = (note: string): D.WorkRouteDto => ({
    layoutKey: workRouteLayoutKey(s),
    revision: s.revision,
    sourceLocationId,
    targetLocationId,
    status: "unknown",
    distanceMeters: null,
    note,
    points: [],
  });
  if (q.kind === "assembly") {
    const task = find(s.tasks, q.id, "Задание сборки");
    own(task.employeeId, task.status === "queued");
    if (task.status === "completed")
      return unavailable("Задание сборки завершено.");
    const reservation = task.reservations.find((r) => r.quantity > 0);
    const pallet = s.pallets.find(
      (p) =>
        p.id === reservation?.palletId &&
        p.status === "stored" &&
        p.kind === "raw" &&
        p.skuId === task.skuId &&
        p.quantity > 0 &&
        !s.movements.some(
          (m) =>
            m.palletId === p.id && ["planned", "in_transit"].includes(m.status),
        ),
    );
    sourceLocationId = active(s, pallet?.locationId);
    const bindings = s.warehouse.zoneWork.filter(
      (w) =>
        w.jobKind === "assembly" &&
        w.jobId === task.id &&
        w.employeeId === task.employeeId,
    );
    targetLocationId = bindings.length
      ? bindings.length === 1
        ? zoneEndpoint(s, bindings[0].zoneId, "assembly")
        : null
      : active(s, canonicalAssemblyLocation(s));
  } else if (q.kind === "receiving") {
    const receipt = find(s.receipts, q.id, "Приёмка");
    const row = receipt.pallets.find((p) => p.palletId === q.palletId);
    if (!row)
      throw new BadRequestException("Паллета не принадлежит этой приёмке");
    if (
      worker &&
      s.warehouse.zoneWork.some(
        (w) =>
          w.jobKind === "receiving" &&
          w.jobId === receipt.id &&
          w.palletId === q.palletId &&
          w.employeeId !== actor.employeeId,
      )
    )
      throw new ForbiddenException("Паллета приёмки взята другим сотрудником");
    const pallet = find(s.pallets, q.palletId!, "Паллета");
    if (
      receipt.status === "completed" ||
      row.placedAt !== null ||
      pallet.status !== "awaiting_placement"
    )
      return unavailable("Паллета приёмки уже размещена.");
    sourceLocationId = receiptSourceLocation(s, receipt.id, pallet.id);
    targetLocationId = rankPlacementLocations(
      s,
      s.locations.filter(
        (l) =>
          ["rack", "floor"].includes(l.kind) && !placementError(s, l, pallet),
      ),
      sourceLocationId,
    ).suggestedLocationId;
  } else if (q.kind === "putaway") {
    const task = find(s.putawayTasks, q.id, "Задание размещения");
    own(task.employeeId, task.status === "queued");
    if (task.status === "completed")
      return unavailable("Размещение завершено.");
    const box = find(s.boxes, task.boxId, "Короб");
    sourceLocationId = active(s, task.fromLocationId);
    if (task.transferZoneId || ["claimed", "in_transit"].includes(task.status))
      targetLocationId = active(s, task.toLocationId);
    else
      targetLocationId = rankPlacementLocations(
        s,
        s.locations.filter((l) => !putawayPlacementError(s, l, box, task.id)),
        sourceLocationId,
        box.skuId,
      ).suggestedLocationId;
  } else if (q.kind === "movement") {
    const movement = find(s.movements, q.id, "Перемещение");
    own(
      movement.employeeId,
      movement.status === "planned" &&
        movement.autoPurpose === "accessible_raw",
    );
    if (!["planned", "in_transit"].includes(movement.status))
      return unavailable("Перемещение завершено или отменено.");
    sourceLocationId = active(s, movement.fromLocationId);
    targetLocationId = active(s, movement.toLocationId);
  } else {
    const shipment = find(s.shipments, q.id, "Отгрузка");
    own(shipment.employeeId);
    if (q.boxId && !shipment.boxIds.includes(q.boxId))
      throw new BadRequestException("Короб не принадлежит этой отгрузке");
    if (shipment.status !== "draft") return unavailable("Отгрузка завершена.");
    const id =
      q.boxId ??
      shipment.boxIds.find((id) => !shipment.scannedBoxIds?.includes(id));
    if (!id || shipment.scannedBoxIds?.includes(id))
      return unavailable("Все выбранные короба уже подтверждены.");
    const box = find(s.boxes, id, "Короб");
    const pallet = s.pallets.find(
      (p) => p.id === box.palletId && p.status === "stored",
    );
    sourceLocationId =
      box.status === "stored" && pallet?.locationId === box.locationId
        ? active(s, box.locationId)
        : null;
    const bindings = s.warehouse.zoneWork.filter(
      (w) =>
        w.jobKind === "shipping" &&
        w.jobId === shipment.id &&
        w.employeeId === shipment.employeeId &&
        w.zoneId === shipment.workZoneId,
    );
    targetLocationId =
      bindings.length === 1 && shipment.workZoneId
        ? zoneEndpoint(s, shipment.workZoneId, "shipping")
        : null;
  }
  if (!sourceLocationId || !targetLocationId)
    return unavailable(
      "Не удалось однозначно определить начало или конец маршрута по заданию.",
    );
  return {
    layoutKey: workRouteLayoutKey(s),
    revision: s.revision,
    sourceLocationId,
    targetLocationId,
    ...placementRoutePath(s, sourceLocationId, targetLocationId),
  };
}
