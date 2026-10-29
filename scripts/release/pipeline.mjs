import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createReadStream } from "node:fs";
import {
  args,
  required,
  run,
  readEnvironment,
  exclusiveWrite,
  root,
  isMain,
  main,
} from "./lib.mjs";

export const fullSha = /^[a-f0-9]{40}$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const repositoryPattern =
  /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
export function manifestFor(repository, sha, digests) {
  if (!repositoryPattern.test(repository) || !fullSha.test(sha))
    throw new Error("Repository and full release SHA are required.");
  const owner = repository.split("/")[0].toLowerCase();
  const images = {};
  for (const target of ["api", "web"]) {
    if (!digestPattern.test(digests[target]))
      throw new Error("Both image digests must be sha256 references.");
    images[target] =
      `ghcr.io/${owner}/artmate-wms-${target}@${digests[target]}`;
  }
  return { format: "artmate-wms-release-v1", repository, sha, images };
}
export function validateManifest(value, repository, sha) {
  if (
    !value ||
    value.format !== "artmate-wms-release-v1" ||
    value.repository !== repository ||
    value.sha !== sha
  )
    throw new Error(
      "Release manifest does not match the requested repository and SHA.",
    );
  const digests = Object.fromEntries(
    ["api", "web"].map((target) => [
      target,
      value.images?.[target]?.split("@")[1],
    ]),
  );
  const expected = manifestFor(repository, sha, digests);
  if (
    ["api", "web"].some(
      (target) => value.images[target] !== expected.images[target],
    )
  )
    throw new Error("Release image identity is invalid.");
  return expected;
}
export function sshSettings(env) {
  const host = env.PRODUCTION_HOST;
  const user = env.PRODUCTION_USER;
  const port = env.PRODUCTION_PORT || "22";
  if (
    !/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9.-]{0,251}[a-zA-Z0-9])?)$/.test(host || "") ||
    !/^[a-z_][a-z0-9_-]{0,31}$/.test(user || "") ||
    !/^[0-9]{1,5}$/.test(port) ||
    Number(port) < 1 ||
    Number(port) > 65535
  )
    throw new Error("Invalid production SSH host, user or port.");
  if (
    !env.PRODUCTION_SSH_KEY?.includes("PRIVATE KEY-----") ||
    !env.PRODUCTION_KNOWN_HOSTS?.trim() ||
    env.PRODUCTION_KNOWN_HOSTS.includes("PRIVATE KEY")
  )
    throw new Error(
      "A dedicated SSH key and independently verified known_hosts entry are required.",
    );
  return { host, user, port };
}
export function candidateEnvironment(source, manifest) {
  if (!source?.trim()) throw new Error("PRODUCTION_ENV_FILE is required.");
  // Image references are owned by the verified publication manifest, never by a secret.
  const lines = source
    .split(/\r?\n/)
    .filter((line) => !/^WMS_(API|WEB)_IMAGE=/.test(line));
  return [
    ...lines,
    `WMS_API_IMAGE=${manifest.images.api}`,
    `WMS_WEB_IMAGE=${manifest.images.web}`,
    "",
  ].join("\n");
}
export async function ship(options, env = process.env) {
  const sha = required(options, "--sha");
  const repository = env.GITHUB_REPOSITORY;
  const manifest = validateManifest(
    JSON.parse(await fs.readFile(required(options, "--manifest"), "utf8")),
    repository,
    sha,
  );
  const ingress = options["--ingress"] ?? "none";
  if (!["none", "edge"].includes(ingress))
    throw new Error("Pipeline ingress must be none or edge.");
  const { host, user, port } = sshSettings(env);
  if (
    !/^[0-9]+$/.test(env.GITHUB_RUN_ID || "") ||
    !/^[0-9]+$/.test(env.GITHUB_RUN_ATTEMPT || "")
  )
    throw new Error("GitHub run identity is required.");
  const releaseId = `${sha}-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`;
  const remoteDirectory = `/opt/artmate-wms/releases/${releaseId}`;
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "wms-pipeline-"));
  try {
    await exclusiveWrite(
      path.join(temporary, "identity"),
      env.PRODUCTION_SSH_KEY.trim() + "\n",
    );
    await exclusiveWrite(
      path.join(temporary, "known_hosts"),
      env.PRODUCTION_KNOWN_HOSTS.trim() + "\n",
    );
    const envFile = path.join(temporary, ".env.candidate");
    await exclusiveWrite(
      envFile,
      candidateEnvironment(env.PRODUCTION_ENV_FILE, manifest),
    );
    await readEnvironment(envFile);
    await exclusiveWrite(
      path.join(temporary, "release.json"),
      JSON.stringify(manifest) + "\n",
    );
    if (
      !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}(?:\[bot\])?$/.test(
        env.REGISTRY_USERNAME || "",
      ) ||
      !env.REGISTRY_TOKEN?.trim() ||
      /[\r\n]/.test(env.REGISTRY_TOKEN)
    )
      throw new Error("An ephemeral registry credential is required.");
    await exclusiveWrite(
      path.join(temporary, ".registry-token"),
      env.REGISTRY_TOKEN,
    );
    await exclusiveWrite(
      path.join(temporary, ".registry-user"),
      env.REGISTRY_USERNAME,
    );
    const archive = path.join(temporary, "release.tar");
    // Tracked infrastructure only; no source, working files, .data, credentials or DB dumps.
    await run("git", [
      "-C",
      root,
      "archive",
      "--format=tar",
      `--output=${archive}`,
      "HEAD",
      "infra",
      "scripts/release",
    ]);
    const head = await run("git", ["-C", root, "rev-parse", "HEAD"]);
    if (head !== sha) throw new Error("Checkout must match the release SHA.");
    await run("tar", [
      "--append",
      "--file",
      archive,
      "-C",
      temporary,
      ".env.candidate",
      "release.json",
      ".registry-token",
      ".registry-user",
    ]);
    const ssh = [
      "-F",
      "/dev/null",
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "GlobalKnownHostsFile=/dev/null",
      "-o",
      `UserKnownHostsFile=${path.join(temporary, "known_hosts")}`,
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "ConnectTimeout=15",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=4",
      "-i",
      path.join(temporary, "identity"),
      "-p",
      port,
      `${user}@${host}`,
    ];
    // Every interpolated component above is strictly allowlisted; production root is fixed.
    await run(
      "ssh",
      [
        ...ssh,
        `set -eu; umask 077; test "$(id -u)" -ne 0; test -d /opt/artmate-wms; test ! -L /opt/artmate-wms; mkdir -p /opt/artmate-wms/releases /opt/artmate-wms/shared /opt/artmate-wms/backups; mkdir '${remoteDirectory}'; tar -xf - -C '${remoteDirectory}'`,
      ],
      { input: createReadStream(archive) },
    );
    await run("ssh", [
      ...ssh,
      `set -eu; cd '${remoteDirectory}'; node scripts/release/pipeline-remote.mjs --manifest release.json --env-file .env.candidate --ingress '${ingress}'`,
    ]);
    console.log(
      "Release deployed. Internal health checks passed; verify public HTTPS and employee operations separately.",
    );
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
if (isMain(import.meta.url))
  main(async () => {
    const command = process.argv[2];
    if (command === "image") {
      const target = process.env.BUILD_TARGET;
      if (
        !["api", "web"].includes(target) ||
        !digestPattern.test(process.env.BUILD_DIGEST || "")
      )
        throw new Error("Invalid image build output.");
      await fs.mkdir("image-digests", { recursive: true });
      await fs.writeFile(
        `image-digests/${target}.json`,
        JSON.stringify({
          target,
          digest: process.env.BUILD_DIGEST,
          sha: process.env.GITHUB_SHA,
          repository: process.env.GITHUB_REPOSITORY,
        }) + "\n",
      );
    } else if (command === "manifest") {
      const digests = {};
      for (const target of ["api", "web"]) {
        const item = JSON.parse(
          await fs.readFile(`image-digests/${target}.json`, "utf8"),
        );
        if (
          item.target !== target ||
          item.sha !== process.env.GITHUB_SHA ||
          item.repository !== process.env.GITHUB_REPOSITORY
        )
          throw new Error("Image build provenance mismatch.");
        digests[target] = item.digest;
      }
      await fs.mkdir("release-manifest", { recursive: true });
      await fs.writeFile(
        "release-manifest/release.json",
        JSON.stringify(
          manifestFor(
            process.env.GITHUB_REPOSITORY,
            process.env.GITHUB_SHA,
            digests,
          ),
          null,
          2,
        ) + "\n",
      );
    } else if (command === "validate") {
      const options = args(process.argv.slice(3), ["--sha", "--manifest"]);
      if (!fullSha.test(required(options, "--sha")))
        throw new Error("Specify a full 40-character lowercase commit SHA.");
      if (options["--manifest"])
        validateManifest(
          JSON.parse(await fs.readFile(options["--manifest"], "utf8")),
          process.env.GITHUB_REPOSITORY,
          options["--sha"],
        );
    } else if (command === "ship")
      await ship(
        args(process.argv.slice(3), ["--sha", "--manifest", "--ingress"]),
      );
    else throw new Error("Expected image, manifest, validate or ship.");
  });
