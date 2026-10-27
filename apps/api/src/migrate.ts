import "reflect-metadata";
import { WarehouseService } from "./warehouse.service";
import { validateProductionEnvironment } from "./production-config";
/** Same versioned initialization as API startup, without HTTP or schedulers. */
async function main() {
  await validateProductionEnvironment();
  const warehouse = new WarehouseService();
  try {
    await warehouse.onModuleInit();
    console.log("WMS database migrations complete");
  } finally {
    await warehouse.onModuleDestroy();
  }
}
main().catch(() => {
  console.error(
    "WMS migration failed; check configuration and database availability",
  );
  process.exitCode = 1;
});
