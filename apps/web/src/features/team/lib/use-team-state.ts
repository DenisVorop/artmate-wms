"use client";
import { useState } from "react";
export function useTeamState() {
  const [createOpen, setCreateOpen] = useState(false);
  const [createdEmployeeId, setCreatedEmployeeId] = useState<string | null>(
    null,
  );
  return { createOpen, setCreateOpen, createdEmployeeId, setCreatedEmployeeId };
}
