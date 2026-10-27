import type { TaskDto } from "../dto";
export type AutomaticTaskPurpose = "urgent" | "backlog";
export type AutomaticTaskIntent =
  | {
      kind: "create";
      skuId: string;
      boxesTarget: number;
      purpose: AutomaticTaskPurpose;
      proposalHash: string;
    }
  | {
      kind: "resize";
      taskId: string;
      boxesTarget: number;
      purpose: AutomaticTaskPurpose;
      proposalHash: string;
    }
  | { kind: "withdraw"; taskId: string; reason: string };
export interface AutomaticTaskOrigin {
  taskId: string;
  skuId: string;
  purpose: AutomaticTaskPurpose;
  proposalHash: string;
  createdAt: string;
  updatedAt: string;
  boxesTarget: number;
  status: "queued" | "withdrawn";
  withdrawnAt: string | null;
  withdrawnReason: string | null;
  withdrawnTask: TaskDto | null;
}
export interface AutomationSettings {
  enabled: boolean;
  updatedAt: string | null;
  actorAccountId: string | null;
}
export interface AutomationRuntime {
  lastCheckedAt: string | null;
  message: string;
  blockers: string[];
}
