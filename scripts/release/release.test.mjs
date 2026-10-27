import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { initialize } from "./init.mjs";
import {
  readEnvironment,
  composeArguments,
  validateBackup,
  pinnedImage,
  commandEnvironment,
} from "./lib.mjs";

const scripts = path.dirname(fileURLToPath(import.meta.url));
const key = Buffer.alloc(32, 123);
const secret = "ab".repeat(32);
const apiImage = `ghcr.io/example/artmate-wms-api@sha256:${"a".repeat(64)}`;
const webImage = "ghcr.io/example/artmate-wms-web:sha-123456789abc";

async function fixture(t) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "wms-release-test-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const envFile = path.join(directory, ".env.production");
  const bin = path.join(directory, "bin");
  const log = path.join(directory, "commands.jsonl");
  await fs.mkdir(bin);
  await fs.writeFile(
    envFile,
    [
      "WMS_DOMAIN=wms.example.com",
      `WMS_API_IMAGE=${apiImage}`,
      `WMS_WEB_IMAGE=${webImage}`,
      "POSTGRES_USER=wms",
      "POSTGRES_DB=artmate_wms",
      `POSTGRES_PASSWORD=${secret}`,
      `WMS_MARKETPLACE_KEY=${key.toString("base64")}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  await fs.writeFile(
    path.join(bin, "docker"),
    `#!/usr/bin/env node
const fs=require('node:fs');
const a=process.argv.slice(2);
fs.appendFileSync(process.env.STUB_LOG,JSON.stringify(a)+'\\n');
if(process.env.STUB_FAIL && a.join(' ').includes(process.env.STUB_FAIL)){process.stderr.write('SECRET '+process.env.STUB_SECRET);process.exit(23);}
if(a.includes('pg_dump'))process.stdout.write(process.env.STUB_BAD_DUMP?'bad':'PGDMPcompressed-test-dump');
else if(a.includes('psql'))process.stdout.write(a.at(-1).includes('pg_database')?(process.env.STUB_EXISTS||'0'):(process.env.STUB_TABLES||'1'));
else if(a.includes('ps'))process.stdout.write(process.env.STUB_RUNNING||'postgres');
else if(a.includes('pg_restore'))process.stdin.resume();
`,
    { mode: 0o700 },
  );
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    STUB_LOG: log,
    STUB_SECRET: secret,
  };
  const cli = (name, options = [], extraEnv = {}) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [path.join(scripts, `${name}.mjs`), "--env-file", envFile, ...options],
        { env: { ...env, ...extraEnv } },
      );
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
  const calls = async () => {
    try {
      return (await fs.readFile(log, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse);
    } catch (e) {
      if (e.code === "ENOENT") return [];
      throw e;
    }
  };
  return { directory, envFile, cli, calls };
}

function commands(calls) {
  return calls.map((call) => call.slice(call.indexOf("-f") + 2).join(" "));
}

async function makeDump(f) {
  const output = path.join(f.directory, "snapshot.dump");
  const result = await f.cli("backup", ["--output", output]);
  assert.equal(result.code, 0, result.stderr);
  return output;
}

test("init exclusively writes owner-only configuration and imports the original raw encryption key", async (t) => {
  const f = await fixture(t);
  const original = path.join(f.directory, "original.key");
  await fs.writeFile(original, key, { mode: 0o600 });
  const filename = path.join(f.directory, "new.env");
  await initialize({
    "--env-file": filename,
    "--domain": "wms.example.com",
    "--existing-key-file": original,
  });
  const result = await fs.readFile(filename, "utf8");
  assert.ok(result.includes(`WMS_MARKETPLACE_KEY=${key.toString("base64")}`));
  assert.equal((await fs.stat(filename)).mode & 0o777, 0o600);
  await assert.rejects(
    initialize({
      "--env-file": filename,
      "--domain": "wms.example.com",
      "--new-install": true,
    }),
    /EEXIST/,
  );
  assert.equal(await fs.readFile(filename, "utf8"), result);
});

test("init requires an explicit fresh-install choice or exact original 32-byte key", async (t) => {
  const f = await fixture(t);
  const options = {
    "--env-file": path.join(f.directory, "new.env"),
    "--domain": "wms.example.com",
  };
  await assert.rejects(initialize(options), /exactly one/);
  await assert.rejects(
    initialize({
      ...options,
      "--new-install": true,
      "--existing-key-file": f.envFile,
    }),
    /exactly one/,
  );
  await assert.rejects(
    initialize({ ...options, "--existing-key-file": f.envFile }),
    /32 raw/,
  );
  await assert.rejects(
    initialize({
      ...options,
      "--domain": "https://wms.example.com",
      "--new-install": true,
    }),
    /DNS/,
  );
  await initialize({ ...options, "--new-install": true });
  assert.match(
    await fs.readFile(options["--env-file"], "utf8"),
    /POSTGRES_PASSWORD=[a-f0-9]{64}/,
  );
});

test("preflight requires explicit protected env, immutable images and complete values without leaking secrets", async (t) => {
  const f = await fixture(t);
  const good = await readEnvironment(f.envFile);
  assert.equal(good.POSTGRES_DB, "artmate_wms");
  const base = await fs.readFile(f.envFile, "utf8");
  for (const source of [
    base.replace(`WMS_API_IMAGE=${apiImage}`, "WMS_API_IMAGE=x:latest"),
    base.replace(/^POSTGRES_PASSWORD=.*\n/m, ""),
    `${base}POSTGRES_PASSWORD=${secret}\n`,
    base.replace("WMS_DOMAIN=wms.example.com", "WMS_DOMAIN=${BAD}"),
  ]) {
    await fs.writeFile(f.envFile, source);
    const result = await f.cli("preflight");
    assert.equal(result.code, 1);
    assert.ok(!result.stderr.includes(secret));
  }
  assert.equal((await f.calls()).length, 0);
  await fs.writeFile(f.envFile, base);
  await fs.chmod(f.envFile, 0o644);
  await assert.rejects(readEnvironment(f.envFile), /chmod 600/);
});

test("image refs and ingress overlays are explicit and default base has no ingress", () => {
  assert.ok(pinnedImage.test(apiImage));
  assert.ok(pinnedImage.test(webImage));
  for (const bad of [
    "x",
    "x:latest",
    "x:v1",
    "x:sha-REPLACE",
    "X:sha-1234567",
    "x@sha256:no",
  ])
    assert.ok(!pinnedImage.test(bad));
  assert.equal(
    composeArguments("/tmp/env").filter((v) => v.endsWith(".yml")).length,
    1,
  );
  assert.ok(
    composeArguments("/tmp/env", "artmate")
      .at(-1)
      .endsWith("compose.artmate.yml"),
  );
  assert.throws(() => composeArguments("/tmp/env", "other"), /Ingress/);
});

test("preflight rejects noncanonical encryption keys before invoking Docker", async (t) => {
  const f = await fixture(t);
  const original = await fs.readFile(f.envFile, "utf8");
  const encoded = key.toString("base64");
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const changed =
    encoded.slice(0, -2) + alphabet[alphabet.indexOf(encoded.at(-2)) + 1] + "=";
  assert.equal(Buffer.from(changed, "base64").toString("base64"), encoded);
  await fs.writeFile(f.envFile, original.replace(encoded, changed));
  const result = await f.cli("preflight");
  assert.equal(result.code, 1);
  assert.equal((await f.calls()).length, 0);
});

test("backup is custom compressed, atomic, protected, checksummed and excludes keys", async (t) => {
  const f = await fixture(t);
  const output = await makeDump(f);
  assert.equal((await fs.stat(output)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(`${output}.manifest.json`)).mode & 0o777, 0o600);
  const metadata = await validateBackup(output);
  assert.equal(metadata.bytes, Buffer.byteLength("PGDMPcompressed-test-dump"));
  const manifest = await fs.readFile(`${output}.manifest.json`, "utf8");
  assert.ok(!manifest.includes(secret));
  assert.ok(!manifest.includes(key.toString("base64")));
  assert.ok(
    commands(await f.calls()).some(
      (call) =>
        call.includes("pg_dump") &&
        call.includes("--format=custom --compress=6"),
    ),
  );
  const repeat = await f.cli("backup", ["--output", output]);
  assert.equal(repeat.code, 1);
  assert.equal(await fs.readFile(output, "utf8"), "PGDMPcompressed-test-dump");
  assert.equal(
    (await fs.readdir(f.directory)).filter((n) => n.includes(".partial-"))
      .length,
    0,
  );
});

for (const env of [{ STUB_FAIL: "pg_dump" }, { STUB_BAD_DUMP: "1" }])
  test("failed or corrupt dump leaves no final backup/manifest/temp and never prints credentials", async (t) => {
    const f = await fixture(t);
    const output = path.join(f.directory, "bad.dump");
    const result = await f.cli("backup", ["--output", output], env);
    assert.equal(result.code, 1);
    assert.ok(!result.stderr.includes(secret));
    assert.equal(
      (await fs.readdir(f.directory)).filter((n) => n.includes("bad.dump"))
        .length,
      0,
    );
  });

test("deploy stops writers before backup, migrates once, checks health then exposes optional edge", async (t) => {
  const f = await fixture(t);
  const result = await f.cli("deploy", [
    "--backup-dir",
    f.directory,
    "--ingress",
    "edge",
  ]);
  assert.equal(result.code, 0, result.stderr);
  const calls = (await f.calls()).map((a) => a.join(" "));
  const index = (text) => calls.findIndex((call) => call.includes(text));
  assert.ok(index("config --quiet") < index("pull postgres api web migrate"));
  assert.ok(
    index("up -d --wait --wait-timeout 120 postgres") <
      index("stop --timeout 120 api web"),
  );
  assert.ok(index("stop --timeout 120 api web") < index("pg_dump"));
  assert.ok(index("pg_dump") < index("--profile tools run --rm migrate"));
  assert.ok(
    index("--profile tools run --rm migrate") <
      index("up -d --wait --wait-timeout 180 api web"),
  );
  assert.ok(
    index("health/ready") < index("up -d --wait --wait-timeout 120 edge"),
  );
  assert.ok(
    index("/api/auth/session") < index("up -d --wait --wait-timeout 120 edge"),
  );
  assert.equal(calls.filter((a) => a.includes("run --rm migrate")).length, 1);
  assert.ok(
    !calls.some(
      (c) =>
        c.includes("down") ||
        c.includes("--remove-orphans") ||
        c.includes("prune"),
    ),
  );
});

for (const fail of [
  "pull postgres",
  "stop --timeout",
  "pg_dump",
  "run --rm migrate",
  "health/ready",
])
  test(`deploy aborts after ${fail} with no automatic rollback`, async (t) => {
    const f = await fixture(t);
    const result = await f.cli(
      "deploy",
      ["--backup-dir", f.directory, "--ingress", "edge"],
      { STUB_FAIL: fail },
    );
    assert.equal(result.code, 1);
    assert.ok(!result.stderr.includes(secret));
    const calls = (await f.calls()).map((a) => a.join(" "));
    const failure = calls.findIndex((call) => call.includes(fail));
    assert.ok(failure >= 0);
    assert.equal(calls.length, failure + 1);
  });

test("fresh deploy does not pretend to back up an empty database and default ingress stays private", async (t) => {
  const f = await fixture(t);
  const result = await f.cli("deploy", ["--backup-dir", f.directory], {
    STUB_TABLES: "0",
  });
  assert.equal(result.code, 0, result.stderr);
  const calls = (await f.calls()).map((a) => a.join(" "));
  assert.ok(!calls.some((c) => c.includes("pg_dump") || c.includes(" edge")));
});

test("restore checks confirmation, integrity, stopped writers and new target before creating database", async (t) => {
  const f = await fixture(t);
  const input = await makeDump(f);
  const common = [
    "--input",
    input,
    "--target-database",
    "wms_restore",
    "--confirm",
    "RESTORE:wms_restore",
  ];
  for (const extra of [
    { STUB_RUNNING: "postgres\napi" },
    { STUB_RUNNING: "postgres\nweb" },
    { STUB_RUNNING: "postgres\nmigrate" },
    { STUB_EXISTS: "1" },
  ]) {
    const result = await f.cli("restore", common, extra);
    assert.equal(result.code, 1);
  }
  assert.ok(
    !(await f.calls()).some((c) => c.join(" ").includes("CREATE DATABASE")),
  );
  const wrong = await f.cli("restore", [
    "--input",
    input,
    "--target-database",
    "wms_restore",
    "--confirm",
    "yes",
  ]);
  assert.equal(wrong.code, 1);
  const result = await f.cli("restore", common);
  assert.equal(result.code, 0, result.stderr);
  const calls = (await f.calls()).map((a) => a.join(" "));
  assert.ok(
    calls.some((c) => c.includes('CREATE DATABASE "wms_restore" OWNER "wms"')),
  );
  assert.ok(
    calls.some((c) =>
      c.includes(
        "pg_restore -U wms -d wms_restore --exit-on-error --single-transaction",
      ),
    ),
  );
  assert.ok(
    !calls.some(
      (c) =>
        c.includes("DROP ") ||
        c.includes(" down") ||
        c.includes(" up ") ||
        c.includes("--clean"),
    ),
  );
  await fs.appendFile(input, "changed");
  const corrupt = await f.cli("restore", common);
  assert.equal(corrupt.code, 1);
  assert.match(corrupt.stderr, /checksum/);
});

test("restore failure leaves services stopped and never drops a database", async (t) => {
  const f = await fixture(t);
  const input = await makeDump(f);
  const result = await f.cli(
    "restore",
    [
      "--input",
      input,
      "--target-database",
      "wms_restore",
      "--confirm",
      "RESTORE:wms_restore",
    ],
    { STUB_FAIL: "pg_restore" },
  );
  assert.equal(result.code, 1);
  assert.ok(!result.stderr.includes(secret));
  assert.ok(
    !(await f.calls()).some(
      (c) => c.join(" ").includes("DROP ") || c.includes("up"),
    ),
  );
});

test("CLI rejects missing env-file and unsafe restore target without any Docker calls", async (t) => {
  const f = await fixture(t);
  const result = await f.cli("restore", [
    "--input",
    "/tmp/nonexistent",
    "--target-database",
    "x';drop database x",
    "--confirm",
    "yes",
  ]);
  assert.equal(result.code, 1);
  assert.ok(!(await f.calls()).some((c) => c.includes("psql")));
});

test("CLI requires env file before invoking Docker and project override is isolated", async (t) => {
  const f = await fixture(t);
  const missing = await new Promise((resolve) => {
    const child = spawn(process.execPath, [
      path.join(scripts, "preflight.mjs"),
    ]);
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stderr }));
  });
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /--env-file/);
  const invalid = await f.cli("preflight", [
    "--project-name",
    "Production Unsafe",
  ]);
  assert.equal(invalid.code, 1);
  assert.equal((await f.calls()).length, 0);
  const result = await f.cli("preflight", ["--project-name", "wms-smoke_123"]);
  assert.equal(result.code, 0, result.stderr);
  const calls = await f.calls();
  assert.ok(
    calls.every((c) => c[c.indexOf("--project-name") + 1] === "wms-smoke_123"),
  );
});

test("shell variables cannot override the protected Compose environment and secret symlinks are rejected", async (t) => {
  const f = await fixture(t);
  const link = path.join(f.directory, "linked.env");
  await fs.symlink(f.envFile, link);
  await assert.rejects(readEnvironment(link), /regular files/);
  const environment = commandEnvironment({
    PATH: "protected-path",
    WMS_DOMAIN: "wms.example.com",
  });
  assert.equal(environment.PATH, undefined);
  assert.equal(environment.WMS_DOMAIN, undefined);
  assert.equal(environment.COMPOSE_FILE, undefined);
});

test("production accepts a restored application database and rejects malformed or system names", async (t) => {
  const f = await fixture(t);
  const base = await fs.readFile(f.envFile, "utf8");
  await fs.writeFile(
    f.envFile,
    base.replace("POSTGRES_DB=artmate_wms", "POSTGRES_DB=artmate_wms_import"),
  );
  assert.equal(
    (await readEnvironment(f.envFile)).POSTGRES_DB,
    "artmate_wms_import",
  );
  const output = await makeDump(f);
  assert.equal((await validateBackup(output)).database, "artmate_wms_import");
  for (const name of [
    "postgres",
    "template0",
    "template1",
    "BadName",
    "a-b",
    "x;drop",
    "",
    "a".repeat(64),
  ]) {
    await fs.writeFile(
      f.envFile,
      base.replace("POSTGRES_DB=artmate_wms", `POSTGRES_DB=${name}`),
    );
    await assert.rejects(readEnvironment(f.envFile));
  }
});

test("both sha-tagged application images must come from the same release", async (t) => {
  const f = await fixture(t);
  const base = await fs.readFile(f.envFile, "utf8");
  await fs.writeFile(
    f.envFile,
    base.replace(apiImage, "ghcr.io/example/artmate-wms-api:sha-123456789abc"),
  );
  await readEnvironment(f.envFile);
  await fs.writeFile(
    f.envFile,
    base.replace(apiImage, "ghcr.io/example/artmate-wms-api:sha-987654321abc"),
  );
  await assert.rejects(readEnvironment(f.envFile), /same release commit/);
});
