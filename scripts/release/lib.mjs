import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const databaseName = /^[a-z][a-z0-9_]{0,62}$/;
export function applicationDatabase(value) {
  return (
    typeof value === "string" &&
    databaseName.test(value) &&
    !["postgres", "template0", "template1"].includes(value)
  );
}
export const domainName =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export const pinnedImage =
  /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?\/)?[a-z0-9][a-z0-9._/-]*(?:@sha256:[a-f0-9]{64}|:(?:sha-[a-f0-9]{7,40}|[a-f0-9]{40}))$/;

export function args(argv, allowed) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!allowed.includes(key) || Object.hasOwn(result, key))
      throw new Error(
        "Unknown or repeated option. See docs/RELEASE_OPERATIONS.md.",
      );
    if (key === "--new-install") result[key] = true;
    else {
      if (!argv[i + 1] || argv[i + 1].startsWith("--"))
        throw new Error(`Missing value for ${key}.`);
      result[key] = argv[++i];
    }
  }
  return result;
}

export function required(options, key) {
  if (!options[key]) throw new Error(`Required option: ${key}.`);
  return options[key];
}

export async function protectedFile(filename) {
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077)
    throw new Error(
      "Secret and backup files must be regular files accessible only to their owner (chmod 600).",
    );
  return stat;
}

export async function readEnvironment(filename) {
  await protectedFile(filename);
  const source = await fs.readFile(filename, "utf8");
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=([^\r\n]*)$/.exec(line);
    if (!match || Object.hasOwn(values, match[1]))
      throw new Error(
        "Invalid or duplicate environment entry; use plain NAME=value lines.",
      );
    // No shell expansion, multiline values, quotes or Compose interpolation in secrets.
    if (/[$`'"\s]/.test(match[2]))
      throw new Error(
        "Environment values must be unquoted single-line values without interpolation.",
      );
    values[match[1]] = match[2];
  }
  for (const name of [
    "WMS_DOMAIN",
    "WMS_API_IMAGE",
    "WMS_WEB_IMAGE",
    "POSTGRES_USER",
    "POSTGRES_DB",
    "POSTGRES_PASSWORD",
    "WMS_MARKETPLACE_KEY",
  ]) {
    if (!values[name])
      throw new Error(`Missing required environment variable: ${name}.`);
  }
  if (!domainName.test(values.WMS_DOMAIN))
    throw new Error("WMS_DOMAIN must be a DNS hostname.");
  for (const name of ["WMS_API_IMAGE", "WMS_WEB_IMAGE"])
    if (!pinnedImage.test(values[name]))
      throw new Error(
        `${name} must use a sha-commit tag or sha256 image digest; latest is forbidden.`,
      );
  if (
    values.POSTGRES_USER !== "wms" ||
    !applicationDatabase(values.POSTGRES_DB)
  )
    throw new Error(
      "Production database must use a valid non-system database name with user wms.",
    );
  const apiTag = /:sha-([a-f0-9]{7,40})$/.exec(values.WMS_API_IMAGE)?.[1];
  const webTag = /:sha-([a-f0-9]{7,40})$/.exec(values.WMS_WEB_IMAGE)?.[1];
  if (apiTag && webTag && apiTag !== webTag)
    throw new Error(
      "API and web sha tags must refer to the same release commit.",
    );
  if (!/^[a-f0-9]{64}$/.test(values.POSTGRES_PASSWORD))
    throw new Error(
      "POSTGRES_PASSWORD must be 32 random bytes encoded as 64 hexadecimal characters.",
    );
  if (
    !/^[A-Za-z0-9+/]{43}=$/.test(values.WMS_MARKETPLACE_KEY) ||
    Buffer.from(values.WMS_MARKETPLACE_KEY, "base64").length !== 32 ||
    Buffer.from(values.WMS_MARKETPLACE_KEY, "base64").toString("base64") !==
      values.WMS_MARKETPLACE_KEY
  )
    throw new Error(
      "WMS_MARKETPLACE_KEY must be a canonical base64-encoded 32-byte key.",
    );
  return values;
}

export function composeArguments(
  envFile,
  ingress = "none",
  projectRoot = root,
  projectName = "artmate-wms",
) {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(projectName))
    throw new Error("Invalid Compose project name.");
  if (!["none", "edge", "artmate"].includes(ingress))
    throw new Error("Ingress must be none, edge or artmate.");
  return [
    "compose",
    "--project-name",
    projectName,
    "--env-file",
    path.resolve(envFile),
    "-f",
    path.join(projectRoot, "infra/compose.yml"),
    ...(ingress === "none"
      ? []
      : ["-f", path.join(projectRoot, `infra/compose.${ingress}.yml`)]),
  ];
}

// Environment values from the protected file must win over a caller's shell.
// Compose itself reads the file; clearing colliding process variables avoids surprises.
export function commandEnvironment(values = {}) {
  const result = { ...process.env };
  for (const name of Object.keys(values)) delete result[name];
  delete result.COMPOSE_FILE;
  delete result.COMPOSE_PROJECT_NAME;
  delete result.COMPOSE_PROFILES;
  return result;
}

export function run(
  command,
  commandArgs,
  { env = process.env, input, stdoutFile, maxBytes = 1024 * 1024 } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      env,
      stdio: ["pipe", stdoutFile === undefined ? "pipe" : stdoutFile, "pipe"],
    });
    let output = "";
    let failed = false;
    child.stdout?.on("data", (data) => {
      if (Buffer.byteLength(output) + data.length > maxBytes) {
        failed = true;
        child.kill("SIGTERM");
      } else output += data;
    });
    // Never relay raw tool output: it can contain interpolated database passwords.
    child.stderr.on("data", () => {});
    child.on("error", () =>
      reject(
        new Error(
          "Cannot run the required command; verify Docker and permissions.",
        ),
      ),
    );
    child.on("close", (code) =>
      code === 0 && !failed
        ? resolve(output.trim())
        : reject(
            new Error(
              "Release command failed. Inspect the service locally without sharing secrets; no automatic rollback was attempted.",
            ),
          ),
    );
    child.stdin.on("error", () => {});
    if (input && typeof input.pipe === "function") {
      input.on("error", () => {
        failed = true;
        child.kill("SIGTERM");
      });
      input.pipe(child.stdin);
    } else child.stdin.end(input);
  });
}

export async function context(
  options,
  { checkConfig = true, projectRoot = root } = {},
) {
  const envFile = path.resolve(required(options, "--env-file"));
  const values = await readEnvironment(envFile);
  const prefix = composeArguments(
    envFile,
    options["--ingress"] ?? "none",
    projectRoot,
    options["--project-name"] ?? "artmate-wms",
  );
  const env = commandEnvironment(values);
  const docker = (arguments_, settings = {}) =>
    run("docker", [...prefix, ...arguments_], { env, ...settings });
  if (checkConfig) await docker(["config", "--quiet"]);
  return { envFile, values, prefix, env, docker };
}

export async function sql(ctx, statement, db = ctx.values.POSTGRES_DB) {
  if (!databaseName.test(db)) throw new Error("Invalid database name.");
  return ctx.docker([
    "exec",
    "-T",
    "postgres",
    "psql",
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    ctx.values.POSTGRES_USER,
    "-d",
    db,
    "-At",
    "-c",
    statement,
  ]);
}

export async function writersStopped(ctx) {
  const output = await ctx.docker([
    "ps",
    "--all",
    "--status",
    "running",
    "--services",
  ]);
  const running = new Set(output.split(/\s+/));
  if (running.has("api") || running.has("web") || running.has("migrate"))
    throw new Error("Stop api, web and migrate before restoring.");
}

export async function hashFile(filename) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

export async function exclusiveWrite(filename, data) {
  const handle = await fs.open(
    filename,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    0o600,
  );
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function backup(ctx, destination) {
  const filename = path.resolve(destination);
  // Hard-link the completed temp file to its final name: atomic and never overwrites.
  const temporary = `${filename}.partial-${randomBytes(8).toString("hex")}`;
  const manifest = `${filename}.manifest.json`;
  let linked = false;
  let manifestWritten = false;
  const handle = await fs.open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    0o600,
  );
  try {
    await ctx.docker(
      [
        "exec",
        "-T",
        "postgres",
        "pg_dump",
        "-U",
        ctx.values.POSTGRES_USER,
        "-d",
        ctx.values.POSTGRES_DB,
        "--format=custom",
        "--compress=6",
      ],
      { stdoutFile: handle.fd },
    );
    await handle.sync();
    const stat = await handle.stat();
    if (stat.size < 5) throw new Error("Database dump is empty.");
    const signature = Buffer.alloc(5);
    await handle.close();
    const reader = await fs.open(temporary, "r");
    try {
      await reader.read(signature, 0, 5, 0);
    } finally {
      await reader.close();
    }
    if (signature.toString() !== "PGDMP")
      throw new Error("Database dump has an invalid format.");
    const metadata = {
      format: "artmate-wms-postgres-custom-v1",
      createdAt: new Date().toISOString(),
      database: ctx.values.POSTGRES_DB,
      bytes: stat.size,
      sha256: await hashFile(temporary),
      marketplaceKeyRequired: true,
    };
    await exclusiveWrite(manifest, `${JSON.stringify(metadata, null, 2)}\n`);
    manifestWritten = true;
    await fs.link(temporary, filename);
    linked = true;
    return { filename, metadata };
  } catch (error) {
    if (linked) await fs.unlink(filename).catch(() => {});
    if (manifestWritten) await fs.unlink(manifest).catch(() => {});
    throw error;
  } finally {
    await handle.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
  }
}

export async function validateBackup(filename) {
  await protectedFile(filename);
  await protectedFile(`${filename}.manifest.json`);
  const metadata = JSON.parse(
    await fs.readFile(`${filename}.manifest.json`, "utf8"),
  );
  const stat = await fs.stat(filename);
  if (
    metadata.format !== "artmate-wms-postgres-custom-v1" ||
    !applicationDatabase(metadata.database) ||
    metadata.bytes !== stat.size ||
    metadata.sha256 !== (await hashFile(filename))
  )
    throw new Error("Backup manifest or checksum does not match.");
  return metadata;
}

export function main(action) {
  action().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

export function isMain(url) {
  return (
    Boolean(process.argv[1]) &&
    url === pathToFileURL(path.resolve(process.argv[1])).href
  );
}
