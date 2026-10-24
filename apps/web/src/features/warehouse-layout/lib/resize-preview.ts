import type { WorkspaceDto } from "@/shared/api/generated/model";
import type { ResizeSpaceGeometry } from "./resize-geometry";

/** Resize changes only boundaries, including NW; group translation belongs exclusively to move. */
export function workspaceWithResizePreview<
  T extends Pick<WorkspaceDto, "warehouse">,
>(data: T, preview: (ResizeSpaceGeometry & { id: string }) | null): T {
  if (
    !preview ||
    !data.warehouse.spaces.some(
      (space) => space.id === preview.id && !space.archived,
    )
  )
    return data;
  const { x, y, width, depth } = preview;
  return {
    ...data,
    warehouse: {
      ...data.warehouse,
      spaces: data.warehouse.spaces.map((space) =>
        space.id === preview.id && !space.archived
          ? { ...space, x, y, width, depth }
          : space,
      ),
    },
  };
}
