import { z } from "zod";
import {
  isWorkforceDate,
  workforcePeriod,
  workforcePeriodDays,
} from "@/entities/workforce";

export const reportFilterSchema = z
  .object({
    from: z.string().refine(isWorkforceDate, "Укажите корректную дату начала"),
    to: z.string().refine(isWorkforceDate, "Укажите корректную дату окончания"),
    employeeId: z.string().trim(),
  })
  .superRefine((values, ctx) => {
    if (!isWorkforceDate(values.from) || !isWorkforceDate(values.to)) return;
    if (values.from > values.to)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "Окончание должно быть не раньше начала",
      });
    else if (workforcePeriodDays(values.from, values.to) > 366)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "Выберите период не больше 366 дней",
      });
  });
export type ReportFilterValues = z.infer<typeof reportFilterSchema>;

export function reportDefaults(
  isManager: boolean,
  ownEmployeeId: string,
  initialEmployeeId?: string,
  now = new Date(),
): ReportFilterValues {
  return {
    ...workforcePeriod(1, now),
    employeeId: isManager ? (initialEmployeeId ?? "") : ownEmployeeId,
  };
}

export function reportQuery(
  values: ReportFilterValues,
  isManager: boolean,
  ownEmployeeId: string,
) {
  const valid = reportFilterSchema.parse(values);
  const employeeId = isManager ? valid.employeeId : ownEmployeeId;
  return {
    from: valid.from,
    to: valid.to,
    ...(employeeId ? { employeeId } : {}),
  };
}
