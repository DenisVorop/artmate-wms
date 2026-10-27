import { WorkAutomationScheduler } from "./work-automation/scheduler";
import { ForecastScheduler } from "./forecasting/forecast-scheduler";
import { SwaggerModule } from "@nestjs/swagger";
import { createApp, buildOpenApi } from "./app";
import { MarketplaceScheduler } from "./marketplaces/marketplace-scheduler";
import { ForecastHistoryScheduler } from "./forecasting/history-scheduler";
async function main() {
  const app = await createApp();
  SwaggerModule.setup("api/docs", app, buildOpenApi(app));
  await app.listen(
    Number(process.env.API_PORT ?? 4080),
    process.env.API_HOST ?? "127.0.0.1",
  );
  const scheduler = app.get(MarketplaceScheduler);
  const historyScheduler = app.get(ForecastHistoryScheduler);
  const forecastScheduler = app.get(ForecastScheduler);
  const workAutomation = app.get(WorkAutomationScheduler);
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await workAutomation.stop();
      await forecastScheduler.stop();
      await historyScheduler.stop();
      await scheduler.stop();
      await app.close();
    } catch {
      console.error("WMS could not shut down cleanly");
      process.exitCode = 1;
    }
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
  scheduler.start();
  historyScheduler.start();
  forecastScheduler.start();
  workAutomation.start();
  console.log(
    `Artmate WMS API http://localhost:${process.env.API_PORT ?? 4080}/api/docs`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
