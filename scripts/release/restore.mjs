import path from "node:path";
import * as fs from "node:fs/promises";
import {
  args,
  context,
  required,
  applicationDatabase,
  validateBackup,
  writersStopped,
  sql,
  main,
  isMain,
} from "./lib.mjs";

export async function restore(ctx, options) {
  const source = path.resolve(required(options, "--input"));
  const target = required(options, "--target-database");
  if (!applicationDatabase(target))
    throw new Error("Choose an explicit new application database name.");
  if (required(options, "--confirm") !== `RESTORE:${target}`)
    throw new Error(
      "Restore confirmation must exactly equal RESTORE:<target-database>.",
    );
  await validateBackup(source);
  await writersStopped(ctx);
  const exists = await sql(
    ctx,
    `SELECT count(*) FROM pg_database WHERE datname = '${target}'`,
    "postgres",
  );
  if (exists !== "0")
    throw new Error(
      "Target database already exists. Restore accepts only a new database; no overwrite or drop is performed.",
    );
  await sql(ctx, `CREATE DATABASE "${target}" OWNER "wms"`, "postgres");
  // Stream through stdin; backup never becomes a Docker command argument or image layer.
  const file = await fs.open(source, "r");
  try {
    await ctx.docker(
      [
        "exec",
        "-T",
        "postgres",
        "pg_restore",
        "-U",
        ctx.values.POSTGRES_USER,
        "-d",
        target,
        "--exit-on-error",
        "--single-transaction",
        "--no-owner",
        "--no-privileges",
      ],
      { input: file.createReadStream() },
    );
  } finally {
    await file.close().catch(() => {});
  }
}

if (isMain(import.meta.url))
  main(async () => {
    const options = args(process.argv.slice(2), [
      "--env-file",
      "--project-name",
      "--input",
      "--target-database",
      "--confirm",
    ]);
    required(options, "--input");
    required(options, "--target-database");
    required(options, "--confirm");
    const ctx = await context(options);
    await restore(ctx, options);
    console.log(
      "Backup restored into the new database. Services remain stopped. Verify the restored data and original encryption key before any cutover.",
    );
  });
