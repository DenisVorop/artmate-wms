import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const productionBase = "/opt/artmate-wms";

async function regularPrivateFile(filename) {
  const info = await fs.lstat(filename);
  if (!info.isFile() || info.mode & 0o077)
    throw new Error("Expected an owner-only regular file.");
}

async function realDirectory(directory, privateOnly = false) {
  const info = await fs.lstat(directory);
  if (
    !info.isDirectory() ||
    (privateOnly && info.mode & 0o077) ||
    (await fs.realpath(directory)) !== directory
  )
    throw new Error("Expected a real, protected deployment directory.");
}

export async function prepareBackup(base = productionBase, now = new Date()) {
  if (!path.isAbsolute(base) || path.resolve(base) !== base)
    throw new Error("Invalid deployment base.");
  await realDirectory(base, true);
  const shared = path.join(base, "shared");
  await realDirectory(shared, true);
  try {
    await fs.lstat(path.join(shared, "deploy.lock"));
    return { skipped: true };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const record = path.join(shared, "current-release.json");
  await regularPrivateFile(record);
  const current = JSON.parse(await fs.readFile(record, "utf8"));
  const releases = path.join(base, "releases");
  await realDirectory(releases);
  const release = current.directory;
  if (
    typeof release !== "string" ||
    path.dirname(release) !== releases ||
    path.resolve(release) !== release ||
    !/^[a-f0-9]{40}-[A-Za-z0-9-]+$/.test(path.basename(release))
  )
    throw new Error("Invalid activated release directory.");
  await realDirectory(release);
  const script = path.join(release, "scripts", "release", "backup.mjs");
  if (
    (await fs.realpath(script)) !== script ||
    !(await fs.lstat(script)).isFile()
  )
    throw new Error("Backup implementation must be inside the real release.");
  const envFile = path.join(shared, ".env.production");
  await regularPrivateFile(envFile);
  const backups = path.join(base, "backups");
  await realDirectory(backups, true);
  const output = path.join(
    backups,
    `daily-${now.toISOString().replaceAll(":", "-")}.dump`,
  );
  return { skipped: false, release, script, envFile, output };
}

export async function runBackup(plan, execute = spawn) {
  if (plan.skipped) {
    console.log("Daily backup skipped: a deployment is active.");
    return 0;
  }
  return new Promise((resolve, reject) => {
    const child = execute(
      process.execPath,
      [plan.script, "--env-file", plan.envFile, "--output", plan.output],
      {
        cwd: plan.release,
        stdio: "inherit",
        env: { ...process.env, TZ: "Europe/Moscow" },
      },
    );
    child.once("error", reject);
    child.once("exit", (code) => resolve(code === 0 ? 0 : 1));
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.umask(0o077);
  try {
    if (process.argv.length !== 2)
      throw new Error("No arguments are supported.");
    process.exitCode = await runBackup(await prepareBackup());
  } catch {
    console.error(
      "Daily backup failed; check the protected current release, configuration, directories and Docker access.",
    );
    process.exitCode = 1;
  }
}
