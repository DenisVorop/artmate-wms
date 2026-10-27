import * as fs from "node:fs/promises";
import path from "node:path";
import { args, context, required, sql, backup, main, isMain } from "./lib.mjs";

export async function deploy(ctx, options) {
  const directory = path.resolve(required(options, "--backup-dir"));
  const stat = await fs.stat(directory);
  if (!stat.isDirectory() || stat.mode & 0o077)
    throw new Error(
      "Backup directory must exist and be accessible only to its owner (chmod 700).",
    );
  // No traffic is exposed by the base file. Keep ingress out of all pre-migration steps.
  await ctx.docker(["pull", "postgres", "api", "web", "migrate"]);
  await ctx.docker(["up", "-d", "--wait", "--wait-timeout", "120", "postgres"]);
  await ctx.docker(["stop", "--timeout", "120", "api", "web"]);
  const tables = await sql(
    ctx,
    "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
  );
  if (!/^\d+$/.test(tables))
    throw new Error("Cannot determine database state. Writers remain stopped.");
  if (Number(tables) > 0) {
    const filename = path.join(
      directory,
      `before-release-${new Date().toISOString().replaceAll(":", "-")}.dump`,
    );
    await backup(ctx, filename);
  }
  // Deliberately no automatic old-image restart: a failed migration may have changed the schema.
  await ctx.docker(["--profile", "tools", "run", "--rm", "migrate"]);
  await ctx.docker([
    "up",
    "-d",
    "--wait",
    "--wait-timeout",
    "180",
    "api",
    "web",
  ]);
  await ctx.docker([
    "exec",
    "-T",
    "api",
    "node",
    "-e",
    "fetch('http://127.0.0.1:4080/health/ready',{signal:AbortSignal.timeout(5000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
  ]);
  await ctx.docker([
    "exec",
    "-T",
    "web",
    "node",
    "-e",
    "fetch('http://127.0.0.1:3080/healthz',{signal:AbortSignal.timeout(5000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
  ]);
  await ctx.docker([
    "exec",
    "-T",
    "web",
    "node",
    "-e",
    "fetch('http://127.0.0.1:3080/api/auth/session',{signal:AbortSignal.timeout(5000)}).then(r=>process.exit(r.status===200||r.status===401?0:1)).catch(()=>process.exit(1))",
  ]);
  if (options["--ingress"] === "edge")
    await ctx.docker(["up", "-d", "--wait", "--wait-timeout", "120", "edge"]);
}

if (isMain(import.meta.url))
  main(async () => {
    const options = args(process.argv.slice(2), [
      "--env-file",
      "--project-name",
      "--ingress",
      "--backup-dir",
    ]);
    required(options, "--backup-dir");
    const ctx = await context(options);
    await deploy(ctx, options);
    console.log(
      "Release started and internal health checks passed. Verify public HTTPS and the first real operation separately.",
    );
  });
