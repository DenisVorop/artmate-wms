import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const bin =
  process.env.PG_BIN ??
  "/Applications/Postgres.app/Contents/Versions/latest/bin";
const data = path.join(root, ".data/postgres");
const command = process.argv[2] ?? "start";
function run(name, args, options = {}) {
  const result = spawnSync(path.join(bin, name), args, {
    stdio: "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (!existsSync(path.join(bin, "pg_ctl"))) {
  console.error(
    "PostgreSQL не найден. Укажите PG_BIN или запустите docker compose up -d postgres.",
  );
  process.exit(1);
}
if (command === "stop") {
  run("pg_ctl", ["-D", data, "stop", "-m", "fast", "-w"]);
  process.exit();
}
if (command === "status") {
  run("pg_ctl", ["-D", data, "status"]);
  process.exit();
}
mkdirSync(path.join(root, ".data"), { recursive: true });
if (!existsSync(path.join(data, "PG_VERSION"))) {
  const pw = path.join(root, ".data/init-password");
  writeFileSync(pw, "wms\n", { mode: 0o600 });
  try {
    run("initdb", [
      "-D",
      data,
      "-U",
      "wms",
      "--auth-host=scram-sha-256",
      "--auth-local=trust",
      "--pwfile",
      pw,
      "--encoding=UTF8",
      "--locale=C",
    ]);
  } finally {
    unlinkSync(pw);
  }
}
const status = spawnSync(path.join(bin, "pg_ctl"), ["-D", data, "status"], {
  stdio: "ignore",
});
if (status.status !== 0)
  run("pg_ctl", [
    "-D",
    data,
    "-l",
    path.join(root, ".data/postgres.log"),
    "-o",
    "-h 127.0.0.1 -p 5440 -k /private/tmp",
    "start",
    "-w",
  ]);
const check = spawnSync(
  path.join(bin, "psql"),
  [
    "-h",
    "/private/tmp",
    "-p",
    "5440",
    "-U",
    "wms",
    "-d",
    "postgres",
    "-tAc",
    "SELECT 1 FROM pg_database WHERE datname='artmate_wms'",
  ],
  { encoding: "utf8" },
);
if (check.status !== 0) throw new Error("Не удалось проверить базу WMS");
if (check.stdout.trim() !== "1")
  run("createdb", [
    "-h",
    "/private/tmp",
    "-p",
    "5440",
    "-U",
    "wms",
    "artmate_wms",
  ]);
console.log("PostgreSQL WMS: 127.0.0.1:5440 / artmate_wms");
