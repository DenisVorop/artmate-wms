import { WorkspaceDto, BoxDto } from "./dto";
export function seedWorkspace(): any {
  const skus = [
    {
      id: "sku-cats",
      code: "CAT-02",
      name: "Котики-2",
      barcode: "4601234000011",
      unitsPerBox: 20,
      color: "#a692ff",
    },
    {
      id: "sku-space",
      code: "COS-01",
      name: "Космос",
      barcode: "4601234000028",
      unitsPerBox: 20,
      color: "#77d9ee",
    },
    {
      id: "sku-dinos",
      code: "DINO-03",
      name: "Динозавры",
      barcode: "4601234000035",
      unitsPerBox: 20,
      color: "#a8e688",
    },
    {
      id: "sku-flowers",
      code: "FLW-01",
      name: "Цветочный сад",
      barcode: "4601234000042",
      unitsPerBox: 20,
      color: "#ffb28e",
    },
  ];
  const locations: any[] = [];
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 4; col++)
      locations.push({
        id: `loc-${row * 4 + col + 1}`,
        code: `${["A", "B", "C"][row]}-${String(col + 1).padStart(2, "0")}-01`,
        name: `Стеллаж ${["A", "B", "C"][row]} · Секция ${col + 1}`,
        kind: "rack",
        x: 2 + col * 5,
        y: 2 + row * 3.5,
        width: 3,
        depth: 2,
        levels: 1,
        maxHeightMm: row === 2 ? 1000 : 2200,
        maxBoxes: row === 2 ? 12 : 24,
        blocked: false,
      });
  locations.push(
    {
      id: "loc-receiving",
      code: "IN-01",
      name: "Приёмка",
      kind: "receiving",
      x: 2,
      y: 13,
      width: 3,
      depth: 2,
      levels: 1,
      maxHeightMm: 2500,
      maxBoxes: 36,
      blocked: false,
    },
    {
      id: "loc-assembly",
      code: "PACK-01",
      name: "Зона сборки 1",
      kind: "assembly",
      x: 8,
      y: 13,
      width: 3,
      depth: 2,
      levels: 1,
      maxHeightMm: 2200,
      maxBoxes: 24,
      blocked: false,
    },
    {
      id: "loc-assembly-2",
      code: "PACK-02",
      name: "Зона сборки 2",
      kind: "assembly",
      x: 14,
      y: 13,
      width: 3,
      depth: 2,
      levels: 1,
      maxHeightMm: 2200,
      maxBoxes: 24,
      blocked: false,
    },
    {
      id: "loc-shipping",
      code: "OUT-01",
      name: "Зона отгрузки",
      kind: "shipping",
      x: 20,
      y: 13,
      width: 3,
      depth: 2,
      levels: 1,
      maxHeightMm: 2500,
      maxBoxes: 36,
      blocked: false,
    },
  );
  const lots = skus.flatMap((sku, index) => [
    {
      id: `lot-${index}-old`,
      skuId: sku.id,
      receivedAt: "2026-10-18T09:00:00.000Z",
      name: `Поставка 18.10 · ${sku.name}`,
    },
    {
      id: `lot-${index}-new`,
      skuId: sku.id,
      receivedAt: "2026-10-22T09:00:00.000Z",
      name: `Поставка 22.10 · ${sku.name}`,
    },
  ]);
  const pallets: any[] = skus.map((sku, index) => ({
    id: `pallet-raw-${index}`,
    code: `PLT-00${index + 1}`,
    skuId: sku.id,
    lotId: `lot-${index}-old`,
    quantity: [30, 520, 780, 340][index],
    locationId: `loc-${index + 1}`,
    kind: "raw",
    heightMm: 1400,
  }));
  pallets.push({
    id: "pallet-cats-new",
    code: "PLT-005",
    skuId: "sku-cats",
    lotId: "lot-0-new",
    quantity: 1000,
    locationId: "loc-5",
    kind: "raw",
    heightMm: 1700,
  });
  const boxes: any[] = [];
  skus.forEach((sku, index) => {
    const palletId = `pallet-finished-${index}`;
    const boxCount = [12, 18, 8, 6][index];
    const locationId = `loc-${index + 6}`;
    pallets.push({
      id: palletId,
      code: `FG-00${index + 1}`,
      skuId: sku.id,
      lotId: null,
      quantity: boxCount,
      locationId,
      kind: "finished",
      heightMm: Math.ceil(boxCount / 6) * 300 + 150,
    });
    for (let b = 0; b < boxCount; b++)
      boxes.push({
        id: `box-${index}-${b}`,
        code: `BOX-${String(index * 100 + b + 1).padStart(5, "0")}`,
        skuId: sku.id,
        units: 20,
        lotContents: [{ lotId: `lot-${index}-old`, quantity: 20 }],
        packedAt: `2026-10-22T${String(8 + Math.floor(b / 12)).padStart(2, "0")}:${String((b * 5) % 60).padStart(2, "0")}:00.000Z`,
        locationId,
        palletId,
        status: "stored",
      });
  });
  return {
    skus,
    locations,
    lots,
    pallets,
    boxes,
    tasks: [],
    shipments: [],
    employees: [
      {
        id: "employee-1",
        name: "Анна Морозова",
        initials: "АМ",
        role: "Сборщик",
        status: "working",
        boxesToday: 0,
        unitsToday: 0,
      },
      {
        id: "employee-2",
        name: "Дмитрий Волков",
        initials: "ДВ",
        role: "Сборщик",
        status: "working",
        boxesToday: 0,
        unitsToday: 0,
      },
      {
        id: "employee-3",
        name: "Мария Ким",
        initials: "МК",
        role: "Приёмщик",
        status: "working",
        boxesToday: 0,
        unitsToday: 0,
      },
      {
        id: "employee-4",
        name: "Алексей Орлов",
        initials: "АО",
        role: "Кладовщик",
        status: "off",
        boxesToday: 0,
        unitsToday: 0,
      },
    ],
    activities: [
      {
        id: "activity-seed",
        title: "Склад готов к работе",
        description:
          "Демонстрационные остатки загружены. Каждая паллета содержит одну тематику.",
        createdAt: "2026-10-23T07:00:00.000Z",
        kind: "system",
      },
    ],
  };
}
