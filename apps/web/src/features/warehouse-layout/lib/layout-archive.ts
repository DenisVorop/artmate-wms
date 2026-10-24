import type { WorkspaceDto } from "@/shared/api/generated/model";

export function archiveReasons(
  data: WorkspaceDto,
  addressIds: string[],
): string[] {
  const ids = new Set(addressIds);
  const reasons: string[] = [];
  const pallets = data.pallets.filter(
    (pallet) =>
      pallet.status === "stored" &&
      pallet.locationId &&
      ids.has(pallet.locationId),
  );
  if (pallets.length)
    reasons.push(
      `На адресе стоит паллета: ${pallets.map((pallet) => pallet.code).join(", ")}. Пустой поддон тоже занимает место.`,
    );
  if (
    data.boxes.some(
      (box) =>
        box.status === "stored" && box.locationId && ids.has(box.locationId),
    )
  )
    reasons.push("По адресу хранятся готовые короба.");
  const returns = data.pallets.filter(
    (pallet) =>
      pallet.status !== "retired" &&
      pallet.returnLocationId &&
      ids.has(pallet.returnLocationId),
  );
  if (returns.length)
    reasons.push(
      `Адрес удерживается для возврата: ${returns.map((pallet) => pallet.code).join(", ")}.`,
    );
  const movements = data.movements.filter(
    (movement) =>
      ["planned", "in_transit"].includes(movement.status) &&
      (ids.has(movement.fromLocationId) || ids.has(movement.toLocationId)),
  );
  if (movements.length)
    reasons.push(
      `Источник или цель незавершённого перемещения: ${movements.map((movement) => movement.code).join(", ")}.`,
    );
  const putaways = data.putawayTasks.filter(
    (task) =>
      ["claimed", "in_transit"].includes(task.status) &&
      task.toLocationId !== null &&
      ids.has(task.toLocationId),
  );
  if (putaways.length)
    reasons.push(
      `Цель размещения коробов зарезервирована: ${putaways.map((task) => task.code).join(", ")}.`,
    );
  return reasons;
}

type TrashItem = {
  key: string;
  title: string;
  kind: string;
  description: string;
  archivedAt: string | null;
  restoreReason: string | null;
};
export function layoutTrashItems(data: WorkspaceDto): TrashItem[] {
  const sections: TrashItem[] = data.sections
    .filter((section) => section.archived)
    .map((section) => ({
      key: `section:${section.id}`,
      title: `${section.code} · ${section.name}`,
      kind: "Секция стеллажа",
      description: `Активные при удалении адреса: ${section.archivedLocationIds.length}. Прежние QR сохранятся.`,
      archivedAt: section.archivedAt,
      restoreReason: null,
    }));
  const addresses: TrashItem[] = data.locations
    .filter((location) => {
      if (!location.archived) return false;
      const section = data.sections.find(
        (item) => item.id === location.sectionId,
      );
      return (
        !section?.archived || !section.archivedLocationIds.includes(location.id)
      );
    })
    .map((location) => {
      const section = data.sections.find(
        (item) => item.id === location.sectionId,
      );
      return {
        key: `location:${location.id}`,
        title: `${location.code} · ${location.name}`,
        kind: section ? "Адрес яруса" : "Адрес хранения",
        description: section
          ? `Ярус ${location.level} секции ${section.code}. QR адреса сохранится.`
          : "Адрес и прежний QR сохранены.",
        archivedAt: location.archivedAt,
        restoreReason: section?.archived
          ? `Сначала восстановите секцию ${section.code}.`
          : null,
      };
    });
  const aisles: TrashItem[] = data.aisles
    .filter((aisle) => aisle.archived)
    .map((aisle) => ({
      key: `aisle:${aisle.id}`,
      title: aisle.name,
      kind: "Проход",
      description:
        "Будет восстановлен на прежнем месте и с прежними размерами.",
      archivedAt: aisle.archivedAt,
      restoreReason: null,
    }));
  const entrances: TrashItem[] = data.entrances
    .filter((entrance) => entrance.archived)
    .map((entrance) => ({
      key: `entrance:${entrance.id}`,
      title: entrance.name,
      kind: "Вход",
      description: "Будет восстановлен проём на прежней стене.",
      archivedAt: entrance.archivedAt,
      restoreReason:
        entrance.spaceId &&
        !data.warehouse.spaces.some(
          (space) => space.id === entrance.spaceId && !space.archived,
        )
          ? "Сначала восстановите участок, к которому привязан вход."
          : null,
    }));
  const spaces: TrashItem[] = data.warehouse.spaces
    .filter((space) => space.archived)
    .map((space) => ({
      key: `space:${space.id}`,
      title: space.name,
      kind: space.kind === "room" ? "Помещение" : "Коридор",
      description: `Участок ${space.width} × ${space.depth} м будет восстановлен на прежнем месте.`,
      archivedAt: space.archivedAt,
      restoreReason: null,
    }));
  return [...sections, ...addresses, ...aisles, ...entrances, ...spaces].sort(
    (a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""),
  );
}
