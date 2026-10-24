"use client";
import type {
  ResizeSpaceDto,
  WarehousePlanDto,
} from "@/shared/api/generated/model";
import { useWarehouseCommands } from "@/shared/api/use-warehouse-commands";
import { toSpace, type SpaceValues } from "../lib/space-form";
import {
  rotationSchema,
  toCreateLocation,
  toUpdateLocation,
  type LocationFormValues,
  type LevelProfileValues,
} from "../lib/location-form";
import {
  toCreateLevel,
  toCreateSection,
  toUpdateSection,
  type SectionFormValues,
} from "../lib/rack-form";
import {
  toAisle,
  toEntrance,
  toWarehousePlan,
  type AisleValues,
  type EntranceValues,
  type WarehousePlanValues,
} from "../lib/plan-form";

function parts(key: string) {
  const split = key.indexOf(":");
  if (split < 1 || split === key.length - 1)
    throw new Error("Не удалось определить объект плана");
  return [key.slice(0, split), key.slice(split + 1)] as const;
}
export function useLocationActions() {
  const commands = useWarehouseCommands();
  function archive(key: string) {
    const [kind, id] = parts(key);
    const dto = { requestId: crypto.randomUUID() };
    switch (kind) {
      case "space":
        return commands.deleteSpace(id, dto);
      case "section":
        return commands.deleteRackSection(id, dto);
      case "location":
        return commands.deleteLocation(id, dto);
      case "aisle":
        return commands.deleteAisle(id, dto);
      case "entrance":
        return commands.deleteEntrance(id, dto);
      default:
        return Promise.reject(new Error("Неизвестный объект плана"));
    }
  }
  function restore(key: string) {
    const [kind, id] = parts(key);
    const dto = { requestId: crypto.randomUUID() };
    switch (kind) {
      case "space":
        return commands.restoreSpace(id, dto);
      case "section":
        return commands.restoreRackSection(id, dto);
      case "location":
        return commands.restoreLocation(id, dto);
      case "aisle":
        return commands.restoreAisle(id, dto);
      case "entrance":
        return commands.restoreEntrance(id, dto);
      default:
        return Promise.reject(new Error("Неизвестный объект плана"));
    }
  }
  function move(key: string, position: { x: number; y: number }) {
    const [kind, id] = parts(key);
    const dto = { ...position, requestId: crypto.randomUUID() };
    if (kind === "space") return commands.updateSpace(id, dto);
    if (kind === "section") return commands.updateRackSection(id, dto);
    if (kind === "aisle") return commands.updateAisle(id, dto);
    if (kind === "location") return commands.updateLocation(id, dto);
    return Promise.reject(new Error("Вход перемещается вдоль стены"));
  }
  function rotate(key: string, value: number) {
    const [kind, id] = parts(key);
    const dto = {
      rotation: rotationSchema.parse(value),
      requestId: crypto.randomUUID(),
    };
    if (kind === "section") return commands.updateRackSection(id, dto);
    if (kind === "aisle") return commands.updateAisle(id, dto);
    if (kind === "location") return commands.updateLocation(id, dto);
    return Promise.reject(new Error("Положение входа определяется стеной"));
  }
  return {
    pending: commands.pending,
    error: commands.error,
    clearError: commands.clearError,
    saveSpace: (values: SpaceValues, id?: string) =>
      id
        ? commands.updateSpace(id, toSpace(values))
        : commands.createSpace(toSpace(values)),
    resizeSpace: (id: string, values: Omit<ResizeSpaceDto, "requestId">) =>
      commands.resizeSpace(id, { ...values, requestId: crypto.randomUUID() }),
    resizePlan: (values: Pick<WarehousePlanDto, "width" | "depth">) =>
      commands.updateWarehousePlan({
        ...values,
        requestId: crypto.randomUUID(),
      }),
    saveLocation: (values: LocationFormValues, id?: string, isRack = false) =>
      id
        ? commands.updateLocation(id, toUpdateLocation(values, isRack))
        : commands.createLocation(toCreateLocation(values)),
    saveSection: (values: SectionFormValues, id?: string) =>
      id
        ? commands.updateRackSection(id, toUpdateSection(values))
        : commands.createRackSection(toCreateSection(values)),
    copySection: (id: string, position: { x: number; y: number }) =>
      commands.copyRackSection(id, {
        ...position,
        requestId: crypto.randomUUID(),
      }),
    addLevel: (sectionId: string, values: LevelProfileValues) =>
      commands.createRackLevel(sectionId, toCreateLevel(values)),
    saveWarehousePlan: (values: WarehousePlanValues) =>
      commands.updateWarehousePlan(toWarehousePlan(values)),
    saveAisle: (values: AisleValues, id?: string) =>
      id
        ? commands.updateAisle(id, toAisle(values))
        : commands.createAisle(toAisle(values)),
    saveEntrance: (values: EntranceValues, id?: string) =>
      id
        ? commands.updateEntrance(id, toEntrance(values))
        : commands.createEntrance(toEntrance(values)),
    moveEntrance: (
      id: string,
      position: Pick<EntranceValues, "wall" | "offset" | "spaceId">,
    ) =>
      commands.updateEntrance(id, {
        ...position,
        requestId: crypto.randomUUID(),
      }),
    archive,
    restore,
    move,
    rotate,
  };
}
