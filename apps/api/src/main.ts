import { SwaggerModule } from "@nestjs/swagger";
import { createApp, buildOpenApi } from "./app";
async function main() {
  const app = await createApp();
  SwaggerModule.setup("api/docs", app, buildOpenApi(app));
  await app.listen(
    Number(process.env.API_PORT ?? 4080),
    process.env.API_HOST ?? "127.0.0.1",
  );
  console.log(
    `Artmate WMS API http://localhost:${process.env.API_PORT ?? 4080}/api/docs`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
