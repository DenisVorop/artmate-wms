import assert from "node:assert/strict";
import test from "node:test";
import {
  runStocktakeCommand,
  type StocktakeCommandPorts,
} from "./stocktake-command";

test("refresh failure after a committed command never invites a duplicate write", async () => {
  let writes = 0,
    cache: unknown;
  const result = await runStocktakeCommand({
    isScopeCurrent: () => true,
    cancelReads: async () => {},
    command: async () => {
      writes++;
      return { id: "doc", revision: 2 };
    },
    cache: (value) => {
      cache = value;
    },
    invalidate: async () => {
      throw new Error("offline");
    },
  });
  assert.equal(writes, 1);
  assert.deepEqual(cache, result);
  assert.equal(result.revision, 2);
});
test("identity changes during the write or read cancellation reject before caching", async () => {
  for (const changeAt of ["command", "cancel"]) {
    let current = true,
      cancels = 0,
      cached = false;
    const ports: StocktakeCommandPorts<string> = {
      isScopeCurrent: () => current,
      cancelReads: async () => {
        cancels++;
        if (changeAt === "cancel" && cancels === 2) current = false;
      },
      command: async () => {
        if (changeAt === "command") current = false;
        return "old";
      },
      cache: () => {
        cached = true;
      },
      invalidate: async () => {},
    };
    await assert.rejects(runStocktakeCommand(ports), /Сессия изменилась/);
    assert.equal(cached, false);
  }
});
test("scope changes inside failed invalidation cannot be swallowed as a read failure", async () => {
  let current = true;
  await assert.rejects(
    runStocktakeCommand({
      isScopeCurrent: () => current,
      cancelReads: async () => {},
      command: async () => "done",
      cache: () => {},
      invalidate: async () => {
        current = false;
        throw new Error("offline");
      },
    }),
    /Сессия изменилась/,
  );
});

test("postcommit cancellation failure still caches and returns the committed result", async () => {
  let cancels = 0,
    writes = 0,
    cached = false,
    invalidated = false;
  const result = await runStocktakeCommand({
    isScopeCurrent: () => true,
    cancelReads: async () => {
      if (++cancels === 2) throw new Error("cancel failed");
    },
    command: async () => {
      writes++;
      return "saved";
    },
    cache: () => {
      cached = true;
    },
    invalidate: async () => {
      invalidated = true;
    },
  });
  assert.equal(result, "saved");
  assert.equal(writes, 1);
  assert.equal(cached, true);
  assert.equal(invalidated, true);
});
