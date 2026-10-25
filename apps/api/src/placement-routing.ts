import type * as D from "./dto";
import { footprint, globalDoorSegment } from "./layout";

export type PlacementRoute = {
  status: "aisles" | "floor" | "unreachable" | "unknown";
  distanceMeters: number | null;
  note: string;
};
type Plan = Pick<
  D.WorkspaceDto,
  "warehouse" | "locations" | "sections" | "aisles" | "entrances"
>;
type Rect = { x: number; y: number; width: number; depth: number };
type Point = { x: number; y: number };
type Block = Rect & { key: string; owner: number };
type Room = Rect & {
  id: string;
  floor: boolean;
  restricted: boolean;
  aisles: Rect[];
  blocks: Block[];
  cells: Cell[];
};
type Cell = Rect & { nodes: [number, number, number, number] };
type Door = { a: number; b: number; points: Point[] };
type Edge = { to: number; distance: number };
type Node = { edges: Edge[]; floor: boolean };
type Attachment = { node: number; distance: number };
const EPS = 1e-8;

/** Only the short, unobstructed access between an address/door and a drawn aisle. */
export const MAX_LOCAL_ACCESS_METERS = 2;
/** Hard limits apply to the entire multi-target calculation, never per candidate. */
export const PLACEMENT_ROUTING_LIMITS = {
  candidates: 1000,
  objects: 10000,
  cells: 12000,
  nodes: 60000,
  checks: 2000000,
} as const;
class RoutingLimit extends Error {}
class Budget {
  private _checks = 0;
  cells = 0;
  check() {
    if (++this._checks > PLACEMENT_ROUTING_LIMITS.checks)
      throw new RoutingLimit();
  }
  cell() {
    if (++this.cells > PLACEMENT_ROUTING_LIMITS.cells) throw new RoutingLimit();
  }
}
const unknown = (note: string): PlacementRoute => ({
  status: "unknown",
  distanceMeters: null,
  note,
});
const unreachable = (): PlacementRoute => ({
  status: "unreachable",
  distanceMeters: null,
  note: "По отмеченным проходам и дверям маршрут не найден",
});
const validRect = (r: Rect) =>
  [r.x, r.y, r.width, r.depth].every(Number.isFinite) &&
  r.width > EPS &&
  r.depth > EPS;
const contains = (a: Rect, b: Rect) =>
  b.x >= a.x - EPS &&
  b.y >= a.y - EPS &&
  b.x + b.width <= a.x + a.width + EPS &&
  b.y + b.depth <= a.y + a.depth + EPS;
const overlaps = (a: Rect, b: Rect) =>
  Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) + EPS &&
  Math.min(a.y + a.depth, b.y + b.depth) > Math.max(a.y, b.y) + EPS;
const within = (v: number, lo: number, hi: number) =>
  v >= lo - EPS && v <= hi + EPS;
const sameRect = (a: Rect, b: Rect) =>
  (Object.keys(a) as (keyof Rect)[])
    .filter((k) => ["x", "y", "width", "depth"].includes(k))
    .every((k) => Math.abs(a[k] - b[k]) < EPS);
const corners = (r: Rect): Point[] => [
  { x: r.x, y: r.y },
  { x: r.x + r.width, y: r.y },
  { x: r.x + r.width, y: r.y + r.depth },
  { x: r.x, y: r.y + r.depth },
];
const distance = (a: Point, b: Point) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
function coordinates(values: number[]) {
  return values
    .sort((a, b) => a - b)
    .filter((v, i, all) => i === 0 || v - all[i - 1] > EPS);
}
function owner(rooms: Room[], rect: Rect): number {
  const indices = rooms.flatMap((r, i) => (contains(r, rect) ? [i] : []));
  return indices.length === 1 ? indices[0] : -1;
}
function addEdge(nodes: Node[], a: number, b: number, length: number) {
  nodes[a].edges.push({ to: b, distance: length });
  nodes[b].edges.push({ to: a, distance: length });
}

/** Independent corner nodes are joined only across a positive-length cell edge.
 * In particular, diagonally touching cells cannot squeeze through a blocked corner.
 */
function buildRoom(room: Room, nodes: Node[], budget: Budget) {
  const rects = [...room.blocks, ...room.aisles];
  const xs = coordinates([
    room.x,
    room.x + room.width,
    ...rects.flatMap((r) => [r.x, r.x + r.width]),
  ]);
  const ys = coordinates([
    room.y,
    room.y + room.depth,
    ...rects.flatMap((r) => [r.y, r.y + r.depth]),
  ]);
  // Bounding work is also necessary for completely blocked/empty grids.
  if ((xs.length - 1) * (ys.length - 1) > PLACEMENT_ROUTING_LIMITS.cells)
    throw new RoutingLimit();
  const grid = new Map<number, Cell>();
  const inside = (r: Rect, p: Point) => {
    budget.check();
    return (
      p.x > r.x + EPS &&
      p.x < r.x + r.width - EPS &&
      p.y > r.y + EPS &&
      p.y < r.y + r.depth - EPS
    );
  };
  for (let j = 0; j < ys.length - 1; j++)
    for (let i = 0; i < xs.length - 1; i++) {
      budget.cell();
      const mid = { x: (xs[i] + xs[i + 1]) / 2, y: (ys[j] + ys[j + 1]) / 2 };
      if (
        (room.restricted && !room.aisles.some((r) => inside(r, mid))) ||
        room.blocks.some((r) => inside(r, mid))
      )
        continue;
      const base = nodes.length;
      if (base + 4 > PLACEMENT_ROUTING_LIMITS.nodes) throw new RoutingLimit();
      const cell: Cell = {
        x: xs[i],
        y: ys[j],
        width: xs[i + 1] - xs[i],
        depth: ys[j + 1] - ys[j],
        nodes: [base, base + 1, base + 2, base + 3],
      };
      nodes.push(...cell.nodes.map(() => ({ edges: [], floor: room.floor })));
      addEdge(nodes, base, base + 1, cell.width);
      addEdge(nodes, base + 1, base + 2, cell.depth);
      addEdge(nodes, base + 2, base + 3, cell.width);
      addEdge(nodes, base + 3, base, cell.depth);
      const left = grid.get(j * xs.length + i - 1);
      if (i && left) {
        addEdge(nodes, left.nodes[1], cell.nodes[0], 0);
        addEdge(nodes, left.nodes[2], cell.nodes[3], 0);
      }
      const above = grid.get((j - 1) * xs.length + i);
      if (j && above) {
        addEdge(nodes, above.nodes[3], cell.nodes[0], 0);
        addEdge(nodes, above.nodes[2], cell.nodes[1], 0);
      }
      grid.set(j * xs.length + i, cell);
      room.cells.push(cell);
    }
}

function segmentClear(room: Room, from: Point, to: Point, budget: Budget) {
  if (
    !within(from.x, room.x, room.x + room.width) ||
    !within(to.x, room.x, room.x + room.width) ||
    !within(from.y, room.y, room.y + room.depth) ||
    !within(to.y, room.y, room.y + room.depth)
  )
    return false;
  const horizontal = Math.abs(from.y - to.y) < EPS;
  const clear = (a: Point, b: Point) =>
    !room.blocks.some((r) => {
      budget.check();
      return horizontal
        ? a.y > r.y + EPS &&
            a.y < r.y + r.depth - EPS &&
            Math.min(Math.max(a.x, b.x), r.x + r.width) >
              Math.max(Math.min(a.x, b.x), r.x) + EPS
        : a.x > r.x + EPS &&
            a.x < r.x + r.width - EPS &&
            Math.min(Math.max(a.y, b.y), r.y + r.depth) >
              Math.max(Math.min(a.y, b.y), r.y) + EPS;
    });
  if (!clear(from, to)) return false;
  if (distance(from, to) < EPS) return true;
  // A line exactly between two touching obstacles is not an access corridor.
  return [-1e-6, 1e-6].some((offset) => {
    const a = horizontal
      ? { x: from.x, y: from.y + offset }
      : { x: from.x + offset, y: from.y };
    const b = horizontal
      ? { x: to.x, y: to.y + offset }
      : { x: to.x + offset, y: to.y };
    return (
      within(a.x, room.x, room.x + room.width) &&
      within(a.y, room.y, room.y + room.depth) &&
      clear(a, b)
    );
  });
}

/** Address/door connectors are terminal edges, never a free-floor transit graph. */
function attachments(room: Room, endpoint: Rect | Point, budget: Budget) {
  const result = new Map<number, number>();
  const point = !("width" in endpoint);
  const limit = room.restricted ? MAX_LOCAL_ACCESS_METERS : 0;
  const attach = (cell: Cell, a: Point, b: Point, only?: number) => {
    const length = distance(a, b);
    if (length > limit + EPS || !segmentClear(room, a, b, budget)) return;
    corners(cell).forEach((corner, i) => {
      if (only !== undefined && only !== i) return;
      const cost = length + distance(b, corner);
      const node = cell.nodes[i];
      if (cost < (result.get(node) ?? Infinity)) result.set(node, cost);
    });
  };
  for (const cell of room.cells) {
    budget.check();
    if (point) {
      if (within(endpoint.x, cell.x, cell.x + cell.width)) {
        const y = Math.max(cell.y, Math.min(endpoint.y, cell.y + cell.depth));
        attach(cell, endpoint, { x: endpoint.x, y });
      }
      if (within(endpoint.y, cell.y, cell.y + cell.depth)) {
        const x = Math.max(cell.x, Math.min(endpoint.x, cell.x + cell.width));
        attach(cell, endpoint, { x, y: endpoint.y });
      }
      continue;
    }
    const y0 = Math.max(endpoint.y, cell.y);
    const y1 = Math.min(endpoint.y + endpoint.depth, cell.y + cell.depth);
    if (y1 > y0 + EPS) {
      corners(cell).forEach((corner, i) => {
        for (const y of [Math.max(y0, Math.min(corner.y, y1)), (y0 + y1) / 2]) {
          if (endpoint.x + endpoint.width <= cell.x + EPS)
            attach(
              cell,
              { x: endpoint.x + endpoint.width, y },
              { x: cell.x, y },
              i,
            );
          if (cell.x + cell.width <= endpoint.x + EPS)
            attach(
              cell,
              { x: endpoint.x, y },
              { x: cell.x + cell.width, y },
              i,
            );
        }
      });
    }
    const x0 = Math.max(endpoint.x, cell.x);
    const x1 = Math.min(endpoint.x + endpoint.width, cell.x + cell.width);
    if (x1 > x0 + EPS) {
      corners(cell).forEach((corner, i) => {
        for (const x of [Math.max(x0, Math.min(corner.x, x1)), (x0 + x1) / 2]) {
          if (endpoint.y + endpoint.depth <= cell.y + EPS)
            attach(
              cell,
              { x, y: endpoint.y + endpoint.depth },
              { x, y: cell.y },
              i,
            );
          if (cell.y + cell.depth <= endpoint.y + EPS)
            attach(
              cell,
              { x, y: endpoint.y },
              { x, y: cell.y + cell.depth },
              i,
            );
        }
      });
    }
  }
  return [...result].map(([node, length]) => ({ node, distance: length }));
}

/** Small binary heap: one Dijkstra run services every destination. */
class Heap {
  private _items: { node: number; value: number; floor: boolean }[] = [];
  push(item: { node: number; value: number; floor: boolean }) {
    const items = this._items;
    items.push(item);
    let i = items.length - 1;
    while (i) {
      const p = (i - 1) >> 1;
      if (items[p].value <= item.value) break;
      items[i] = items[p];
      i = p;
    }
    items[i] = item;
  }
  pop() {
    const items = this._items;
    if (!items.length) return undefined;
    const first = items[0];
    const last = items.pop()!;
    if (items.length) {
      let i = 0;
      while (i * 2 + 1 < items.length) {
        let child = i * 2 + 1;
        if (
          child + 1 < items.length &&
          items[child + 1].value < items[child].value
        )
          child++;
        if (items[child].value >= last.value) break;
        items[i] = items[child];
        i = child;
      }
      items[i] = last;
    }
    return first;
  }
}
function shortestPaths(nodes: Node[], initial: Attachment[], budget: Budget) {
  const lengths = new Float64Array(nodes.length).fill(Infinity);
  const floors = new Uint8Array(nodes.length);
  const heap = new Heap();
  const update = (node: number, value: number, floor: boolean) => {
    if (
      value < lengths[node] - EPS ||
      (Math.abs(value - lengths[node]) < EPS && !floor && floors[node])
    ) {
      lengths[node] = value;
      floors[node] = Number(floor);
      heap.push({ node, value, floor });
    }
  };
  for (const a of initial) update(a.node, a.distance, nodes[a.node].floor);
  for (let item = heap.pop(); item; item = heap.pop()) {
    if (
      item.value > lengths[item.node] + EPS ||
      Number(item.floor) !== floors[item.node]
    )
      continue;
    for (const edge of nodes[item.node].edges) {
      budget.check();
      update(
        edge.to,
        item.value + edge.distance,
        item.floor || nodes[edge.to].floor,
      );
    }
  }
  return { lengths, floors };
}

/** Read-only routing on the actual plan; distances are point-access estimates,
 * not vehicle-clearance, rack-front or safe travel instructions.
 */
export function placementRoutes(
  s: Plan,
  sourceId: string | null,
  candidateIds: string[],
): Map<string, PlacementRoute> {
  const ids = [...new Set(candidateIds)];
  const allUnknown = (note: string) =>
    new Map(ids.map((id) => [id, unknown(note)]));
  if (!ids.length) return new Map();
  if (!sourceId)
    return allUnknown("Не определён исходный адрес для расчёта пути");
  if (ids.length > PLACEMENT_ROUTING_LIMITS.candidates)
    return allUnknown("Слишком сложная схема для ограниченного расчёта пути");
  if (
    s.locations.length +
      s.sections.length +
      s.aisles.length +
      s.entrances.length +
      s.warehouse.spaces.length >
    PLACEMENT_ROUTING_LIMITS.objects
  )
    return allUnknown("Слишком много объектов для ограниченного расчёта пути");
  const budget = new Budget();
  try {
    const rawRooms =
      s.warehouse.layoutMode === "spaces"
        ? s.warehouse.spaces.filter((r) => !r.archived)
        : s.warehouse.layoutMode === "rectangle"
          ? [
              {
                id: "__warehouse__",
                kind: "room",
                x: 0,
                y: 0,
                width: s.warehouse.width,
                depth: s.warehouse.depth,
              },
            ]
          : [];
    if (!rawRooms.length || rawRooms.some((r) => !validRect(r)))
      return allUnknown("Геометрия помещений не определена");
    const rooms: Room[] = rawRooms.map((r) => ({
      ...r,
      floor: r.kind !== "corridor",
      restricted: false,
      aisles: [],
      blocks: [],
      cells: [],
    }));
    for (let i = 0; i < rooms.length; i++)
      for (let j = i + 1; j < rooms.length; j++) {
        budget.check();
        if (overlaps(rooms[i], rooms[j]))
          return allUnknown("Помещения пересекаются: проверьте схему");
      }
    const sections = new Map(
      s.sections.filter((r) => !r.archived).map((r) => [r.id, r]),
    );
    const blocks = new Map<string, Block>();
    for (const object of [
      ...sections.values(),
      ...s.locations.filter((r) => !r.archived && !r.sectionId),
    ]) {
      if (![0, 90, 180, 270].includes(object.rotation))
        return allUnknown("Геометрия оборудования не определена");
      const rect = footprint(object);
      const roomIndex = owner(rooms, rect);
      if (!validRect(rect) || roomIndex < 0)
        return allUnknown(
          "Оборудование должно находиться внутри одного помещения",
        );
      const key = `${"archivedLocationIds" in object ? "section" : "location"}:${object.id}`;
      const block = { ...rect, key, owner: roomIndex };
      blocks.set(key, block);
      rooms[roomIndex].blocks.push(block);
    }
    const locations = new Map<string, Block>();
    for (const location of s.locations.filter((r) => !r.archived)) {
      const block = blocks.get(
        location.sectionId
          ? `section:${location.sectionId}`
          : `location:${location.id}`,
      );
      if (block) locations.set(location.id, block);
    }
    const source = locations.get(sourceId);
    if (!source)
      return allUnknown("Исходный адрес не найден на действующей схеме");
    for (const aisle of s.aisles.filter((r) => !r.archived)) {
      if (![0, 90, 180, 270].includes(aisle.rotation))
        return allUnknown("Геометрия проходов не определена");
      const rect = footprint(aisle);
      const roomIndex = owner(rooms, rect);
      if (!validRect(rect) || roomIndex < 0)
        return allUnknown("Проход должен находиться внутри одного помещения");
      rooms[roomIndex].aisles.push(rect);
    }
    rawRooms.forEach((r, i) => {
      rooms[i].floor = r.kind !== "corridor" && !rooms[i].aisles.length;
      rooms[i].restricted = r.kind !== "corridor" && rooms[i].aisles.length > 0;
    });
    const doors: Door[] = [];
    for (const entrance of s.entrances.filter((e) => !e.archived)) {
      budget.check();
      if (
        !["north", "south", "east", "west"].includes(entrance.wall) ||
        !Number.isFinite(entrance.offset) ||
        !Number.isFinite(entrance.width) ||
        entrance.offset < 0 ||
        entrance.width <= EPS
      )
        return allUnknown("Геометрия входа не определена");
      const ownerIndex =
        s.warehouse.layoutMode === "rectangle" && !entrance.spaceId
          ? 0
          : rooms.findIndex((r) => r.id === entrance.spaceId);
      if (ownerIndex < 0)
        return allUnknown("Вход не привязан к действующему помещению");
      const segment = globalDoorSegment(s.warehouse, entrance);
      const r = rooms[ownerIndex];
      const horizontal = segment.axis === "horizontal";
      if (
        segment.start < (horizontal ? r.x : r.y) - EPS ||
        segment.end > (horizontal ? r.x + r.width : r.y + r.depth) + EPS
      )
        return allUnknown("Вход выходит за границы стены");
      for (let i = 0; i < rooms.length; i++) {
        budget.check();
        if (i === ownerIndex) continue;
        const other = rooms[i];
        const shared = horizontal
          ? (Math.abs(r.y - (other.y + other.depth)) < EPS &&
              Math.abs(segment.line - r.y) < EPS) ||
            (Math.abs(r.y + r.depth - other.y) < EPS &&
              Math.abs(segment.line - other.y) < EPS)
          : (Math.abs(r.x - (other.x + other.width)) < EPS &&
              Math.abs(segment.line - r.x) < EPS) ||
            (Math.abs(r.x + r.width - other.x) < EPS &&
              Math.abs(segment.line - other.x) < EPS);
        if (!shared) continue;
        const lo = Math.max(segment.start, horizontal ? other.x : other.y);
        const hi = Math.min(
          segment.end,
          horizontal ? other.x + other.width : other.y + other.depth,
        );
        if (hi <= lo + EPS) continue;
        // A wide opening may be partly blocked. Subdivide at both rooms'
        // physical/network boundaries, and approach strictly inside each span.
        // Near-edge portals also avoid imposing a midpoint detour on wide doors.
        const cuts = coordinates(
          [
            lo,
            hi,
            ...[rooms[ownerIndex], other].flatMap((room) =>
              [...room.blocks, ...room.aisles].flatMap((rect) =>
                horizontal
                  ? [rect.x, rect.x + rect.width]
                  : [rect.y, rect.y + rect.depth],
              ),
            ),
          ].filter((n) => within(n, lo, hi)),
        );
        const points: Point[] = [];
        for (let c = 0; c < cuts.length - 1; c++) {
          budget.check();
          const low = cuts[c],
            high = cuts[c + 1];
          if (high - low <= EPS) continue;
          const inset = Math.min(1e-6, (high - low) / 4);
          for (const position of [
            low + inset,
            (low + high) / 2,
            high - inset,
          ]) {
            const point = horizontal
              ? { x: position, y: segment.line }
              : { x: segment.line, y: position };
            points.push(point);
          }
        }
        doors.push({ a: ownerIndex, b: i, points });
      }
    }
    const nodes: Node[] = [];
    for (const room of rooms) buildRoom(room, nodes, budget);
    const uncertainRooms = new Set<number>();
    for (const door of doors) {
      let connected = false;
      for (const point of door.points) {
        const a = attachments(rooms[door.a], point, budget);
        const b = attachments(rooms[door.b], point, budget);
        if (!a.length || !b.length) continue;
        connected = true;
        const node = nodes.length;
        if (node + 1 > PLACEMENT_ROUTING_LIMITS.nodes) throw new RoutingLimit();
        nodes.push({ edges: [], floor: false });
        for (const attachment of [...a, ...b])
          addEdge(nodes, node, attachment.node, attachment.distance);
      }
      if (!connected) {
        uncertainRooms.add(door.a);
        uncertainRooms.add(door.b);
      }
    }
    // Any incomplete access opening in this room component makes a failed route
    // uncertain, rather than declaring a physical destination unreachable.
    let changed = true;
    while (changed) {
      changed = false;
      for (const door of doors)
        if (uncertainRooms.has(door.a) || uncertainRooms.has(door.b))
          for (const i of [door.a, door.b])
            if (!uncertainRooms.has(i)) {
              uncertainRooms.add(i);
              changed = true;
            }
    }
    const initial = attachments(rooms[source.owner], source, budget);
    if (!initial.length)
      return rooms[source.owner].restricted
        ? allUnknown(
            "Нет короткого подхода от исходного адреса к отмеченным проходам",
          )
        : new Map(
            ids.map((id) => [
              id,
              locations.has(id)
                ? unreachable()
                : unknown("Адрес не найден на действующей схеме"),
            ]),
          );
    const paths = shortestPaths(nodes, initial, budget);
    const result = new Map<string, PlacementRoute>();
    for (const id of ids) {
      const target = locations.get(id);
      if (!target) {
        result.set(id, unknown("Адрес не найден на действующей схеме"));
        continue;
      }
      if (source.owner === target.owner && sameRect(source, target)) {
        result.set(id, {
          status: rooms[source.owner].floor ? "floor" : "aisles",
          distanceMeters: 0,
          note: "Тот же физический участок; ярус учитывается отдельно",
        });
        continue;
      }
      const options = attachments(rooms[target.owner], target, budget);
      if (!options.length && rooms[target.owner].restricted) {
        result.set(
          id,
          unknown("Нет короткого подхода к адресу от отмеченных проходов"),
        );
        continue;
      }
      let best = Infinity,
        floor = true;
      for (const a of options) {
        const length = paths.lengths[a.node] + a.distance;
        const usedFloor =
          Boolean(paths.floors[a.node]) || rooms[target.owner].floor;
        if (
          length < best - EPS ||
          (Math.abs(length - best) < EPS && !usedFloor)
        ) {
          best = length;
          floor = usedFloor;
        }
      }
      if (!Number.isFinite(best)) {
        result.set(
          id,
          uncertainRooms.has(source.owner) && uncertainRooms.has(target.owner)
            ? unknown("Подходы от дверей к проходам отмечены не полностью")
            : unreachable(),
        );
        continue;
      }
      result.set(id, {
        status: floor ? "floor" : "aisles",
        distanceMeters: Math.round(Math.max(0, best) * 100) / 100,
        note: floor
          ? "Оценка по свободному полу: в части помещений проходы не отмечены; сторона доступа к паллете не задана"
          : "Путь по отмеченным проходам и дверям; короткий подход к доступной стороне паллеты оценочный",
      });
    }
    return result;
  } catch (error) {
    if (error instanceof RoutingLimit)
      return allUnknown(
        "Превышен лимит сложности расчёта пути; проверьте схему проходов",
      );
    return allUnknown("Схема не позволяет надёжно рассчитать путь");
  }
}
