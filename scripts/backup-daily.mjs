import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Host timer wrapper. Retention/offsite policy is configured when the host is chosen.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
if (
  argv.length !== 4 ||
  argv[0] !== "--env-file" ||
  argv[2] !== "--directory"
) {
  console.error(
    "Usage: node scripts/backup-daily.mjs --env-file FILE --directory PRIVATE_DIRECTORY",
  );
  process.exit(1);
}
try {
  const directory = path.resolve(argv[3]);
  const info = await stat(directory);
  if (!info.isDirectory() || info.mode & 0o077)
    throw new Error("Backup directory must have owner-only permissions (700).");
  const output = path.join(
    directory,
    `daily-${new Date().toISOString().replaceAll(":", "-")}.dump`,
  );
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.join(root, "scripts/release/backup.mjs"),
        "--env-file",
        path.resolve(argv[1]),
        "--output",
        output,
      ],
      { cwd: root, stdio: "inherit" },
    );
    child.once("error", reject);
    child.once("exit", resolve);
  });
  process.exitCode = code === 0 ? 0 : 1;
} catch {
  console.error(
    "Daily backup failed; check the protected configuration, backup directory and Docker access.",
  );
  process.exitCode = 1;
}
