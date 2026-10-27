import type * as D from "../dto";
import { assemblyMetrics, packagingError, placementError } from "../physical";
import { activeZoneLocation, canonicalAssemblyLocation } from "../work-zones";

export interface AssemblyPressure {
  level: "normal" | "near_full" | "full" | "unavailable";
  locationId: string | null;
  palletId: string | null;
  /** Physically stored boxes; boxes already carried away no longer occupy it. */
  boxes: number;
  /** One reserved slot for each confirmed/scanned unfinished open box. */
  committedBoxes: number;
  /** Effective total capacity for another ordinary box of the current profile. */
  capacityBoxes: number | null;
  message: string;
}

type Profile = D.PackagingProfileDto;
interface Context {
  location: D.LocationDto;
  pallet: D.PalletDto | null;
  base: Profile;
  profiles: Profile[];
  boxes: number;
  committedBoxes: number;
}
interface ContextResult {
  context: Context | null;
  locationId: string | null;
  palletId: string | null;
  boxes: number;
  committedBoxes: number;
  error: string | null;
}
const positive = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0;

function profileError(profile: Profile | null | undefined): string | null {
  if (
    !profile ||
    ![
      profile.boxWidthMm,
      profile.boxDepthMm,
      profile.boxHeightMm,
      profile.palletWidthMm,
      profile.palletDepthMm,
      profile.palletBaseHeightMm,
      profile.boxesPerLayer,
      profile.maxLayers,
    ].every(positive) ||
    !Number.isInteger(profile.boxesPerLayer) ||
    !Number.isInteger(profile.maxLayers) ||
    (profile.boxWeightKg !== null && !positive(profile.boxWeightKg)) ||
    (profile.palletWeightKg !== null && !positive(profile.palletWeightKg))
  )
    return "Для сборки нужно настроить размеры коробов и поддона";
  return packagingError(profile);
}

function committedTasks(state: D.WorkspaceDto, excludeTaskId?: string) {
  return state.tasks
    .filter(
      (task) =>
        task.id !== excludeTaskId &&
        ["active", "paused"].includes(task.status) &&
        task.boxesCompleted < task.boxesTarget &&
        (task.boxCodeConfirmed ||
          task.scannedUnits > 0 ||
          task.openBoxContents.length > 0),
    )
    .sort(
      (a, b) =>
        (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
        a.code.localeCompare(b.code) ||
        a.id.localeCompare(b.id),
    );
}

function contextFor(
  state: D.WorkspaceDto,
  candidate?: Profile,
  excludeTaskId?: string,
): ContextResult {
  const locationId = canonicalAssemblyLocation(state);
  const storedPallets = state.pallets.filter(
    (pallet) => pallet.kind === "assembly" && pallet.status === "stored",
  );
  const pallet =
    storedPallets.find((item) => item.locationId === locationId) ?? null;
  const physicalBoxes = pallet
    ? state.boxes.filter(
        (box) => box.palletId === pallet.id && box.status === "stored",
      )
    : [];
  const tasks = committedTasks(state, excludeTaskId);
  const result: ContextResult = {
    context: null,
    locationId,
    palletId: pallet?.id ?? null,
    boxes: physicalBoxes.length,
    committedBoxes: tasks.length,
    error: null,
  };
  const reject = (error: string) => ({ ...result, error });
  if (!locationId)
    return reject(
      "Создайте или освободите место типа «Сборка» на карте склада",
    );
  const location = activeZoneLocation(state, locationId);
  if (
    !location ||
    location.kind !== "assembly" ||
    (location.sectionId &&
      !state.sections.some((section) => section.id === location.sectionId))
  )
    return reject(
      "Место общей паллеты сборки недоступно или находится в архиве",
    );
  if (location.blocked)
    return reject("Место общей паллеты сборки заблокировано");
  if (
    ![
      location.availableWidthMm,
      location.availableDepthMm,
      location.maxHeightMm,
      location.maxBoxes,
    ].every(positive) ||
    !Number.isInteger(location.maxBoxes) ||
    (location.maxWeightKg !== null && !positive(location.maxWeightKg))
  )
    return reject("Для места сборки нужно настроить размеры и вместимость");
  if (storedPallets.length > 1)
    return reject("На складе обнаружено несколько общих паллет сборки");
  if (
    pallet &&
    (pallet.quantity !== physicalBoxes.length ||
      physicalBoxes.some((box) => box.locationId !== location.id))
  )
    return reject("Количество коробов общей паллеты требует проверки");
  const incoming = tasks.map(
    (task) => state.skus.find((sku) => sku.id === task.skuId)?.packaging,
  );
  const nextTaskProfile = state.tasks
    .filter(
      (task) =>
        ["queued", "active", "paused"].includes(task.status) &&
        task.boxesCompleted < task.boxesTarget,
    )
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((task) => state.skus.find((sku) => sku.id === task.skuId)?.packaging)
    .find(Boolean);
  const base = pallet
    ? pallet.packagingSnapshot
    : (candidate ??
      incoming[0] ??
      nextTaskProfile ??
      [...state.skus]
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((sku) => sku.packaging)
        .find((profile) => !profileError(profile)) ??
      null);
  const baseProblem = profileError(base);
  if (baseProblem) return reject(baseProblem);
  const profiles = [
    ...physicalBoxes.map((box) => box.packagingSnapshot),
    ...incoming,
  ];
  for (const profile of profiles) {
    const problem = profileError(profile);
    if (problem) return reject(problem);
  }
  const fixedBase = base!;
  if (
    pallet &&
    (pallet.widthMm !== fixedBase.palletWidthMm ||
      pallet.depthMm !== fixedBase.palletDepthMm)
  )
    return reject(
      "Размеры общей паллеты не совпадают с её сохранённым профилем",
    );
  const baseProblemAtLocation = placementError(
    state,
    location,
    { ...assemblyMetrics(fixedBase, []), kind: "assembly" },
    pallet?.id,
  );
  if (baseProblemAtLocation) return reject(baseProblemAtLocation);
  result.context = {
    location,
    pallet,
    base: fixedBase,
    profiles: profiles as Profile[],
    boxes: physicalBoxes.length,
    committedBoxes: tasks.length,
  };
  return result;
}

function acceptanceProblem(
  state: D.WorkspaceDto,
  context: Context,
  next: Profile,
) {
  const profiles = [...context.profiles, next];
  // Before a physical pallet exists, any confirmed box can finish first and
  // create its base. Legacy mixed base profiles must fit in both completion
  // orders; this never creates or persists an imaginary provisional pallet.
  const bases = context.pallet ? [context.base] : [context.base, ...profiles];
  const seen = new Set<string>();
  for (const base of bases) {
    const identity = [
      base.palletWidthMm,
      base.palletDepthMm,
      base.palletBaseHeightMm,
      base.palletWeightKg,
    ].join(":");
    if (seen.has(identity)) continue;
    seen.add(identity);
    const metrics = assemblyMetrics(base, profiles);
    const error =
      metrics.error ??
      placementError(
        state,
        context.location,
        { ...metrics, kind: "assembly" },
        context.pallet?.id,
      );
    if (error) return error;
  }
  return null;
}

/** Maximum TOTAL boxes preserving existing mixed profiles and adding this profile. */
function capacity(context: Context, next: Profile): number | null {
  const profiles = [...context.profiles, next];
  const width = Math.max(...profiles.map((profile) => profile.boxWidthMm));
  const depth = Math.max(...profiles.map((profile) => profile.boxDepthMm));
  const height = Math.max(...profiles.map((profile) => profile.boxHeightMm));
  const grid = Math.max(
    Math.floor(context.base.palletWidthMm / width) *
      Math.floor(context.base.palletDepthMm / depth),
    Math.floor(context.base.palletWidthMm / depth) *
      Math.floor(context.base.palletDepthMm / width),
  );
  const perLayer = Math.min(
    grid,
    ...profiles.map((profile) => profile.boxesPerLayer),
  );
  const layers = Math.min(
    Math.floor(
      (context.location.maxHeightMm - context.base.palletBaseHeightMm) / height,
    ),
    ...profiles.map((profile) => profile.maxLayers),
  );
  let result = Math.max(
    0,
    Math.min(context.location.maxBoxes, perLayer * layers),
  );
  if (context.location.maxWeightKg !== null) {
    if (
      context.base.palletWeightKg === null ||
      profiles.some((profile) => profile.boxWeightKg === null)
    )
      return null;
    const currentWeight =
      context.base.palletWeightKg +
      context.profiles.reduce((sum, profile) => sum + profile.boxWeightKg!, 0);
    const additional = Math.floor(
      (context.location.maxWeightKg - currentWeight + 1e-9) / next.boxWeightKg!,
    );
    result = Math.min(
      result,
      Math.max(0, context.profiles.length + additional),
    );
  }
  return result;
}

/** Read-only physical pressure; does not create pallets, labels, work or stock. */
export function assemblyPressure(state: D.WorkspaceDto): AssemblyPressure {
  const result = contextFor(state);
  const { context, error, ...identity } = result;
  if (!context)
    return {
      ...identity,
      level: "unavailable",
      capacityBoxes: null,
      message: error!,
    };
  const capacityBoxes = capacity(context, context.base);
  if (capacityBoxes === null)
    return {
      ...identity,
      level: "unavailable",
      capacityBoxes: null,
      message:
        "Для места сборки с ограничением массы нужно указать массу коробов",
    };
  const problem = acceptanceProblem(state, context, context.base);
  if (problem)
    return {
      ...identity,
      level: "full",
      capacityBoxes,
      message:
        context.boxes === 0
          ? "Все места заняты начатыми коробами. Дождитесь свободного места"
          : "Общая паллета сборки заполнена. Сначала разместите готовые короба",
    };
  const nearFull =
    capacityBoxes > 0 &&
    (context.boxes + context.committedBoxes) / capacityBoxes >= 0.8;
  return {
    ...identity,
    level: nearFull ? "near_full" : "normal",
    capacityBoxes,
    message: nearFull
      ? context.boxes === 0
        ? "На общей паллете сборки осталось мало свободного места"
        : "На общей паллете сборки мало места. Разместите готовые короба"
      : "На общей паллете сборки есть место",
  };
}

/**
 * Called under the warehouse command lock BEFORE confirming a new open box.
 * At finalization exclude this task's own already counted slot, then add its box
 * once. Other active/paused open boxes retain their reservations throughout.
 */
export function assemblyAcceptanceError(
  state: D.WorkspaceDto,
  skuId: string,
  excludeTaskId?: string,
): string | null {
  const profile = state.skus.find((sku) => sku.id === skuId)?.packaging;
  const problem = profileError(profile);
  if (problem) return problem;
  const result = contextFor(state, profile, excludeTaskId);
  if (!result.context) return result.error;
  const error = acceptanceProblem(state, result.context, profile!);
  if (error && result.context.boxes === 0 && result.context.committedBoxes > 0)
    return "Все места заняты начатыми коробами. Дождитесь свободного места";
  return error
    ? `${error}. Сначала разместите готовые короба с общей паллеты сборки`
    : null;
}
