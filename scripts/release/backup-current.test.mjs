import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareBackup, runBackup } from "./backup-current.mjs";

async function fixture(t) {
  // Canonicalize /tmp on macOS, where it is a symlink to /private/tmp.
  const base = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "wms-daily-test-")),
  );
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const shared = path.join(base, "shared");
  const releases = path.join(base, "releases");
  const release = path.join(releases, `${"a".repeat(40)}-123-1`);
  await fs.mkdir(shared, { mode: 0o700 });
  await fs.mkdir(path.join(base, "backups"), { mode: 0o700 });
  await fs.mkdir(path.join(release, "scripts/release"), { recursive: true });
  await fs.writeFile(path.join(release, "scripts/release/backup.mjs"), "", {
    mode: 0o600,
  });
  const record = path.join(shared, "current-release.json");
  await fs.writeFile(record, JSON.stringify({ directory: release }), {
    mode: 0o600,
  });
  const envFile = path.join(shared, ".env.production");
  await fs.writeFile(envFile, "FAKE_FIXTURE=yes\n", { mode: 0o600 });
  return { base, shared, releases, release, record, envFile };
}

test("selects activated release and delegates only backup command with protected paths", async (t) => {
  const f = await fixture(t);
  const plan = await prepareBackup(f.base, new Date("2026-10-29T00:15:00Z"));
  assert.equal(
    plan.output,
    path.join(f.base, "backups/daily-2026-10-29T00-15-00.000Z.dump"),
  );
  const result = await runBackup(plan, (command, args, options) => {
    assert.equal(command, process.execPath);
    assert.deepEqual(args, [
      path.join(f.release, "scripts/release/backup.mjs"),
      "--env-file",
      f.envFile,
      "--output",
      plan.output,
    ]);
    assert.equal(options.cwd, f.release);
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("exit", 0));
    return child;
  });
  assert.equal(result, 0);
});

test("does not invoke backup or read release while deployment lock exists", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.shared, "deploy.lock"));
  await fs.unlink(f.record);
  const plan = await prepareBackup(f.base);
  assert.deepEqual(plan, { skipped: true });
  assert.equal(
    await runBackup(plan, () => assert.fail("No child should run")),
    0,
  );
});

test("rejects release outside releases", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.record, JSON.stringify({ directory: "/etc" }));
  await assert.rejects(prepareBackup(f.base));
});

test("rejects symlinked release even inside releases", async (t) => {
  const f = await fixture(t);
  const symlink = path.join(f.releases, `${"b".repeat(40)}-123-1`);
  await fs.symlink(f.release, symlink);
  await fs.writeFile(f.record, JSON.stringify({ directory: symlink }));
  await assert.rejects(prepareBackup(f.base));
});

test("rejects symlinked or group-readable environment", async (t) => {
  const f = await fixture(t);
  await fs.chmod(f.envFile, 0o640);
  await assert.rejects(prepareBackup(f.base));
  await fs.unlink(f.envFile);
  await fs.symlink(f.record, f.envFile);
  await assert.rejects(prepareBackup(f.base));
});

test("rejects public backup directory", async (t) => {
  const f = await fixture(t);
  await fs.chmod(path.join(f.base, "backups"), 0o755);
  await assert.rejects(prepareBackup(f.base));
});

test("propagates child failure", async () => {
  assert.equal(
    await runBackup(
      {
        script: "backup.mjs",
        envFile: "env",
        output: "out",
        release: "/private/tmp",
      },
      () => {
        const child = new EventEmitter();
        queueMicrotask(() => child.emit("exit", 1));
        return child;
      },
    ),
    1,
  );
});
