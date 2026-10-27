import { WorkAutomationScheduler } from "./work-automation/scheduler";
import { ForecastScheduler } from "./forecasting/forecast-scheduler";
import { SwaggerModule } from "@nestjs/swagger";
import { createApp, buildOpenApi } from "./app";
import { MarketplaceScheduler } from "./marketplaces/marketplace-scheduler";
import { ForecastHistoryScheduler } from "./forecasting/history-scheduler";
import { validateProductionEnvironment } from "./production-config";
import { createShutdown } from "./runtime-lifecycle";
async function main() {
  await validateProductionEnvironment();
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
  const close = createShutdown(
    [workAutomation, forecastScheduler, historyScheduler, scheduler],
    () => app.close(),
  );
  const shutdown = () =>
    void close().catch(() => {
      console.error("WMS could not shut down cleanly");
      process.exitCode = 1;
    });
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  scheduler.start();
  historyScheduler.start();
  forecastScheduler.start();
  workAutomation.start();
  console.log(
    `Artmate WMS API http://localhost:${process.env.API_PORT ?? 4080}/api/docs`,
  );
}
main().catch(() => {
  console.error(
    "WMS API startup failed; check production configuration and database availability",
  );
  process.exit(1);
});
