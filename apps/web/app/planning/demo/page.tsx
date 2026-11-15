import { notFound } from "next/navigation";
import { PlanningPage } from "@/pages/planning";

export default async function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  const { demoPlan, demoForecastRows } =
    await import("@/pages/planning/demo-plan");
  return <PlanningPage preview={demoPlan} forecastPreview={demoForecastRows} />;
}
