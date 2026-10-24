import { z } from "zod";
export const newPasswordSchema = z
  .string()
  .min(12, "Не меньше 12 символов")
  .max(128, "Не больше 128 символов");
export const accountLoginSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9][a-z0-9._-]{2,63}$/,
    "От 3 до 64 символов: латиница, цифры, точка, дефис и подчёркивание",
  );
export const loginSchema = z.object({
  login: z.string().trim().toLowerCase().min(1, "Введите логин").max(64),
  password: z.string().min(1, "Введите пароль").max(128),
});
export type LoginValues = z.infer<typeof loginSchema>;
export const setupSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Укажите имя минимум из 2 символов")
      .max(100),
    login: accountLoginSchema,
    password: newPasswordSchema,
    repeatPassword: z.string(),
  })
  .refine((v) => v.password === v.repeatPassword, {
    path: ["repeatPassword"],
    message: "Пароли должны совпадать",
  });
export type SetupValues = z.infer<typeof setupSchema>;
export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "Введите текущий пароль").max(128),
    newPassword: newPasswordSchema,
    repeatPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.repeatPassword, {
    path: ["repeatPassword"],
    message: "Пароли должны совпадать",
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ["newPassword"],
    message: "Новый пароль должен отличаться от текущего",
  });
export type PasswordChangeValues = z.infer<typeof passwordChangeSchema>;
