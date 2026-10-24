import { z } from "zod";
import { WorkZoneDtoKind } from "@/shared/api/generated/model";
import type {
  CreateWorkZoneDto,
  UpdateWorkZoneDto,
  WorkZoneDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";
export const workZoneKindLabels: Record<WorkZoneDto["kind"], string> = {
  receiving: "Приёмка",
  assembly: "Сборка",
  putaway: "Размещение коробов",
  shipping: "Отгрузка",
};
export const workZoneSchema = z.object({
  kind: z.nativeEnum(WorkZoneDtoKind),
  name: z.string().trim().max(100, "Не больше 100 символов"),
  code: z.string().trim().max(40, "Не больше 40 символов"),
  locationIds: z
    .array(z.string().min(1))
    .min(1, "Выберите хотя бы один адрес")
    .max(200, "Не больше 200 адресов")
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "Адреса не должны повторяться",
    ),
});
export function workZoneSchemaFor(editing: boolean) {
  return workZoneSchema.superRefine((value, context) => {
    if (!editing) return;
    for (const field of ["name", "code"] as const) {
      if (!value[field])
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message:
            field === "name" ? "Укажите название зоны" : "Укажите код зоны",
        });
    }
  });
}
export type WorkZoneValues = z.infer<typeof workZoneSchema>;
export function workZoneDefaults(zone?: WorkZoneDto): WorkZoneValues {
  return {
    kind: zone?.kind ?? WorkZoneDtoKind.receiving,
    name: zone?.name ?? "",
    code: zone?.code ?? "",
    locationIds: [...(zone?.locationIds ?? [])],
  };
}
export function toCreateWorkZone(values: WorkZoneValues): CreateWorkZoneDto {
  return { ...workZoneSchema.parse(values), requestId: crypto.randomUUID() };
}
export function toUpdateWorkZone(values: WorkZoneValues): UpdateWorkZoneDto {
  return {
    ...workZoneSchemaFor(true).parse(values),
    requestId: crypto.randomUUID(),
  };
}
export function eligibleZoneLocations(
  data: Pick<
    WorkspaceDto,
    | "locations"
    | "pallets"
    | "warehouse"
    | "movements"
    | "putawayTasks"
    | "addressHolds"
  >,
  kind: WorkZoneDto["kind"],
) {
  const active = data.locations.filter(
    (location) => !location.archived && !location.blocked,
  );
  const all = active.filter((location) =>
    kind === "receiving"
      ? location.kind === "receiving"
      : kind === "shipping"
        ? ["picking", "shipping"].includes(location.kind)
        : location.kind === "assembly",
  );
  if (kind !== "assembly")
    return all.sort(
      (a, b) => a.code.localeCompare(b.code) || a.id.localeCompare(b.id),
    );
  const mixed = data.pallets.find(
    (p) => p.kind === "assembly" && p.status === "stored" && !!p.locationId,
  );
  const linked = data.warehouse.workZones.find(
    (zone) => !zone.archived && zone.kind === "assembly",
  )?.locationIds[0];
  const canonical = mixed
    ? all.find((l) => l.id === mixed.locationId)
    : linked
      ? all.find((l) => l.id === linked)
      : [...all]
          .filter(
            (l) =>
              !data.pallets.some(
                (p) => p.status === "stored" && p.locationId === l.id,
              ),
          )
          .sort(
            (a, b) => a.code.localeCompare(b.code) || a.id.localeCompare(b.id),
          )[0];
  return canonical ? [canonical] : [];
}
