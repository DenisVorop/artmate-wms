"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as api from "./generated/client";
import type {
  CreateWorkZoneDto,
  UpdateWorkZoneDto,
  StartZoneWorkDto,
  ScanShipmentWorkDto,
  FinishShipmentWorkDto,
  AdjustStockDto,
  CreateSpaceDto,
  UpdateSpaceDto,
  ResizeSpaceDto,
  UpdateWarehousePlanDto,
  CreateAisleDto,
  UpdateAisleDto,
  CreateEntranceDto,
  UpdateEntranceDto,
  CreateLocationDto,
  UpdateLocationDto,
  CreateReceiptDto,
  CreateSkuDto,
  CreateEmployeeDto,
  PlaceReceiptPalletDto,
  BindReceiptPalletLabelDto,
  CreateTaskDto,
  ClaimTaskDto,
  ClaimPutawayTaskDto,
  ConfirmPutawayTaskDto,
  TakePutawayBoxDto,
  PlacePutawayBoxDto,
  AssignTaskDto,
  ScanTaskDto,
  PackTaskDto,
  UpdateTaskStatusDto,
  CreateShipmentDto,
  UpdateShiftDto,
  CommandDto,
  WorkspaceDto,
  CreateRackSectionDto,
  CopyRackSectionDto,
  UpdateRackSectionDto,
  CreateRackLevelDto,
  UpdateSkuPackagingDto,
  CreateMovementDto,
  ClaimMovementDto,
  ConfirmMovementDto,
  RetireEmptyPalletDto,
} from "./generated/model";
import {
  workspaceQueryKey,
  stockLedgerQueryKey,
  workforceQueryKey,
  stocktakeQueryKey,
} from "./query-keys";
import { getAuthEpoch } from "./auth-memory";
import { ApiError } from "./api-error";
import { runWarehouseCommand } from "./run-warehouse-command";
export function useWarehouseCommands() {
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(command: () => Promise<WorkspaceDto>) {
    const epoch = getAuthEpoch();
    setPending(true);
    setError(null);
    try {
      const result = await runWarehouseCommand({
        command,
        isScopeCurrent: () => getAuthEpoch() === epoch,
        cancelRead: () => client.cancelQueries({ queryKey: workspaceQueryKey }),
        readCurrent: () => api.getWorkspace(),
        getCached: () => client.getQueryData(workspaceQueryKey),
        setCached: (snapshot) => {
          client.setQueryData(workspaceQueryKey, snapshot);
        },
        invalidate: () =>
          client.invalidateQueries({
            queryKey: workspaceQueryKey,
            refetchType: "none",
          }),
      });
      if (getAuthEpoch() !== epoch)
        throw new ApiError(
          "Сессия изменилась. Результат прежнего пользователя отклонён.",
          409,
        );
      void client.invalidateQueries({ queryKey: stockLedgerQueryKey });
      void client.invalidateQueries({ queryKey: workforceQueryKey });
      void client.invalidateQueries({ queryKey: stocktakeQueryKey });
      return result;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось сохранить изменение",
      );
      throw e;
    } finally {
      setPending(false);
    }
  }
  return {
    pending,
    error,
    clearError: () => setError(null),
    createWorkZone: (dto: CreateWorkZoneDto) =>
      run(() => api.createWorkZone(dto)),
    updateWorkZone: (id: string, dto: UpdateWorkZoneDto) =>
      run(() => api.updateWorkZone(id, dto)),
    archiveWorkZone: (id: string, dto: CommandDto) =>
      run(() => api.archiveWorkZone(id, dto)),
    restoreWorkZone: (id: string, dto: CommandDto) =>
      run(() => api.restoreWorkZone(id, dto)),
    startZoneWork: (dto: StartZoneWorkDto) => run(() => api.startZoneWork(dto)),
    leaveZoneWork: (dto: ClaimTaskDto) => run(() => api.leaveZoneWork(dto)),
    scanShipmentWork: (id: string, dto: ScanShipmentWorkDto) =>
      run(() => api.scanShipmentWork(id, dto)),
    finishShipmentWork: (id: string, dto: FinishShipmentWorkDto) =>
      run(() => api.finishShipmentWork(id, dto)),
    adjustStock: (dto: AdjustStockDto) => run(() => api.adjustStock(dto)),
    createSpace: (dto: CreateSpaceDto) => run(() => api.createSpace(dto)),
    updateSpace: (id: string, dto: UpdateSpaceDto) =>
      run(() => api.updateSpace(id, dto)),
    resizeSpace: (id: string, dto: ResizeSpaceDto) =>
      run(() => api.resizeSpace(id, dto)),
    deleteSpace: (id: string, dto: CommandDto) =>
      run(() => api.deleteSpace(id, dto)),
    restoreSpace: (id: string, dto: CommandDto) =>
      run(() => api.restoreSpace(id, dto)),
    updateWarehousePlan: (dto: UpdateWarehousePlanDto) =>
      run(() => api.updateWarehousePlan(dto)),
    createAisle: (dto: CreateAisleDto) => run(() => api.createAisle(dto)),
    updateAisle: (id: string, dto: UpdateAisleDto) =>
      run(() => api.updateAisle(id, dto)),
    createEntrance: (dto: CreateEntranceDto) =>
      run(() => api.createEntrance(dto)),
    updateEntrance: (id: string, dto: UpdateEntranceDto) =>
      run(() => api.updateEntrance(id, dto)),
    deleteLocation: (id: string, dto: CommandDto) =>
      run(() => api.deleteLocation(id, dto)),
    restoreLocation: (id: string, dto: CommandDto) =>
      run(() => api.restoreLocation(id, dto)),
    deleteRackSection: (id: string, dto: CommandDto) =>
      run(() => api.deleteRackSection(id, dto)),
    restoreRackSection: (id: string, dto: CommandDto) =>
      run(() => api.restoreRackSection(id, dto)),
    deleteAisle: (id: string, dto: CommandDto) =>
      run(() => api.deleteAisle(id, dto)),
    restoreAisle: (id: string, dto: CommandDto) =>
      run(() => api.restoreAisle(id, dto)),
    deleteEntrance: (id: string, dto: CommandDto) =>
      run(() => api.deleteEntrance(id, dto)),
    restoreEntrance: (id: string, dto: CommandDto) =>
      run(() => api.restoreEntrance(id, dto)),
    createRackSection: (dto: CreateRackSectionDto) =>
      run(() => api.createRackSection(dto)),
    copyRackSection: (id: string, dto: CopyRackSectionDto) =>
      run(() => api.copyRackSection(id, dto)),
    updateRackSection: (id: string, dto: UpdateRackSectionDto) =>
      run(() => api.updateRackSection(id, dto)),
    createRackLevel: (id: string, dto: CreateRackLevelDto) =>
      run(() => api.createRackLevel(id, dto)),
    updateSkuPackaging: (id: string, dto: UpdateSkuPackagingDto) =>
      run(() => api.updateSkuPackaging(id, dto)),
    createMovement: (dto: CreateMovementDto) =>
      run(() => api.createMovement(dto)),
    claimMovement: (id: string, dto: ClaimMovementDto) =>
      run(() => api.claimMovement(id, dto)),
    takeMovement: (id: string, dto: ConfirmMovementDto) =>
      run(() => api.takeMovement(id, dto)),
    placeMovement: (id: string, dto: ConfirmMovementDto) =>
      run(() => api.placeMovement(id, dto)),
    cancelMovement: (id: string, dto: CommandDto) =>
      run(() => api.cancelMovement(id, dto)),
    retireEmptyPallet: (id: string, dto: RetireEmptyPalletDto) =>
      run(() => api.retireEmptyPallet(id, dto)),
    createLocation: (dto: CreateLocationDto) =>
      run(() => api.createLocation(dto)),
    updateLocation: (id: string, dto: UpdateLocationDto) =>
      run(() => api.updateLocation(id, dto)),
    createReceipt: (dto: CreateReceiptDto) => run(() => api.createReceipt(dto)),
    bindReceiptPalletLabel: (
      receiptId: string,
      palletId: string,
      dto: BindReceiptPalletLabelDto,
    ) => run(() => api.bindReceiptPalletLabel(receiptId, palletId, dto)),
    createSku: (dto: CreateSkuDto) => run(() => api.createSku(dto)),
    placeReceiptPallet: (
      receiptId: string,
      palletId: string,
      dto: PlaceReceiptPalletDto,
    ) => run(() => api.placeReceiptPallet(receiptId, palletId, dto)),
    createEmployee: (dto: CreateEmployeeDto) =>
      run(() => api.createEmployee(dto)),
    createTask: (dto: CreateTaskDto) => run(() => api.createTask(dto)),
    claimPutawayTask: (id: string, dto: ClaimPutawayTaskDto) =>
      run(() => api.claimPutawayTask(id, dto)),
    takePutawayTask: (id: string, dto: ConfirmPutawayTaskDto) =>
      run(() => api.takePutawayTask(id, dto)),
    placePutawayTask: (id: string, dto: ConfirmPutawayTaskDto) =>
      run(() => api.placePutawayTask(id, dto)),
    takeAnyPutawayBox: (dto: TakePutawayBoxDto) =>
      run(() => api.takeAnyPutawayBox(dto)),
    takePutawayBox: (id: string, dto: TakePutawayBoxDto) =>
      run(() => api.takePutawayBox(id, dto)),
    placePutawayBox: (id: string, dto: PlacePutawayBoxDto) =>
      run(() => api.placePutawayBox(id, dto)),
    releasePutawayTask: (id: string, dto: ClaimPutawayTaskDto) =>
      run(() => api.releasePutawayTask(id, dto)),
    claimTask: (id: string, dto: ClaimTaskDto) =>
      run(() => api.claimTask(id, dto)),
    assignTask: (id: string, dto: AssignTaskDto) =>
      run(() => api.assignTask(id, dto)),
    scanTask: (id: string, dto: ScanTaskDto) =>
      run(() => api.scanTask(id, dto)),
    packTask: (id: string, dto: PackTaskDto) =>
      run(() => api.packTask(id, dto)),
    updateTaskStatus: (id: string, dto: UpdateTaskStatusDto) =>
      run(() => api.updateTaskStatus(id, dto)),
    createShipment: (dto: CreateShipmentDto) =>
      run(() => api.createShipment(dto)),
    shipShipment: (id: string, dto: CommandDto) =>
      run(() => api.shipShipment(id, dto)),
    updateEmployeeShift: (id: string, dto: UpdateShiftDto) =>
      run(() => api.updateEmployeeShift(id, dto)),
  };
}
