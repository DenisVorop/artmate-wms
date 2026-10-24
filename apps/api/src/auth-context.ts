import { AsyncLocalStorage } from "node:async_hooks";
import * as D from "./dto";
export interface RequestAuthContext {
  http: true;
  tokenHash: string | null;
  csrfToken: string | null;
  origin: string | null;
  accountId?: string;
  employeeId?: string;
  role?: "manager" | "employee";
}
export const requestAuth = new AsyncLocalStorage<RequestAuthContext>();
export function projectWorkspace(
  state: D.WorkspaceDto,
  context = requestAuth.getStore(),
): D.WorkspaceDto {
  // Legacy cached JSON stays immutable; normalize only the response projection.
  if (
    state.warehouse &&
    (!state.warehouse.workZones || !state.warehouse.zoneWork)
  )
    state = {
      ...state,
      warehouse: {
        ...state.warehouse,
        workZones: state.warehouse.workZones ?? [],
        zoneWork: state.warehouse.zoneWork ?? [],
      },
    };
  if (!context?.http || context.role === "manager") return state;
  const id = context.employeeId;
  const addressHolds: D.AddressHoldDto[] = [];
  for (const m of state.movements)
    if (["planned", "in_transit"].includes(m.status))
      addressHolds.push({ locationId: m.toLocationId, kind: "movement" });
  for (const t of state.putawayTasks)
    if (["claimed", "in_transit"].includes(t.status) && t.toLocationId)
      addressHolds.push({ locationId: t.toLocationId, kind: "putaway" });
  for (const p of state.pallets)
    if (p.returnLocationId)
      addressHolds.push({ locationId: p.returnLocationId, kind: "return" });
  return {
    ...state,
    addressHolds: [
      ...new Map(
        addressHolds.map((h) => [`${h.kind}/${h.locationId}`, h]),
      ).values(),
    ],
    employees: state.employees.filter((e) => e.id === id),
    tasks: state.tasks.filter(
      (t) =>
        t.employeeId === id || (t.status === "queued" && t.employeeId === null),
    ),
    putawayTasks: state.putawayTasks.filter(
      (t) => t.employeeId === id || t.status === "queued",
    ),
    movements: state.movements.filter((m) => m.employeeId === id),
    warehouse: {
      ...state.warehouse,
      zoneWork: (state.warehouse.zoneWork ?? []).filter(
        (w) => w.employeeId === id,
      ),
    },
    shipments: state.shipments.filter((x) => x.employeeId === id),
    activities: [],
    receipts: state.receipts.filter((r) => r.status !== "completed"),
  };
}
