import type {
  MarketplacePlanDto,
  MarketplacePlanRowDto,
} from "@/entities/assembly-plan";
import type { ForecastRowDto, ForecastSourceDto } from "@/entities/forecast";

const dispatchDates = ["2026-11-21", "2026-11-28", "2026-12-05", "2026-12-12"];
const salesWeeks = [
  ["2026-11-16", "2026-11-22"],
  ["2026-11-23", "2026-11-29"],
  ["2026-11-30", "2026-12-06"],
  ["2026-12-07", "2026-12-13"],
  ["2026-12-14", "2026-12-15"],
] as const;
const providers = ["wildberries", "ozon"] as const;
const advice = {
  ready: {
    state: "ready",
    action: "create",
    message: "Сырья и упаковки достаточно.",
  },
  covered: {
    state: "covered",
    action: "none",
    message: "Хватит готовых коробов.",
  },
  raw_shortage: {
    state: "raw_shortage",
    action: "receiving",
    message: "На складе не хватает сырья, чтобы собрать все короба по плану.",
  },
  raw_movement: {
    state: "raw_movement",
    action: "movements",
    message: "Сырьё числится на складе, но паллета ещё в пути.",
  },
  review: {
    state: "review",
    action: "transit",
    message: "По Ozon пока нет подтверждённых данных о поставках в пути.",
  },
} satisfies Record<
  MarketplacePlanRowDto["advice"]["state"],
  MarketplacePlanRowDto["advice"]
>;

type DemoProduct = {
  id: string;
  name: string;
  unitsPerBox?: number;
  state: keyof typeof advice;
  sales: [wb: number, ozon: number];
  stock: [wb: number, ozon: number];
  transit: [wb: number, ozon: number | null];
  send: [number, number, number, number];
  local: number;
  inAssembly?: number;
  scenario?: boolean;
};

const products: DemoProduct[] = [
  {
    id: "fantasy",
    name: "Фэнтези",
    state: "ready",
    sales: [524, 712],
    stock: [156, 240],
    transit: [80, 120],
    send: [18, 16, 12, 9],
    local: 24,
    inAssembly: 3,
  },
  {
    id: "cats",
    name: "Котики-2",
    state: "ready",
    sales: [602, 551],
    stock: [350, 231],
    transit: [0, 160],
    send: [11, 14, 12, 8],
    local: 32,
    inAssembly: 2,
  },
  {
    id: "new-year",
    name: "Новый год",
    state: "ready",
    sales: [918, 679],
    stock: [51, 104],
    transit: [200, 320],
    send: [20, 19, 16, 11],
    local: 18,
    inAssembly: 4,
    scenario: true,
  },
  {
    id: "anime",
    name: "Аниме",
    state: "ready",
    sales: [330, 406],
    stock: [154, 190],
    transit: [60, 100],
    send: [6, 8, 4, 6],
    local: 16,
  },
  {
    id: "landscapes",
    name: "Пейзажи-2",
    state: "ready",
    sales: [389, 348],
    stock: [98, 156],
    transit: [0, 80],
    send: [12, 6, 5, 4],
    local: 19,
  },
  {
    id: "animals",
    name: "Животные",
    state: "raw_movement",
    sales: [388, 502],
    stock: [147, 318],
    transit: [40, 0],
    send: [8, 7, 6, 5],
    local: 20,
    inAssembly: 1,
  },
  {
    id: "dogs",
    name: "Собачки",
    state: "raw_shortage",
    sales: [221, 375],
    stock: [43, 58],
    transit: [60, 40],
    send: [9, 6, 7, 4],
    local: 10,
  },
  {
    id: "forest",
    name: "Загадочный лес",
    state: "raw_shortage",
    sales: [143, 205],
    stock: [35, 62],
    transit: [20, 0],
    send: [6, 4, 3, 2],
    local: 8,
  },
  {
    id: "flowers",
    name: "Цветы",
    state: "covered",
    sales: [149, 224],
    stock: [214, 287],
    transit: [20, 60],
    send: [0, 3, 0, 2],
    local: 12,
  },
  {
    id: "food",
    name: "Еда",
    state: "covered",
    sales: [132, 117],
    stock: [281, 194],
    transit: [0, 0],
    send: [0, 0, 0, 0],
    local: 19,
  },
  {
    id: "mandalas",
    name: "Мандалы",
    state: "review",
    sales: [168, 195],
    stock: [30, 52],
    transit: [20, null],
    send: [0, 0, 0, 0],
    local: 4,
  },
  {
    id: "markers",
    name: "Акриловые маркеры · 168 цветов",
    unitsPerBox: 8,
    state: "review",
    sales: [55, 96],
    stock: [23, 34],
    transit: [0, null],
    send: [0, 0, 0, 0],
    local: 8,
  },
];

const sum = (values: number[]) =>
  values.reduce((total, value) => total + value, 0);
const split = (total: number, share: number) => {
  const first = Math.round(total * share);
  return [first, total - first] as const;
};

function demoRow(product: DemoProduct): MarketplacePlanRowDto {
  const unitsPerBox = product.unitsPerBox ?? 20;
  const dataComplete = product.state !== "review";
  const recommendedBoxes = Math.max(
    0,
    sum(product.send) - product.local - (product.inAssembly ?? 0),
  );
  const expectedSalesUnits30 = sum(product.sales);
  const readyUnits = product.local * unitsPerBox;
  const openTaskUnits = (product.inAssembly ?? 0) * unitsPerBox;
  const weeklyDispatches = dispatchDates.map((date, index) => {
    const boxes = product.send[index] ?? 0;
    const byProvider = split(boxes, product.sales[0] / expectedSalesUnits30);
    return {
      date,
      boxes,
      units: boxes * unitsPerBox,
      providers: providers.map((provider, index) => ({
        provider,
        boxes: byProvider[index] ?? 0,
        units: (byProvider[index] ?? 0) * unitsPerBox,
      })),
    };
  });
  const demandWeights = product.scenario
    ? [0, 5, 11, 18, 27, 30]
    : [0, 7, 14, 21, 28, 30];
  const weeklySales = salesWeeks.map(([from, to], index) => {
    const estimates = providers.map((provider, providerIndex) => {
      const total = product.sales[providerIndex] ?? 0;
      const prev = demandWeights[index]!;
      const next = demandWeights[index + 1]!;
      return {
        provider,
        units:
          Math.round((total * next) / 30) - Math.round((total * prev) / 30),
        known: true,
      };
    });
    return {
      from,
      to,
      providers: estimates,
      units: sum(estimates.map((row) => row.units)),
    };
  });
  const marketplaceUnits = sum(product.stock);
  const inTransitUnits =
    product.transit[1] === null
      ? null
      : product.transit[0] + product.transit[1];
  const outboundBoxes = product.send[0];
  const outboundUnits = outboundBoxes * unitsPerBox;
  const monthlyOutboundBoxes = sum(product.send);
  const monthlyOutboundUnits = monthlyOutboundBoxes * unitsPerBox;
  const recommendedUnits = recommendedBoxes * unitsPerBox;
  const rawAvailableUnits =
    product.state === "raw_shortage"
      ? Math.floor(recommendedBoxes / 3) * unitsPerBox
      : Math.max(4, recommendedBoxes + 8) * unitsPerBox;
  const localAfterPlannedDispatchUnits = Math.max(
    0,
    readyUnits - monthlyOutboundUnits,
  );
  const inBacklog = product.state === "covered";

  return {
    skuId: product.id,
    skuName: product.name,
    unitsPerBox,
    dataComplete,
    advice: advice[product.state],
    expectedSalesUnits30,
    salesForecastKnown: true,
    weeklyDispatches,
    weeklySales,
    providers: providers.map((provider, index) => {
      const dispatchBoxes = weeklyDispatches[0]?.providers[index]?.boxes ?? 0;
      const known = product.transit[index] != null;
      const sales = product.sales[index] ?? 0;
      return {
        provider,
        expectedSalesUnits30: sales,
        salesForecastKnown: true,
        averageDailyUnits: sales / 30,
        targetUnits: Math.round((sales * 28) / 30),
        marketplaceUnits: product.stock[index] ?? 0,
        inTransitUnits: product.transit[index] ?? null,
        dispatchBoxes,
        dispatchUnits: dispatchBoxes * unitsPerBox,
        dataComplete: known,
        methodLabel: "Демопрогноз",
        confidenceLabel: product.scenario
          ? "Предварительная оценка"
          : "Демоданные",
        scenario: !!product.scenario,
      };
    }),
    outboundBoxes,
    outboundUnits,
    newOutboundBoxes: outboundBoxes,
    newOutboundUnits: outboundUnits,
    monthlyOutboundBoxes,
    monthlyOutboundUnits,
    monthlyDispatchShortageUnits: Math.max(
      0,
      monthlyOutboundUnits - readyUnits,
    ),
    localAfterDispatchUnits: Math.max(0, readyUnits - outboundUnits),
    dispatchShortageUnits: Math.max(0, outboundUnits - readyUnits),
    assemblyShortageUnits: Math.max(0, recommendedUnits - rawAvailableUnits),
    localAfterPlannedDispatchUnits,
    localAfterAssemblyUnits: Math.max(
      0,
      readyUnits + openTaskUnits + recommendedUnits - monthlyOutboundUnits,
    ),
    backlogRank: inBacklog ? (product.id === "flowers" ? 1 : 2) : null,
    backlogCanCreate: false,
    backlogBoxes: inBacklog ? 1 : 0,
    backlogUnits: inBacklog ? unitsPerBox : 0,
    backlogCapacityKnown: inBacklog,
    backlogReason: inBacklog
      ? "Есть место для одного дополнительного короба."
      : "",
    unregisteredUnits: 0,
    stockConfirmedAt: null,
    stockEstimated: false,
    averageDailyUnits: expectedSalesUnits30 / 30,
    targetUnits: Math.round((expectedSalesUnits30 * 28) / 30),
    marketplaceUnits,
    inTransitUnits,
    inboundSource: inTransitUnits === null ? "unknown" : "api",
    inboundSources: [],
    readyUnits,
    shippingReadyUnits: readyUnits,
    shipmentReservedUnits: 0,
    openTaskUnits,
    rawAvailableUnits,
    recommendedUnits,
    recommendedBoxes,
    canCreate: false,
    blockers: [],
    warnings: [],
    proposalHash: "",
  };
}

export const demoPlan: MarketplacePlanDto = {
  preparationDays: 30,
  preparationThrough: "2026-12-15",
  backlogMessage: "Нет товаров для сборки впрок.",
  dispatchDate: "2026-11-21",
  leadDays: 7,
  horizonDays: 28,
  safetyDays: 0,
  generatedAt: "2026-11-16T06:00:00Z",
  rows: products.map(demoRow),
  warnings: [],
};

const forecastFrom = salesWeeks[0][0];
const historyDays = 90;
const dayMs = 86_400_000;
const weekdayWeights = [0.83, 0.94, 1.04, 0.97, 1.08, 1.26, 0.88];

function shiftDay(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * dayMs)
    .toISOString()
    .slice(0, 10);
}

function demoForecastSource(
  row: MarketplacePlanRowDto,
  source: MarketplacePlanRowDto["providers"][number],
  productIndex: number,
  providerIndex: number,
): ForecastSourceDto {
  const dailyLevel = source.averageDailyUnits;
  const history = Array.from({ length: historyDays }, (_, index) => {
    const date = shiftDay(forecastFrom, index - historyDays);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const variation =
      weekdayWeights[weekday]! +
      0.19 * Math.sin(index * 1.45 + productIndex + providerIndex);
    const season = source.scenario ? 0.48 + (index / historyDays) * 0.52 : 0.86;
    const expected = Math.round(dailyLevel * weekdayWeights[weekday]! * season);
    return {
      date,
      actual: Math.max(0, Math.round(dailyLevel * variation * season)),
      predicted: index >= historyDays - 14 ? expected : null,
      ...(index >= historyDays - 14
        ? { predictedAt: `${shiftDay(date, -7)}T06:00:00Z` }
        : {}),
    };
  });
  const future = row.weeklySales.flatMap((week) => {
    const providerWeek = week.providers.find(
      (item) => item.provider === source.provider,
    );
    const units = providerWeek?.units ?? 0;
    const days =
      Math.round((Date.parse(week.to) - Date.parse(week.from)) / dayMs) + 1;
    const weights = weekdayWeights.slice(0, days);
    const totalWeight = sum(weights);
    let cumulative = 0;
    return weights.map((weight, index) => {
      const previous = Math.round((units * cumulative) / totalWeight);
      cumulative += weight;
      return {
        date: shiftDay(week.from, index),
        actual: null,
        predicted: Math.round((units * cumulative) / totalWeight) - previous,
        predictedAt: demoPlan.generatedAt,
      };
    });
  });
  return {
    provider: source.provider,
    forecastFrom,
    metricLabel: "Заказы за вычетом отмен",
    modelLabel: source.scenario ? "Сезонный сценарий" : "Недавний спрос",
    predictedUnits: source.expectedSalesUnits30,
    historyDays,
    candidates: [],
    points: [...history, ...future],
  };
}

export const demoForecastRows: ForecastRowDto[] = [...demoPlan.rows]
  .sort((left, right) => right.expectedSalesUnits30 - left.expectedSalesUnits30)
  .map((row, index) => {
    const seasonal = row.providers.some((source) => source.scenario);
    return {
      skuId: row.skuId,
      skuName: row.skuName,
      minimumBoxes: 0,
      seasonalityEnabled: seasonal,
      seasonalityApplied: seasonal,
      targetUnits: row.targetUnits,
      methodLabel: seasonal ? "Сезонный сценарий" : "Недавний спрос",
      confidenceLabel: "Демоданные",
      message: "",
      historyFrom: shiftDay(forecastFrom, -historyDays),
      historyTo: shiftDay(forecastFrom, -1),
      knownDays: historyDays,
      sources: row.providers.map((source, providerIndex) =>
        demoForecastSource(row, source, index, providerIndex),
      ),
    };
  });
