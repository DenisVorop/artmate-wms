import { z } from "zod";
import type {
  AssignTaskDto,
  CreateTaskDto,
} from "@/shared/api/generated/model";
export const assemblySchema = z.object({
  skuId: z.string().trim().min(1, "Выберите тематику"),
  employeeId: z.string(),
  boxesTarget: z
    .number({ invalid_type_error: "Укажите количество коробов" })
    .int("Нужно целое количество")
    .min(1, "Минимум 1 короб")
    .max(1000, "Не больше 1000 коробов"),
});
export type AssemblyValues = z.infer<typeof assemblySchema>;
export function buildAssembly(values: AssemblyValues): CreateTaskDto {
  return {
    requestId: crypto.randomUUID(),
    skuId: values.skuId.trim(),
    boxesTarget: values.boxesTarget,
    ...(values.employeeId.trim()
      ? { employeeId: values.employeeId.trim() }
      : {}),
  };
}
export const assignmentSchema = z.object({ employeeId: z.string() });
export type AssignmentValues = z.infer<typeof assignmentSchema>;
export function buildAssignment(values: AssignmentValues): AssignTaskDto {
  return {
    requestId: crypto.randomUUID(),
    employeeId: values.employeeId.trim() || null,
  };
}
export const scanSchema = z.object({
  value: z.string().trim().min(1, "Отсканируйте код или введите его вручную"),
});
export type ScanValues = z.infer<typeof scanSchema>;
