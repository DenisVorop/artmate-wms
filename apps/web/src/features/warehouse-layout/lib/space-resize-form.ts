import { z } from "zod";
import type {
  WarehousePlanDto,
  WarehouseSpaceDto,
} from "@/shared/api/generated/model";
const number = () =>
  z
    .number({ invalid_type_error: "Укажите число" })
    .finite("Укажите конечное число");
export const spaceResizeSchema = z.object({
  x: number().min(0, "Минимум 0 м").max(1000, "Максимум 1000 м"),
  y: number().min(0, "Минимум 0 м").max(1000, "Максимум 1000 м"),
  width: number().min(0.5, "Минимум 0,5 м").max(1000, "Максимум 1000 м"),
  depth: number().min(0.5, "Минимум 0,5 м").max(1000, "Максимум 1000 м"),
});
export type SpaceResizeValues = z.infer<typeof spaceResizeSchema>;
export function spaceResizeDefaults(
  space: WarehouseSpaceDto,
): SpaceResizeValues {
  return { x: space.x, y: space.y, width: space.width, depth: space.depth };
}
export function spaceResizeSchemaFor(
  warehouse: WarehousePlanDto,
  spaceId: string,
) {
  return spaceResizeSchema.superRefine((values, ctx) => {
    if (values.x + values.width - warehouse.width > 1e-9)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["width"],
        message:
          "Правая граница выходит за рабочее поле. Сначала расширьте его.",
      });
    if (values.y + values.depth - warehouse.depth > 1e-9)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["depth"],
        message:
          "Нижняя граница выходит за рабочее поле. Сначала расширьте его.",
      });
    const other = warehouse.spaces.find(
      (space) =>
        !space.archived &&
        space.id !== spaceId &&
        values.x < space.x + space.width - 1e-9 &&
        values.x + values.width > space.x + 1e-9 &&
        values.y < space.y + space.depth - 1e-9 &&
        values.y + values.depth > space.y + 1e-9,
    );
    if (other)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["x"],
        message: `Границы пересекаются с «${other.name}»`,
      });
  });
}
