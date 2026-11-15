"use client";
import { useLayoutEffect, useRef } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { useSession } from "@/entities/session";
import { useWorkspace } from "@/entities/workspace";
import { Button, ErrorState, LoadingState, Modal } from "@/shared/ui";
import type { ShipmentDto, WorkspaceDto } from "@/shared/api/generated/model";
import { useShipmentState } from "../lib/use-shipment-state";
import { useShipments } from "../model/use-shipments";
import { ShipmentDetail } from "./shipment-detail";
import { ManualShipmentForm, WbShipmentForm } from "./shipment-entry-forms";
import { ShipmentPreparationForm } from "./shipment-preparation-form";
import { ShipmentTable } from "./shipment-table";
import styles from "./shipments.module.css";

function ManagerShipmentsFeature() {
  const { data, isPending, isError, refetch } = useWorkspace();
  const commands = useShipments();
  const ui = useShipmentState();
  const heading = useRef<HTMLHeadingElement>(null);
  const previousSelection = useRef(ui.selectedId);
  useLayoutEffect(() => {
    if (previousSelection.current !== ui.selectedId) {
      previousSelection.current = ui.selectedId;
      heading.current?.focus();
    }
  }, [ui.selectedId]);

  if (isPending) return <LoadingState />;
  if (!data) return <ErrorState onRetry={() => void refetch()} />;

  const selected = data.shipments.find(
    (shipment) => shipment.id === ui.selectedId,
  );
  const select = (id: string | null) => {
    commands.clearError();
    ui.setNotice("");
    ui.setSelectedId(id);
  };
  const openCreate = (mode: "manual" | "wb") => {
    commands.clearError();
    ui.setNotice("");
    ui.setCreateMode(mode);
  };
  const closeCreate = () => {
    if (commands.pending) return;
    commands.clearError();
    ui.setCreateMode(null);
  };
  const afterCreate = (
    result: WorkspaceDto,
    matches: (shipment: ShipmentDto) => boolean,
    notice: string,
  ) => {
    const existing = new Set(data.shipments.map((shipment) => shipment.id));
    const created = result.shipments.filter(
      (shipment) => !existing.has(shipment.id) && matches(shipment),
    );
    ui.setCreateMode(null);
    ui.setSelectedId(created.length === 1 ? (created[0]?.id ?? null) : null);
    ui.setFilter("active");
    ui.setSearch("");
    ui.setNotice(notice);
  };
  const inDialog = !!ui.createMode || !!ui.preparingId;

  return (
    <div className={styles.feature}>
      <header className={styles.pageHeader}>
        <h1 className="page-heading" ref={heading} tabIndex={-1}>
          Отгрузки
        </h1>
        {selected ? (
          <Button
            variant="secondary"
            disabled={commands.pending}
            onClick={() => select(null)}
          >
            <ArrowLeft size={15} aria-hidden="true" />К списку
          </Button>
        ) : (
          <div className={styles.actions}>
            <Button
              variant="secondary"
              aria-haspopup="dialog"
              disabled={commands.pending}
              onClick={() => openCreate("wb")}
            >
              Загрузить WB
            </Button>
            <Button
              aria-haspopup="dialog"
              disabled={commands.pending}
              onClick={() => openCreate("manual")}
            >
              <Plus size={15} aria-hidden="true" />
              Новая отгрузка
            </Button>
          </div>
        )}
      </header>
      {ui.notice && (
        <p className={styles.notice} role="status">
          {ui.notice}
        </p>
      )}
      {isError && (
        <div className={styles.readError} role="alert">
          Не удалось обновить отгрузки.
          <Button
            variant="ghost"
            size="sm"
            disabled={commands.pending}
            onClick={() => void refetch()}
          >
            Повторить
          </Button>
        </div>
      )}
      {commands.error && !inDialog && (
        <div role="alert" className="ops-error">
          {commands.error}
        </div>
      )}
      {selected ? (
        <ShipmentDetail
          key={selected.id}
          shipment={selected}
          data={data}
          pending={commands.pending}
          onPrepare={(palletId) => {
            commands.clearError();
            ui.setNotice("");
            ui.setPreparingId(palletId);
          }}
          onAssign={async (employeeId) => {
            await commands.assignWb(selected.id, employeeId);
            ui.setNotice("Исполнитель назначен.");
          }}
          onShip={async () => {
            await commands.ship(selected.id);
            ui.setNotice("Отправка подтверждена.");
          }}
        />
      ) : (
        <ShipmentTable
          data={data}
          filter={ui.filter}
          search={ui.search}
          pending={commands.pending}
          onFilter={ui.setFilter}
          onSearch={ui.setSearch}
          onSelect={select}
        />
      )}
      {ui.createMode && (
        <Modal
          open
          title={
            ui.createMode === "wb" ? "Поставка Wildberries" : "Новая отгрузка"
          }
          onClose={closeCreate}
        >
          {ui.createMode === "wb" ? (
            <WbShipmentForm
              data={data}
              pending={commands.pending}
              error={commands.error}
              onSave={async (number, reservations) => {
                const result = await commands.importWb(number, reservations);
                afterCreate(
                  result,
                  (shipment) => shipment.wb?.supplyId === number,
                  "Поставка WB загружена.",
                );
              }}
            />
          ) : (
            <ManualShipmentForm
              data={data}
              pending={commands.pending}
              error={commands.error}
              onSave={async (values) => {
                const result = await commands.create(values);
                afterCreate(
                  result,
                  (shipment) =>
                    !shipment.wb &&
                    shipment.skuId === values.skuId &&
                    shipment.boxesRequested === values.boxesRequested,
                  "Отгрузка создана. Короба зарезервированы.",
                );
              }}
            />
          )}
        </Modal>
      )}
      {ui.preparingId && (
        <ShipmentPreparationForm
          palletId={ui.preparingId}
          data={data}
          pending={commands.pending}
          error={commands.error}
          onClose={() => {
            ui.setPreparingId(null);
            commands.clearError();
          }}
          onCreate={async (values) => {
            await commands.prepare(values);
            ui.setNotice("Задание на спуск создано.");
          }}
        />
      )}
    </div>
  );
}

export function ShipmentsFeature() {
  const { isManager } = useSession();
  return isManager ? <ManagerShipmentsFeature /> : null;
}
