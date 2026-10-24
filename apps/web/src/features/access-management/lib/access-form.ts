import { z } from "zod";
export const accessRoleSchema = z.enum(["manager", "employee"]);
export const accessPasswordSchema = z
  .string()
  .min(12, "Не меньше 12 символов")
  .max(128, "Не больше 128 символов");
export const accessCreateSchema = z.object({
  employeeId: z.string().min(1, "Выберите сотрудника"),
  login: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9][a-z0-9._-]{2,63}$/,
      "От 3 до 64 символов: латиница, цифры, точка, дефис и подчёркивание",
    ),
  role: accessRoleSchema,
  password: accessPasswordSchema,
});
export type AccessCreateValues = z.infer<typeof accessCreateSchema>;
export const resetPasswordSchema = z.object({ password: accessPasswordSchema });
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
