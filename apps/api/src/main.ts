import { SwaggerModule } from "@nestjs/swagger";
import { createApp, buildOpenApi } from "./app";
import { MarketplaceScheduler } from "./marketplaces/marketplace-scheduler";
async function main() {
  const app = await createApp();
  SwaggerModule.setup("api/docs", app, buildOpenApi(app));
  await app.listen(
    Number(process.env.API_PORT ?? 4080),
    process.env.API_HOST ?? "127.0.0.1",
  );
  const scheduler = app.get(MarketplaceScheduler);
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    try {
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
  console.log(
    `Artmate WMS API http://localhost:${process.env.API_PORT ?? 4080}/api/docs`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
