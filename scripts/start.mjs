import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import {
  readPhoneConfig,
  preparePhoneAccess,
  phoneOrigins,
  startPhoneAccess,
  printPhoneAddresses,
} from "./phone-access.mjs";
const root = path.resolve(import.meta.dirname, "..");
let phoneConfig;
if (readPhoneConfig()) {
  try {
    phoneConfig = preparePhoneAccess();
  } catch (error) {
    console.error("Доступ с телефона не запущен:", error.message);
  }
}
const defaultOrigins =
  "http://127.0.0.1:3080,http://127.0.0.1:3081,http://localhost:3080,http://localhost:3081";
const env = {
  ...process.env,
  API_HOST: "127.0.0.1",
  API_PORT: "4080",
  WEB_ORIGIN: [
    ...new Set([
      ...(process.env.WEB_ORIGIN ?? defaultOrigins)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      ...(phoneConfig ? phoneOrigins(phoneConfig) : []),
    ]),
  ].join(","),
};
let phoneGateway;
const api = spawn(process.execPath, ["dist/main.js"], {
  cwd: path.join(root, "apps/api"),
  stdio: "inherit",
  env,
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
  { cwd: path.join(root, "apps/web"), stdio: "inherit", env },
);
const children = [api, web];
mkdirSync(path.join(root, ".data"), { recursive: true });
function recordProcesses() {
  writeFileSync(
    path.join(root, ".data/app-processes.json"),
    JSON.stringify({
      manager: process.pid,
      api: api.pid,
      web: web.pid,
      ...(phoneGateway
        ? {
            phone: {
              httpsPort: phoneConfig.tlsPort,
              setupPort: phoneConfig.setupPort,
              addresses: phoneConfig.addresses,
            },
          }
        : {}),
    }),
  );
}
recordProcesses();
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  phoneGateway?.close();
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

if (phoneConfig) {
  try {
    phoneGateway = await startPhoneAccess(phoneConfig);
    if (stopping) phoneGateway.close();
    else {
      recordProcesses();
      printPhoneAddresses(phoneConfig);
    }
  } catch (error) {
    console.error(
      "Доступ с телефона не запущен; локальная WMS продолжает работу:",
      error.message,
    );
  }
} else
  console.log(
    "Для подключения телефонов: yarn phone:setup, затем перезапустите yarn start.",
  );
