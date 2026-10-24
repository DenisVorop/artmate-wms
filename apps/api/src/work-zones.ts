import { BadRequestException } from "@nestjs/common";
import * as D from "./dto";
export const zoneKinds: Record<string, string[]> = {
  receiving: ["receiving"],
  assembly: ["assembly"],
  putaway: ["assembly"],
  shipping: ["picking", "shipping"],
};
export function activeZoneLocation(s: D.WorkspaceDto, id: string) {
  const l = s.locations.find((l) => l.id === id);
  return l &&
    !l.archived &&
    !s.sections.find((x) => x.id === l.sectionId)?.archived
    ? l
    : null;
}
export function canonicalAssemblyLocation(s: D.WorkspaceDto) {
  return (
    s.pallets.find(
      (p) => p.kind === "assembly" && p.status === "stored" && p.locationId,
    )?.locationId ??
    s.warehouse.workZones.find((z) => z.kind === "assembly" && !z.archived)
      ?.locationIds[0] ??
    s.locations
      .filter(
        (l) =>
          l.kind === "assembly" &&
          activeZoneLocation(s, l.id) &&
          !l.blocked &&
          !s.pallets.some(
            (p) => p.status === "stored" && p.locationId === l.id,
          ),
      )
      .sort(
        (a, b) => a.code.localeCompare(b.code) || a.id.localeCompare(b.id),
      )[0]?.id ??
    null
  );
}
export function validateWorkZone(
  s: D.WorkspaceDto,
  z: D.WorkZoneDto,
  strict = true,
) {
  if (
    !D.WORK_ZONE_KINDS.includes(z.kind as (typeof D.WORK_ZONE_KINDS)[number]) ||
    !z.locationIds.length ||
    new Set(z.locationIds).size !== z.locationIds.length
  )
    throw new BadRequestException(
      "Укажите неповторяющиеся адреса рабочей зоны",
    );
  for (const id of z.locationIds) {
    const l = activeZoneLocation(s, id);
    if (!l || !zoneKinds[z.kind].includes(l.kind) || (strict && l.blocked))
      throw new BadRequestException(
        "Рабочая зона должна ссылаться на действующие подходящие адреса без блокировки",
      );
  }
  if (
    z.kind === "assembly" &&
    (z.locationIds.length !== 1 ||
      z.locationIds[0] !== canonicalAssemblyLocation(s))
  )
    throw new BadRequestException(
      "Все зоны сборки должны ссылаться на один текущий адрес общей паллеты сборки",
    );
}
export function zoneIdentity(
  s: D.WorkspaceDto,
  kind: string,
  code: string,
  name: string,
) {
  let n = 1;
  const used = (value: string) =>
    s.warehouse.workZones.some(
      (z) => z.code.trim().toLowerCase() === value.trim().toLowerCase(),
    );
  while (used(`WZ-${String(n).padStart(2, "0")}`)) n++;
  const resultCode = code.trim() || `WZ-${String(n).padStart(2, "0")}`;
  if (used(resultCode))
    throw new BadRequestException(
      "Код рабочей зоны уже используется, включая архив",
    );
  const titles: Record<string, string> = {
    receiving: "Зона приёмки",
    assembly: "Зона сборки",
    putaway: "Зона размещения",
    shipping: "Зона отгрузки",
  };
  let title = name.trim();
  if (!title) {
    let i = 1;
    while (
      s.warehouse.workZones.some(
        (z) =>
          z.name.trim().toLowerCase() === `${titles[kind]} ${i}`.toLowerCase(),
      )
    )
      i++;
    title = `${titles[kind]} ${i}`;
  }
  return { code: resultCode, name: title };
}
