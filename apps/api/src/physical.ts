import * as D from "./dto";
export const DEMO_PACKAGING: D.PackagingProfileDto = {
  boxWidthMm: 400,
  boxDepthMm: 400,
  boxHeightMm: 300,
  palletWidthMm: 1200,
  palletDepthMm: 800,
  palletBaseHeightMm: 150,
  boxesPerLayer: 6,
  maxLayers: 6,
  boxWeightKg: null,
  palletWeightKg: null,
};
export function packagingError(p: D.PackagingProfileDto): string | null {
  const straight =
    Math.floor(p.palletWidthMm / p.boxWidthMm) *
    Math.floor(p.palletDepthMm / p.boxDepthMm);
  const rotated =
    Math.floor(p.palletWidthMm / p.boxDepthMm) *
    Math.floor(p.palletDepthMm / p.boxWidthMm);
  return p.boxesPerLayer > Math.max(straight, rotated)
    ? "Заявленный слой коробов не помещается на поддон при прямоугольной укладке"
    : null;
}
export function finishedMetrics(profile: D.PackagingProfileDto, count: number) {
  return {
    widthMm: profile.palletWidthMm,
    depthMm: profile.palletDepthMm,
    heightMm:
      profile.palletBaseHeightMm +
      Math.ceil(count / profile.boxesPerLayer) * profile.boxHeightMm,
    weightKg:
      profile.palletWeightKg === null || profile.boxWeightKg === null
        ? null
        : profile.palletWeightKg + count * profile.boxWeightKg,
  };
}
export function placementError(
  s: D.WorkspaceDto,
  l: D.LocationDto,
  p: Pick<
    D.PalletDto,
    "widthMm" | "depthMm" | "heightMm" | "weightKg" | "kind" | "quantity"
  >,
  ownPalletId?: string,
  ignoreMovementId?: string,
  ignorePutawayReservations = false,
): string | null {
  if (
    l.archived ||
    (l.sectionId &&
      s.sections.find((section) => section.id === l.sectionId)?.archived)
  )
    return "Адрес находится в архиве";
  if (l.blocked) return "Место заблокировано";
  if (
    s.pallets.some(
      (other) =>
        other.status === "stored" &&
        other.locationId === l.id &&
        other.id !== ownPalletId,
    )
  )
    return "Адрес занят физической паллетой, включая пустую";
  if (
    s.pallets.some(
      (other) =>
        other.status !== "retired" &&
        other.returnLocationId === l.id &&
        other.id !== ownPalletId,
    )
  )
    return "Адрес зарезервирован для возврата другой паллеты";
  if (
    s.movements.some(
      (m) =>
        m.id !== ignoreMovementId &&
        ["planned", "in_transit"].includes(m.status) &&
        m.toLocationId === l.id,
    )
  )
    return "Адрес зарезервирован перемещением";
  if (
    !ignorePutawayReservations &&
    (s.putawayTasks ?? []).some(
      (t) =>
        ["claimed", "in_transit"].includes(t.status) && t.toLocationId === l.id,
    )
  )
    return "Адрес зарезервирован размещением коробов";
  if (
    !(
      (p.widthMm <= l.availableWidthMm && p.depthMm <= l.availableDepthMm) ||
      (p.depthMm <= l.availableWidthMm && p.widthMm <= l.availableDepthMm)
    )
  )
    return "Паллета не помещается по ширине и глубине, включая поворот на 90°";
  if (p.heightMm > l.maxHeightMm) return "Паллета не помещается по высоте";
  if (
    l.maxWeightKg !== null &&
    (p.weightKg === null || p.weightKg > l.maxWeightKg + 1e-9)
  )
    return p.weightKg === null
      ? "Для этого места нужна известная масса паллеты"
      : "Превышена допустимая масса места";
  if (["finished", "assembly"].includes(p.kind) && p.quantity > l.maxBoxes)
    return "Превышена вместимость места в коробах";
  return null;
}

export function samePackaging(
  a: D.PackagingProfileDto | null,
  b: D.PackagingProfileDto,
) {
  return (
    a !== null &&
    (Object.keys(DEMO_PACKAGING) as Array<keyof D.PackagingProfileDto>).every(
      (key) => a[key] === b[key],
    )
  );
}

/** Conservative mixed-box grid on an immutable physical pallet base. */
export function assemblyMetrics(
  base: D.PackagingProfileDto,
  profiles: D.PackagingProfileDto[],
) {
  const quantity = profiles.length;
  if (!quantity)
    return {
      widthMm: base.palletWidthMm,
      depthMm: base.palletDepthMm,
      heightMm: base.palletBaseHeightMm,
      weightKg: base.palletWeightKg,
      quantity,
      capacity: base.boxesPerLayer * base.maxLayers,
      error: null as string | null,
    };
  const width = Math.max(...profiles.map((p) => p.boxWidthMm)),
    depth = Math.max(...profiles.map((p) => p.boxDepthMm)),
    height = Math.max(...profiles.map((p) => p.boxHeightMm));
  const grid = Math.max(
    Math.floor(base.palletWidthMm / width) *
      Math.floor(base.palletDepthMm / depth),
    Math.floor(base.palletWidthMm / depth) *
      Math.floor(base.palletDepthMm / width),
  );
  const bpl = Math.min(grid, ...profiles.map((p) => p.boxesPerLayer));
  const capacity = bpl * Math.min(...profiles.map((p) => p.maxLayers));
  const error =
    bpl < 1
      ? "Короб не помещается на фиксированном поддоне общей паллеты сборки"
      : quantity > capacity
        ? "Общая паллета сборки заполнена. Разместите короба через второстепенные задания"
        : null;
  return {
    widthMm: base.palletWidthMm,
    depthMm: base.palletDepthMm,
    heightMm:
      base.palletBaseHeightMm +
      (bpl ? Math.ceil(quantity / bpl) * height : height),
    weightKg:
      base.palletWeightKg === null ||
      profiles.some((p) => p.boxWeightKg === null)
        ? null
        : base.palletWeightKg +
          profiles.reduce((sum, p) => sum + p.boxWeightKg!, 0),
    quantity,
    capacity,
    error,
  };
}

/** Project capacity including all claimed/carried incoming boxes, excluding only this command's own reservation. */
export function putawayPlacementError(
  s: D.WorkspaceDto,
  l: D.LocationDto,
  box: D.BoxDto,
  ignoreTaskId?: string,
): string | null {
  if (!["rack", "floor"].includes(l.kind))
    return "Для размещения нужен стеллаж или напольное место хранения";
  const pallet = s.pallets.find(
    (p) => p.status === "stored" && p.locationId === l.id,
  );
  const profile = box.packagingSnapshot;
  if (
    pallet &&
    (pallet.kind !== "finished" ||
      pallet.skuId !== box.skuId ||
      !samePackaging(pallet.packagingSnapshot, profile))
  )
    return "На адресе паллета другой тематики или профиля";
  if (
    pallet &&
    (pallet.returnLocationId ||
      s.movements.some(
        (m) =>
          m.palletId === pallet.id &&
          ["planned", "in_transit"].includes(m.status),
      ))
  )
    return "Паллета назначения участвует в перемещении или возврате";
  const incoming = (s.putawayTasks ?? []).filter(
    (t) =>
      t.id !== ignoreTaskId &&
      t.toLocationId === l.id &&
      ["claimed", "in_transit"].includes(t.status),
  );
  for (const task of incoming) {
    const incomingBox = s.boxes.find((b) => b.id === task.boxId);
    if (
      !incomingBox ||
      incomingBox.skuId !== box.skuId ||
      !samePackaging(incomingBox.packagingSnapshot, profile)
    )
      return "Адрес зарезервирован размещением другой тематики или профиля";
  }
  const quantity = (pallet?.quantity ?? 0) + incoming.length + 1;
  if (quantity > profile.boxesPerLayer * profile.maxLayers)
    return "Паллета назначения заполнена с учётом входящих коробов";
  return placementError(
    s,
    l,
    { ...finishedMetrics(profile, quantity), kind: "finished", quantity },
    pallet?.id,
    undefined,
    true,
  );
}
