import { z } from "zod";
import type { CreateEmployeeDto } from "@/shared/api/generated/model";

export const employeeSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Укажите имя сотрудника")
    .max(100, "Не больше 100 символов"),
  role: z.string().trim().max(100, "Не больше 100 символов"),
});
export type EmployeeValues = z.infer<typeof employeeSchema>;
export const employeeDefaults: EmployeeValues = { name: "", role: "" };
export function toCreateEmployee(values: EmployeeValues): CreateEmployeeDto {
  const name = values.name.trim(),
    role = values.role.trim();
  return { name, ...(role ? { role } : {}), requestId: crypto.randomUUID() };
}
