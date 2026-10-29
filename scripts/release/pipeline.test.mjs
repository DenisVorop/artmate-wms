import assert from "node:assert/strict";
import { test } from "node:test";
import {
  manifestFor,
  validateManifest,
  sshSettings,
  candidateEnvironment,
} from "./pipeline.mjs";
import { preserveConfiguration, verifyImages } from "./pipeline-remote.mjs";

const sha = "a".repeat(40);
const repository = "DenisVorop/artmate-wms";
const digests = {
  api: `sha256:${"b".repeat(64)}`,
  web: `sha256:${"c".repeat(64)}`,
};
const manifest = manifestFor(repository, sha, digests);
const ssh = {
  PRODUCTION_HOST: "178.236.242.215",
  PRODUCTION_USER: "wms-deploy",
  PRODUCTION_SSH_KEY:
    "-----BEGIN OPENSSH PRIVATE KEY-----\nfixture\n-----END OPENSSH PRIVATE KEY-----",
  PRODUCTION_KNOWN_HOSTS: "178.236.242.215 ssh-ed25519 fixture",
};

test("release manifest binds both immutable digests to the repository and full SHA", () => {
  assert.equal(
    manifest.images.api,
    `ghcr.io/denisvorop/artmate-wms-api@${digests.api}`,
  );
  assert.deepEqual(validateManifest(manifest, repository, sha), manifest);
  for (const invalid of ["latest", "a".repeat(7), `${sha};echo bad`])
    assert.throws(() => manifestFor(repository, invalid, digests));
  assert.throws(() =>
    manifestFor(repository, sha, { ...digests, web: "latest" }),
  );
});
test("manifest cannot substitute another publisher, image, commit or source repository", () => {
  assert.throws(() => validateManifest(manifest, "another/repository", sha));
  assert.throws(() => validateManifest(manifest, repository, "d".repeat(40)));
  assert.throws(() =>
    validateManifest(
      {
        ...manifest,
        images: {
          ...manifest.images,
          api: manifest.images.api.replace("/denisvorop/", "/other/"),
        },
      },
      repository,
      sha,
    ),
  );
});
test("SSH requires a key, verified host entry and allowlisted address/user/port", () => {
  assert.deepEqual(sshSettings(ssh), {
    host: "178.236.242.215",
    user: "wms-deploy",
    port: "22",
  });
  for (const field of ["PRODUCTION_HOST", "PRODUCTION_USER"])
    for (const value of [
      "-oProxyCommand=bad",
      "good;touch x",
      "good\ncommand",
      "$(command)",
      "a b",
    ])
      assert.throws(() => sshSettings({ ...ssh, [field]: value }));
  for (const value of ["0", "65536", "22;bad", "-1"])
    assert.throws(() => sshSettings({ ...ssh, PRODUCTION_PORT: value }));
  assert.throws(() => sshSettings({ ...ssh, PRODUCTION_KNOWN_HOSTS: "" }));
});
test("GitHub environment cannot override publication digests", () => {
  const candidate = candidateEnvironment(
    "WMS_DOMAIN=wms.example.com\nWMS_API_IMAGE=latest\nWMS_WEB_IMAGE=wrong\nPOSTGRES_DB=warehouse\n",
    manifest,
  );
  assert.ok(candidate.includes(`WMS_API_IMAGE=${manifest.images.api}`));
  assert.ok(candidate.includes("POSTGRES_DB=warehouse"));
  assert.ok(!candidate.includes("latest"));
  assert.throws(() => candidateEnvironment("", manifest));
});
test("updates preserve original key, database credentials and all operator configuration", () => {
  const existing = {
    WMS_DOMAIN: "wms.example.com",
    POSTGRES_DB: "warehouse",
    POSTGRES_PASSWORD: "DO-NOT-PRINT",
    WMS_MARKETPLACE_KEY: "ORIGINAL-KEY",
    WMS_API_MEMORY: "768m",
    WMS_API_IMAGE: "old-api",
    WMS_WEB_IMAGE: "old-web",
  };
  const candidate = {
    ...existing,
    WMS_API_IMAGE: manifest.images.api,
    WMS_WEB_IMAGE: manifest.images.web,
  };
  assert.deepEqual(preserveConfiguration(existing, candidate), candidate);
  for (const key of [
    "WMS_DOMAIN",
    "POSTGRES_DB",
    "POSTGRES_PASSWORD",
    "WMS_MARKETPLACE_KEY",
    "WMS_API_MEMORY",
  ]) {
    assert.throws(
      () =>
        preserveConfiguration(existing, { ...candidate, [key]: "NEW-SECRET" }),
      (error) =>
        !error.message.includes("NEW-SECRET") &&
        !error.message.includes("DO-NOT-PRINT") &&
        error.message.includes(key),
    );
  }
  assert.throws(() =>
    preserveConfiguration(existing, { ...candidate, NEW_OPTION: "on" }),
  );
});
test("both image digests and OCI revision/source are checked before accepting the release", async () => {
  const calls = [];
  await verifyImages(manifest, async (command, args) => {
    calls.push([command, ...args]);
    return JSON.stringify({
      "org.opencontainers.image.revision": sha,
      "org.opencontainers.image.source": `https://github.com/${repository}`,
    });
  });
  assert.deepEqual(
    calls.map((call) => call[1]),
    ["pull", "image", "pull", "image"],
  );
  assert.equal(calls[0][2], manifest.images.api);
  assert.equal(calls[2][2], manifest.images.web);
  assert.ok(!calls.some((call) => call.includes("stop")));
});
test("wrong revision stops release verification before any compose operation", async () => {
  const calls = [];
  await assert.rejects(
    verifyImages(manifest, async (command, args) => {
      calls.push([command, ...args]);
      return JSON.stringify({
        "org.opencontainers.image.revision": "d".repeat(40),
        "org.opencontainers.image.source": `https://github.com/${repository}`,
      });
    }),
    /revision\/source/,
  );
  assert.equal(calls.length, 2);
  assert.ok(!calls.some((call) => call.includes("compose")));
});
test("wrong source and unavailable digest fail closed", async () => {
  await assert.rejects(
    verifyImages(manifest, async () =>
      JSON.stringify({
        "org.opencontainers.image.revision": sha,
        "org.opencontainers.image.source": "https://github.com/another/repo",
      }),
    ),
    /revision\/source/,
  );
  let inspected = false;
  await assert.rejects(
    verifyImages(manifest, async (_, args) => {
      if (args[0] === "pull") throw new Error("unavailable");
      inspected = true;
    }),
    /unavailable/,
  );
  assert.equal(inspected, false);
});

test("publication CLI combines both build artifacts and refuses cross-commit mixing", async (t) => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "wms-manifest-test-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const cli = (command, extra = {}) =>
    spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./pipeline.mjs", import.meta.url)), command],
      {
        cwd: directory,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_SHA: sha,
          GITHUB_REPOSITORY: repository,
          ...extra,
        },
      },
    );
  for (const target of ["api", "web"])
    assert.equal(
      cli("image", { BUILD_TARGET: target, BUILD_DIGEST: digests[target] })
        .status,
      0,
    );
  assert.equal(cli("manifest").status, 0);
  assert.deepEqual(
    JSON.parse(
      await fs.readFile(
        path.join(directory, "release-manifest/release.json"),
        "utf8",
      ),
    ),
    manifest,
  );
  const mismatched = cli("manifest", { GITHUB_SHA: "d".repeat(40) });
  assert.notEqual(mismatched.status, 0);
  assert.match(mismatched.stderr, /provenance mismatch/);
});
