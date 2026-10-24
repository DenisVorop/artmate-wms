import assert from "node:assert/strict";
import { test } from "node:test";
import { canOpenWorkspaceView, landingForRole } from "./workspace-access";
test("Рабочие прямые ссылки доступны сотруднику, управленческие не монтируют содержимое", () => {
  for (const route of [
    "warehouse",
    "receiving",
    "assembly",
    "putaway",
    "movements",
    "team",
  ])
    assert.equal(canOpenWorkspaceView("employee", route), true, route);
  for (const route of ["overview", "inventory", "stock-ledger", "shipments"]) {
    assert.equal(canOpenWorkspaceView("employee", route), false, route);
    assert.equal(canOpenWorkspaceView("manager", route), true, route);
  }
  assert.equal(landingForRole("employee"), "/assembly");
  assert.equal(landingForRole("manager"), "/");
});
