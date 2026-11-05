import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Always disposable: no real config, integration credentials or published public ports.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const token = randomBytes(6).toString("hex");
const project = `wms-release-smoke-${token}`;
assert.match(project, /^wms-release-smoke-[a-f0-9]{12}$/);
const directory = await mkdtemp(path.join(tmpdir(), `${project}-`));
const envFile = path.join(directory, "release.env");
const overlay = path.join(directory, "loopback.yml");
const origin = "https://wms-smoke.invalid";
const apiImage = `artmate-wms-smoke-api:sha-${token}`;
const webImage = `artmate-wms-smoke-web:sha-${token}`;
const environment = { ...process.env };
for (const name of Object.keys(environment)) {
  if (/^(WMS_|POSTGRES_|COMPOSE_|DATABASE_URL$|WEB_ORIGIN$)/.test(name))
    delete environment[name];
}
const dockerPrefix = [
  "compose",
  "--project-name",
  project,
  "--env-file",
  envFile,
  "-f",
  path.join(root, "infra/compose.yml"),
  "-f",
  overlay,
];
const commandDiagnostics = new WeakMap();
function run(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 65536) stderr += chunk;
    });
    child.on("error", () => reject(new Error(`${label}: command unavailable`)));
    child.on("close", (code) => {
      if (code === 0) return resolve(stdout.trim());
      const error = new Error(`${label}: command failed (${code})`);
      commandDiagnostics.set(error, stderr);
      reject(error);
    });
  });
}
const docker = (args, label) =>
  run("docker", [...dockerPrefix, ...args], label);
const sql = (statement, database = "artmate_wms") =>
  docker(
    [
      "exec",
      "-T",
      "postgres",
      "psql",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "wms",
      "-d",
      database,
      "-At",
      "-c",
      statement,
    ],
    "SQL smoke check",
  );
const serviceNode = (service, code, label) =>
  docker(["exec", "-T", service, "node", "-e", code], label);
async function request(base, route, options = {}) {
  return fetch(`${base}${route}`, {
    ...options,
    signal: AbortSignal.timeout(10_000),
  });
}
let composeConfigured = false;
try {
  await writeFile(
    envFile,
    [
      "WMS_DOMAIN=wms-smoke.invalid",
      `WMS_API_IMAGE=${apiImage}`,
      `WMS_WEB_IMAGE=${webImage}`,
      "POSTGRES_USER=wms",
      "POSTGRES_DB=artmate_wms",
      `POSTGRES_PASSWORD=${randomBytes(32).toString("hex")}`,
      `WMS_MARKETPLACE_KEY=${randomBytes(32).toString("base64")}`,
      "",
    ].join("\n"),
    { mode: 0o600, flag: "wx" },
  );
  await writeFile(
    overlay,
    `services:
  web:
    ports:
      - "127.0.0.1::3080"
    networks:
      private: {}
      collision: {}
    depends_on:
      foreign-api:
        condition: service_healthy
  foreign-api:
    image: \${WMS_API_IMAGE}
    entrypoint: [node, -e, "require('node:http').createServer((q,s)=>{s.writeHead(418);s.end('wrong API')}).listen(4080,'0.0.0.0')"]
    command: []
    healthcheck:
      test: [CMD, node, -e, "fetch('http://127.0.0.1:4080').then(r=>process.exit(r.status===418?0:1)).catch(()=>process.exit(1))"]
      interval: 2s
      timeout: 5s
      retries: 10
    networks:
      collision:
        aliases: [api]
networks:
  collision: {}
`,
    { mode: 0o600 },
  );
  await run(
    "docker",
    [
      "tag",
      process.env.WMS_SMOKE_API_IMAGE ?? "artmate-wms-api:local",
      apiImage,
    ],
    "API image tag",
  );
  await run(
    "docker",
    [
      "tag",
      process.env.WMS_SMOKE_WEB_IMAGE ?? "artmate-wms-web:local",
      webImage,
    ],
    "Web image tag",
  );
  await docker(["config", "--quiet"], "Compose validation");
  composeConfigured = true;
  await docker(
    ["up", "-d", "--wait", "--wait-timeout", "120", "postgres"],
    "Disposable PostgreSQL start",
  );
  const migrate = () =>
    docker(
      ["--profile", "tools", "run", "--rm", "-T", "migrate"],
      "Production migration",
    );
  await migrate();
  assert.equal(
    await sql(
      "SELECT (SELECT count(*) FROM skus)+(SELECT count(*) FROM pallets)+(SELECT count(*) FROM boxes)+(SELECT count(*) FROM employees)+(SELECT count(*) FROM locations)",
    ),
    "0",
    "Fresh production must not contain demo warehouse data",
  );
  assert.equal(
    await sql("SELECT value FROM metadata WHERE key='schema_version'"),
    "19",
  );
  const ledgerCount = await sql("SELECT count(*) FROM stock_ledger");
  await migrate();
  assert.equal(
    await sql("SELECT count(*) FROM stock_ledger"),
    ledgerCount,
    "Repeated migration must not duplicate inventory events",
  );
  console.log("PASS: empty production initialization and repeated migrations");

  await docker(
    ["up", "-d", "--wait", "--wait-timeout", "180", "api", "web"],
    "Production services start",
  );
  const published = await docker(
    ["port", "web", "3080"],
    "Loopback port lookup",
  );
  assert.match(published, /^127\.0\.0\.1:\d+$/);
  const base = `http://${published}`;
  assert.equal((await request(base, "/healthz")).status, 200);
  const session = await request(base, "/api/auth/session");
  assert.equal(session.status, 200);
  assert.equal((await session.json()).needsSetup, true);
  await serviceNode(
    "web",
    "const fs=require('node:fs');const m=fs.readFileSync('/app/apps/web/.next/routes-manifest.json','utf8');if(!m.includes('http://artmate-wms-api-internal:4080/api/'))process.exit(1)",
    "Unique API DNS across shared networks",
  );
  assert.equal((await request(base, "/api/workspace")).status, 401);
  const payload = {
    name: "Release smoke",
    login: "release-smoke",
    password: "DisposableSmoke123!",
  };
  const setup = (requestOrigin) =>
    request(base, "/api/auth/setup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-WMS-Request": "1",
        Origin: requestOrigin,
      },
      body: JSON.stringify(payload),
    });
  assert.equal((await setup("https://wrong-origin.invalid")).status, 403);
  const accepted = await setup(origin);
  assert.equal(accepted.status, 200);
  const cookie = accepted.headers.get("set-cookie");
  assert.match(cookie ?? "", /^__Host-wms_session=/);
  assert.match(cookie, /; Secure(?:;|$)/);
  assert.match(cookie, /; HttpOnly(?:;|$)/);
  assert.doesNotMatch(cookie, /Domain=/i);
  assert.equal(await sql("SELECT count(*) FROM auth_accounts"), "1");
  console.log(
    "PASS: same-origin Web/API proxy, authentication, origin checks and Secure cookie",
  );

  await serviceNode(
    "api",
    "const fs=require('node:fs'); if(process.getuid()===0)process.exit(1); fs.accessSync('dist/forecasting/forecast-worker.js'); try {fs.writeFileSync('/app/unexpected-write','x');process.exit(1)}catch(e){if(e.code!=='EROFS')process.exit(1)}",
    "Non-root read-only API and compiled worker",
  );
  await serviceNode(
    "api",
    "require('./dist/forecasting/forecast-worker.js').computeForecastInWorker({key:'smoke',asOf:'2026-10-26',generatedAt:new Date().toISOString(),skus:[],policies:[],settings:{historyDays:28,horizonDays:28,safetyDays:0,leadDays:5},mappings:[],connections:[],snapshots:[],series:[]}).then(()=>console.log('worker ok')).catch(()=>process.exit(1))",
    "Compiled ML worker execution",
  );
  await serviceNode(
    "web",
    "if(process.getuid()===0)process.exit(1)",
    "Non-root web",
  );
  console.log(
    "PASS: non-root containers, read-only API filesystem and compiled forecast worker",
  );

  const dump = path.join(directory, "smoke.dump");
  await run(
    process.execPath,
    [
      "scripts/release/backup.mjs",
      "--env-file",
      envFile,
      "--project-name",
      project,
      "--output",
      dump,
    ],
    "Real backup CLI",
  );
  assert.equal((await readFile(dump)).subarray(0, 5).toString(), "PGDMP");
  await docker(
    ["stop", "--timeout", "60", "api", "web"],
    "Graceful service shutdown",
  );
  const containers = (
    await docker(
      ["ps", "--all", "--format", "json", "api", "web"],
      "Shutdown check",
    )
  )
    .split("\n")
    .filter(Boolean)
    .flatMap((s) => {
      const value = JSON.parse(s);
      return Array.isArray(value) ? value : [value];
    });
  assert.equal(containers.length, 2);
  for (const container of containers) {
    // Next standalone may propagate a normally handled SIGTERM as 128+15.
    // API must complete its SQL/scheduler shutdown explicitly; SIGKILL(137) fails both.
    const allowed = container.Service === "web" ? [0, 143] : [0];
    assert.ok(
      allowed.includes(Number(container.ExitCode)),
      `${container.Service} must stop without SIGKILL or an application error`,
    );
  }
  await run(
    process.execPath,
    [
      "scripts/release/restore.mjs",
      "--env-file",
      envFile,
      "--project-name",
      project,
      "--input",
      dump,
      "--target-database",
      "smoke_restore",
      "--confirm",
      "RESTORE:smoke_restore",
    ],
    "Real restore CLI",
  );
  assert.equal(
    await sql("SELECT count(*) FROM auth_accounts", "smoke_restore"),
    "1",
  );
  assert.equal(
    await sql("SELECT count(*) FROM stock_ledger", "smoke_restore"),
    ledgerCount,
  );
  await migrate();
  await docker(
    ["up", "-d", "--wait", "--wait-timeout", "180", "api", "web"],
    "Restart preserving state",
  );
  const restartedPort = await docker(
    ["port", "web", "3080"],
    "Restarted loopback port lookup",
  );
  assert.match(restartedPort, /^127\.0\.0\.1:\d+$/);
  assert.equal(
    (
      await (
        await request(`http://${restartedPort}`, "/api/auth/session")
      ).json()
    ).needsSetup,
    false,
  );
  console.log(
    "PASS: backup checksum, restore to new DB, clean shutdown and persistent restart",
  );
  console.log("Container release smoke passed; all data was disposable.");
} catch (error) {
  // Only disposable fixtures live here. Redact generated secrets before CI diagnostics.
  if (composeConfigured) {
    let diagnostics = await docker(
      ["logs", "--no-color", "--tail", "40"],
      "Disposable service diagnostics",
    ).catch(() => "Service diagnostics unavailable");
    diagnostics =
      (commandDiagnostics.get(error) ?? "") +
      "\n" +
      (await docker(
        ["ps", "--all", "--format", "json"],
        "Disposable service status",
      ).catch(() => "")) +
      "\n" +
      diagnostics;
    const config = await readFile(envFile, "utf8");
    for (const line of config.split("\n")) {
      if (/^(POSTGRES_PASSWORD|WMS_MARKETPLACE_KEY)=/.test(line))
        diagnostics = diagnostics.replaceAll(
          line.slice(line.indexOf("=") + 1),
          "[redacted]",
        );
    }
    console.error(diagnostics);
  }
  throw error;
} finally {
  // This unique project is created only above; production tooling never uses down -v.
  if (composeConfigured)
    await docker(
      ["--profile", "tools", "down", "--volumes", "--remove-orphans"],
      "Disposable cleanup",
    );
  await run(
    "docker",
    ["image", "rm", apiImage, webImage],
    "Disposable image-tag cleanup",
  ).catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
