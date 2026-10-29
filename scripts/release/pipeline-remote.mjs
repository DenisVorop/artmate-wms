import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  args,
  required,
  root,
  readEnvironment,
  protectedFile,
  exclusiveWrite,
  context,
  run,
  isMain,
  main,
} from "./lib.mjs";
import { validateManifest } from "./pipeline.mjs";
import { deploy } from "./deploy.mjs";

export function preserveConfiguration(existing, candidate) {
  const keys = new Set([...Object.keys(existing), ...Object.keys(candidate)]);
  for (const key of keys) {
    if (["WMS_API_IMAGE", "WMS_WEB_IMAGE"].includes(key)) continue;
    if (existing[key] !== candidate[key])
      throw new Error(
        `Production configuration differs at ${key}; update it explicitly on the host and in GitHub before deployment. Existing credentials were preserved.`,
      );
  }
  return {
    ...existing,
    WMS_API_IMAGE: candidate.WMS_API_IMAGE,
    WMS_WEB_IMAGE: candidate.WMS_WEB_IMAGE,
  };
}
export async function verifyImages(manifest, execute = run) {
  for (const target of ["api", "web"]) {
    const image = manifest.images[target];
    await execute("docker", ["pull", image]);
    const output = await execute("docker", [
      "image",
      "inspect",
      image,
      "--format",
      "{{json .Config.Labels}}",
    ]);
    const labels = JSON.parse(output);
    if (
      labels?.["org.opencontainers.image.revision"] !== manifest.sha ||
      labels?.["org.opencontainers.image.source"] !==
        `https://github.com/${manifest.repository}`
    )
      throw new Error(
        "Published image revision/source does not match the verified release manifest. No application service was stopped.",
      );
  }
}
export async function remoteDeploy(options) {
  if (Number(process.versions.node.split(".")[0]) !== 24)
    throw new Error(
      "Production deployment requires Node.js 24 LTS on the host.",
    );
  if (process.getuid?.() === 0)
    throw new Error("Use the dedicated non-root deployment account.");
  const ingress = options["--ingress"] ?? "none";
  if (!["none", "edge"].includes(ingress))
    throw new Error("Ingress must be none or edge.");
  const base = "/opt/artmate-wms";
  if (
    !root.startsWith(`${base}/releases/`) ||
    (await fs.realpath(root)) !== root ||
    (await fs.realpath(base)) !== base
  )
    throw new Error(
      "Release must run from a regular directory below /opt/artmate-wms/releases.",
    );
  const shared = path.join(base, "shared");
  await fs.mkdir(shared, { recursive: true, mode: 0o700 });
  await fs.chmod(shared, 0o700);
  const lock = path.join(shared, "deploy.lock");
  await fs.mkdir(lock, { mode: 0o700 }).catch(() => {
    throw new Error(
      "Another release holds deploy.lock; investigate before removing a stale lock.",
    );
  });
  let registryDirectory;
  const previousDockerConfig = process.env.DOCKER_CONFIG;
  try {
    const manifest = JSON.parse(
      await fs.readFile(required(options, "--manifest"), "utf8"),
    );
    validateManifest(manifest, manifest.repository, manifest.sha);
    let previousRelease;
    try {
      previousRelease = JSON.parse(
        await fs.readFile(path.join(shared, "current-release.json"), "utf8"),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (previousRelease?.ingress === "edge" && ingress !== "edge")
      throw new Error(
        "Public edge is already enabled; keep ingress=edge. Disabling public access requires a separate explicit operation.",
      );
    const candidateFile = path.resolve(required(options, "--env-file"));
    const candidate = await readEnvironment(candidateFile);
    if (
      candidate.WMS_API_IMAGE !== manifest.images.api ||
      candidate.WMS_WEB_IMAGE !== manifest.images.web
    )
      throw new Error("Candidate images differ from the release manifest.");
    const installedFile = path.join(shared, ".env.production");
    let installed;
    try {
      installed = await readEnvironment(installedFile);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const values = installed
      ? preserveConfiguration(installed, candidate)
      : candidate;
    await protectedFile(path.join(root, ".registry-token"));
    await protectedFile(path.join(root, ".registry-user"));
    const registryUser = await fs.readFile(
      path.join(root, ".registry-user"),
      "utf8",
    );
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}(?:\[bot\])?$/.test(registryUser))
      throw new Error("Invalid registry identity.");
    registryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "wms-registry-"),
    );
    process.env.DOCKER_CONFIG = registryDirectory;
    await run(
      "docker",
      ["login", "ghcr.io", "--username", registryUser, "--password-stdin"],
      { input: await fs.readFile(path.join(root, ".registry-token")) },
    );
    await fs.unlink(path.join(root, ".registry-token"));
    // Pull and verify BOTH images and Compose before any env replacement or service stop.
    await verifyImages(manifest);
    await context({ "--env-file": candidateFile, "--ingress": ingress });
    await run("docker", ["compose", "version", "--short"]);
    await fs.mkdir(path.join(base, "backups"), {
      recursive: true,
      mode: 0o700,
    });
    if (installed) {
      await protectedFile(installedFile);
      const temporary = path.join(shared, `.env.next-${manifest.sha}`);
      await exclusiveWrite(
        temporary,
        Object.entries(values)
          .map(([key, value]) => `${key}=${value}`)
          .join("\n") + "\n",
      );
      await fs.rename(temporary, installedFile);
    } else
      await exclusiveWrite(
        installedFile,
        Object.entries(values)
          .map(([key, value]) => `${key}=${value}`)
          .join("\n") + "\n",
      );
    const ctx = await context({
      "--env-file": installedFile,
      "--ingress": ingress,
    });
    await deploy(ctx, {
      "--backup-dir": path.join(base, "backups"),
      "--ingress": ingress,
    });
    const record = path.join(shared, `.current-release-${manifest.sha}.json`);
    await exclusiveWrite(
      record,
      JSON.stringify(
        {
          ...manifest,
          ingress,
          directory: root,
          deployedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
    );
    await fs.rename(record, path.join(shared, "current-release.json"));
    console.log(
      "Deployment completed with verified image revisions and internal health checks.",
    );
  } finally {
    if (registryDirectory)
      await fs.rm(registryDirectory, { recursive: true, force: true });
    if (previousDockerConfig === undefined) delete process.env.DOCKER_CONFIG;
    else process.env.DOCKER_CONFIG = previousDockerConfig;
    await fs.unlink(path.join(root, ".registry-token")).catch(() => {});
    await fs.unlink(path.join(root, ".registry-user")).catch(() => {});
    await fs.rm(lock, { recursive: true });
    // Secret upload is temporary. The authoritative protected env remains in shared/.
    await fs.unlink(path.resolve(options["--env-file"])).catch(() => {});
  }
}
if (isMain(import.meta.url))
  main(async () =>
    remoteDeploy(
      args(process.argv.slice(2), ["--manifest", "--env-file", "--ingress"]),
    ),
  );
