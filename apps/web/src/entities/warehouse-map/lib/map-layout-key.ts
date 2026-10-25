import type { WorkspaceDto } from "@/shared/api/generated/model";
type Geometry = Pick<
  WorkspaceDto,
  "warehouse" | "locations" | "sections" | "aisles" | "entrances"
>;
const ordered = (rows: unknown[][]) =>
  rows.sort((a, b) =>
    String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0,
  );
/** A layout identity excludes inventory, commands, reservations and workspace revision. */
export function workRouteLayoutPayload(s: Geometry): string {
  const rect = (r: {
    x: number;
    y: number;
    width: number;
    depth: number;
    rotation: number;
  }) => [r.x, r.y, r.width, r.depth, r.rotation];
  return JSON.stringify([
    "work-route-layout-v1",
    s.warehouse.layoutMode,
    s.warehouse.width,
    s.warehouse.depth,
    ordered(
      s.warehouse.spaces.map((r) => [
        r.id,
        r.kind,
        r.x,
        r.y,
        r.width,
        r.depth,
        r.archived,
      ]),
    ),
    ordered(s.sections.map((r) => [r.id, ...rect(r), r.archived])),
    ordered(
      s.locations.map((r) => [
        r.id,
        r.kind,
        r.sectionId,
        r.level,
        ...rect(r),
        r.archived,
        r.blocked,
      ]),
    ),
    ordered(s.aisles.map((r) => [r.id, ...rect(r), r.archived])),
    ordered(
      s.entrances.map((r) => [
        r.id,
        r.spaceId,
        r.wall,
        r.offset,
        r.width,
        r.archived,
      ]),
    ),
  ]);
}
export async function workRouteLayoutKey(s: Geometry): Promise<string> {
  const bytes = new TextEncoder().encode(workRouteLayoutPayload(s));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}
