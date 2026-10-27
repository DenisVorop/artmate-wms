import { MarketplaceSecrets } from "./marketplaces/secrets";

type Environment = Record<string, string | undefined>;
/** Executable boundary only: DI and OpenAPI export remain offline/testable. */
export async function validateProductionEnvironment(
  env: Environment = process.env,
) {
  if (env.NODE_ENV !== "production") return;
  if (env.WMS_DATA_DIR !== undefined)
    throw new Error(
      "Production requires PostgreSQL; WMS_DATA_DIR must be unset",
    );
  let database: URL;
  try {
    database = new URL(env.DATABASE_URL ?? "");
  } catch {
    throw new Error("Production requires an explicit PostgreSQL DATABASE_URL");
  }
  if (
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    !database.hostname ||
    !database.username ||
    !database.password ||
    database.pathname.length <= 1 ||
    database.hash
  )
    throw new Error("Production requires a complete PostgreSQL DATABASE_URL");
  const origins = env.WEB_ORIGIN?.split(",");
  if (
    !origins?.length ||
    origins.some((value) => {
      try {
        const url = new URL(value);
        return (
          value !== value.trim() ||
          url.protocol !== "https:" ||
          url.origin !== value ||
          !url.hostname ||
          url.hostname.includes("*") ||
          url.username !== "" ||
          url.password !== ""
        );
      } catch {
        return true;
      }
    })
  )
    throw new Error("Production WEB_ORIGIN must contain exact HTTPS origins");
  if (env.WMS_AUTH_COOKIE_SECURE !== "true")
    throw new Error("Production requires WMS_AUTH_COOKIE_SECURE=true");
  if (!/^__Host-wms_[A-Za-z0-9_-]+$/.test(env.WMS_AUTH_COOKIE_NAME ?? ""))
    throw new Error("Production requires a unique __Host-wms_ cookie name");
  if (!env.WMS_MARKETPLACE_KEY && !env.WMS_MARKETPLACE_KEY_FILE)
    throw new Error(
      "Production requires an external marketplace encryption key",
    );
  await new MarketplaceSecrets({
    key: env.WMS_MARKETPLACE_KEY,
    path: env.WMS_MARKETPLACE_KEY_FILE,
    production: true,
  }).validateKey();
}
