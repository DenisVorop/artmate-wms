import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createApp, buildOpenApi } from "./app";
async function main() {
  process.env.WMS_DATA_DIR = "memory://";
  const app = await createApp();
  const output = resolve(process.env.OPENAPI_OUTPUT ?? "../../openapi.json");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(buildOpenApi(app), null, 2));
  await app.close();
  console.log(`OpenAPI written to ${output}`);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
