import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const api = spawn(process.execPath, ["dist/main.js"], {
  cwd: path.join(root, "apps/api"),
  stdio: "inherit",
  env: process.env,
});
const web = spawn(
  process.execPath,
  [
    path.join(root, "node_modules/next/dist/bin/next"),
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3080",
  ],
  { cwd: path.join(root, "apps/web"), stdio: "inherit", env: process.env },
);
const children = [api, web];
mkdirSync(path.join(root, ".data"), { recursive: true });
writeFileSync(
  path.join(root, ".data/app-processes.json"),
  JSON.stringify({ manager: process.pid, api: api.pid, web: web.pid }),
);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  try {
    unlinkSync(path.join(root, ".data/app-processes.json"));
  } catch {}
  setTimeout(() => process.exit(), 1000).unref();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children)
  child.on("exit", (code) => {
    if (!stopping) {
      console.error("Сервис остановился:", code);
      stop();
      process.exitCode = code ?? 1;
    }
  });
console.log("WMS: http://127.0.0.1:3080 | API: http://127.0.0.1:4080/api/docs");
