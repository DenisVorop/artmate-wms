import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import * as D from "./dto";
import { Queryable } from "./database";
import { requestAuth } from "./auth-context";
import { sessionRow } from "./auth-storage";
export const warehouseOperations = new Set([
  "getWorkAutomation",
  "updateWorkAutomationSettings",
  "getForecastHistory",
  "getForecastHistorySeries",
  "startForecastHistory",
  "connectForecastFinance",
  "getForecastOverview",
  "getForecastJournal",
  "getForecastJournalRun",
  "updateForecastPolicy",
  "getMarketplaces",
  "setMarketplaceResolution",
  "connectMarketplace",
  "toggleMarketplace",
  "syncMarketplace",
  "mapMarketplaceProduct",
  "updateMarketplaceSettings",
  "createMarketplaceTask",
  "createPalletLabelBatch",
  "getPalletLabelBatches",
  "getPalletLabelBatch",
  "getPalletLabelBatchLabels",
  "createBoxLabelBatch",
  "getBoxLabelBatches",
  "getBoxLabelBatch",
  "getBoxLabelBatchLabels",
  "createWorkZone",
  "updateWorkZone",
  "archiveWorkZone",
  "restoreWorkZone",
  "startZoneWork",
  "leaveZoneWork",
  "scanShipmentWork",
  "finishShipmentWork",
  "getWorkRoute",
  "getWorkspace",
  "getStocktakes",
  "getStocktake",
  "getStocktakePreview",
  "getPerformance",
  "getShiftHistory",
  "getWorkHistory",
  "getStockLedger",
  "getLabel",
  "getReceiptPlacementOptions",
  "getReceiptLabels",
  "getPutawayPlacementOptions",
  "createStocktake",
  "approveStocktake",
  "cancelStocktake",
  "claimStocktake",
  "countStocktakeLocation",
  "refreshStocktakeLocation",
  "submitStocktake",
  "adjustStock",
  "changeConsumables",
  "enableConsumables",
  "updateWarehousePlan",
  "createSpace",
  "updateSpace",
  "resizeSpace",
  "deleteSpace",
  "restoreSpace",
  "createAisle",
  "updateAisle",
  "createEntrance",
  "updateEntrance",
  "deleteLocation",
  "restoreLocation",
  "deleteRackSection",
  "restoreRackSection",
  "deleteAisle",
  "restoreAisle",
  "deleteEntrance",
  "restoreEntrance",
  "createLocation",
  "updateLocation",
  "createSku",
  "createReceipt",
  "bindReceiptPalletLabel",
  "placeReceiptPallet",
  "createEmployee",
  "createTask",
  "claimTask",
  "assignTask",
  "updateTaskStatus",
  "scanTask",
  "packTask",
  "claimPutawayTask",
  "takePutawayTask",
  "takePutawayBox",
  "takeAnyPutawayBox",
  "placePutawayTask",
  "placePutawayBox",
  "releasePutawayTask",
  "createShipment",
  "shipShipment",
  "createRackSection",
  "copyRackSection",
  "updateRackSection",
  "createRackLevel",
  "updateSkuPackaging",
  "createMovement",
  "claimMovement",
  "takeMovement",
  "placeMovement",
  "cancelMovement",
  "retireEmptyPallet",
  "updateShift",
]);
const workerReads = new Set([
  "getWorkRoute",
  "getWorkspace",
  "getStocktakes",
  "getStocktake",
  "getStocktakePreview",
  "getPerformance",
  "getShiftHistory",
  "getWorkHistory",
  "getLabel",
  "getReceiptPlacementOptions",
  "getReceiptLabels",
  "getPutawayPlacementOptions",
]);
const workerWrites = new Set([
  "startZoneWork",
  "leaveZoneWork",
  "scanShipmentWork",
  "finishShipmentWork",
  "claimStocktake",
  "countStocktakeLocation",
  "refreshStocktakeLocation",
  "submitStocktake",
  "bindReceiptPalletLabel",
  "placeReceiptPallet",
  "claimTask",
  "updateTaskStatus",
  "scanTask",
  "packTask",
  "claimPutawayTask",
  "takePutawayTask",
  "takePutawayBox",
  "takeAnyPutawayBox",
  "placePutawayTask",
  "placePutawayBox",
  "releasePutawayTask",
  "createMovement",
  "claimMovement",
  "takeMovement",
  "placeMovement",
  "cancelMovement",
  "retireEmptyPallet",
  "updateShift",
]);
const actorWrites = new Set([
  "claimMovement",
  "startZoneWork",
  "leaveZoneWork",
  "scanShipmentWork",
  "finishShipmentWork",
  "bindReceiptPalletLabel",
  "placeReceiptPallet",
  "claimTask",
  "updateTaskStatus",
  "scanTask",
  "packTask",
  "claimPutawayTask",
  "takePutawayTask",
  "takePutawayBox",
  "takeAnyPutawayBox",
  "placePutawayTask",
  "placePutawayBox",
  "releasePutawayTask",
  "adjustStock",
]);
export function allowedOrigins() {
  return new Set(
    (
      process.env.WEB_ORIGIN ??
      "http://127.0.0.1:3080,http://127.0.0.1:3081,http://localhost:3080,http://localhost:3081"
    )
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  );
}
export function requireOrigin(origin: string | null) {
  if (!origin || !allowedOrigins().has(origin))
    throw new ForbiddenException("Недопустимый источник запроса");
}
export async function requireAuth(
  tx: Queryable,
  write = false,
  allowPasswordChange = false,
) {
  const context = requestAuth.getStore();
  if (!context?.http) throw new UnauthorizedException("Войдите в систему");
  const row = await sessionRow(tx, context.tokenHash);
  if (!row) throw new UnauthorizedException("Сессия завершена. Войдите снова");
  context.accountId = row.id;
  context.employeeId = row.employee_id;
  context.role = row.role;
  if (write) {
    requireOrigin(context.origin);
    if (!context.csrfToken || context.csrfToken !== row.csrf_token)
      throw new ForbiddenException(
        "Проверка запроса не пройдена. Обновите страницу",
      );
  }
  if (row.must_change_password && !allowPasswordChange)
    throw new ForbiddenException(
      "Смените временный пароль для продолжения работы",
    );
  return row;
}
export async function authorizeWarehouse(
  tx: Queryable,
  operation: string,
  body?: D.CommandDto,
  state?: D.WorkspaceDto,
) {
  const [op, id] = operation.split("/");
  if (!warehouseOperations.has(op))
    throw new ForbiddenException("Операция не разрешена");
  const read = op.startsWith("get");
  const account = await requireAuth(tx, !read);
  if (
    account.role !== "manager" &&
    !(read ? workerReads : workerWrites).has(op)
  )
    throw new ForbiddenException("Для этого действия нужны права руководителя");
  const employeeId = body && "employeeId" in body ? body.employeeId : undefined;
  if (actorWrites.has(op) && employeeId !== account.employee_id)
    throw new ForbiddenException(
      "Нельзя выполнять работу от имени другого сотрудника",
    );
  if (
    op === "createMovement" &&
    account.role !== "manager" &&
    employeeId !== account.employee_id
  )
    throw new ForbiddenException("Можно создавать перемещение только для себя");
  if (
    op === "updateShift" &&
    account.role !== "manager" &&
    id !== account.employee_id
  )
    throw new ForbiddenException("Можно менять только свою смену");
  if (op === "retireEmptyPallet") {
    const employee = await tx.query<{ payload: D.EmployeeDto }>(
      "SELECT payload FROM employees WHERE id=$1",
      [account.employee_id],
    );
    if (employee.rows[0]?.payload.status !== "working")
      throw new ForbiddenException("Для вывоза паллеты начните свою смену");
  }
  if (state) {
    if (op === "takeAnyPutawayBox") {
      const binding = state.warehouse.zoneWork.find(
        (w) => w.employeeId === account.employee_id,
      );
      const zone = state.warehouse.workZones.find(
        (z) => z.id === binding?.zoneId,
      );
      if (!zone || zone.archived || zone.kind !== "putaway")
        throw new ForbiddenException("Сначала отсканируйте QR зоны размещения");
      const value = (body as D.TakePutawayBoxDto).boxCode;
      const box = state.boxes.find(
        (b) => value === b.code || value === `artmate-wms:box:${b.code}`,
      );
      const task =
        box &&
        state.putawayTasks.find(
          (t) => t.boxId === box.id && t.status !== "completed",
        );
      if (task?.employeeId && task.employeeId !== account.employee_id)
        throw new ForbiddenException("Этот короб уже взял другой сотрудник");
    }
    if (
      [
        "startZoneWork",
        "bindReceiptPalletLabel",
        "claimMovement",
        "scanShipmentWork",
        "finishShipmentWork",
        "takePutawayBox",
        "takeAnyPutawayBox",
        "placePutawayBox",
      ].includes(op) &&
      state.employees.find((e) => e.id === account.employee_id)?.status !==
        "working"
    )
      throw new ForbiddenException(
        "Для работы в зоне начните или возобновите свою смену",
      );
    if (
      ["scanShipmentWork", "finishShipmentWork"].includes(op) &&
      state.shipments.find((x) => x.id === id)?.employeeId !==
        account.employee_id
    )
      throw new ForbiddenException("Отгрузка принадлежит другому сотруднику");
    if (
      ["placeReceiptPallet", "bindReceiptPalletLabel"].includes(op) &&
      state.warehouse.zoneWork.some(
        (w) =>
          w.jobKind === "receiving" &&
          w.jobId === id &&
          w.palletId === operation.split("/")[2] &&
          w.employeeId !== account.employee_id,
      )
    )
      throw new ForbiddenException("Паллета приёмки взята другим сотрудником");

    if (
      account.role !== "manager" &&
      ["getReceiptLabels", "getReceiptPlacementOptions"].includes(op) &&
      state.receipts.find((r) => r.id === id)?.status === "completed"
    )
      throw new ForbiddenException("Приёмка уже завершена");
    if (account.role !== "manager" && op === "getPutawayPlacementOptions") {
      const task = state.putawayTasks.find((t) => t.id === id);
      if (
        task &&
        task.status !== "queued" &&
        task.employeeId !== account.employee_id
      )
        throw new ForbiddenException(
          "Размещение принадлежит другому сотруднику",
        );
    }
    if (
      ["takeMovement", "placeMovement"].includes(op) ||
      (op === "cancelMovement" && account.role !== "manager")
    ) {
      const movement = state.movements.find((m) => m.id === id);
      if (movement && movement.employeeId !== account.employee_id)
        throw new ForbiddenException(
          "Выполнить перемещение может только назначенный сотрудник",
        );
    }
    if (op === "claimMovement") {
      const movement = state.movements.find((m) => m.id === id);
      if (movement?.employeeId && movement.employeeId !== account.employee_id)
        throw new ForbiddenException("Перемещение уже взял другой сотрудник");
    }
    if (["scanTask", "packTask", "updateTaskStatus"].includes(op)) {
      const task = state.tasks.find((t) => t.id === id);
      if (task && task.employeeId !== account.employee_id)
        throw new ForbiddenException("Задание принадлежит другому сотруднику");
    }
    if (op === "claimTask") {
      const task = state.tasks.find((t) => t.id === id);
      if (task?.employeeId && task.employeeId !== account.employee_id)
        throw new ForbiddenException("Задание назначено другому сотруднику");
    }
    if (
      [
        "takePutawayTask",
        "placePutawayTask",
        "takePutawayBox",
        "takeAnyPutawayBox",
        "placePutawayBox",
        "releasePutawayTask",
      ].includes(op)
    ) {
      const task = state.putawayTasks.find((t) => t.id === id);
      if (task?.employeeId && task.employeeId !== account.employee_id)
        throw new ForbiddenException(
          "Размещение принадлежит другому сотруднику",
        );
    }
  }
}
