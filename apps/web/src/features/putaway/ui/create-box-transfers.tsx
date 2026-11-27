"use client";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { WorkspaceDto } from "@/shared/api/generated/model";
import { useWarehouseCommands } from "@/shared/api/use-warehouse-commands";
import { Button, Modal, Select } from "@/shared/ui";
import {
  boxTransferSchema,
  transferableBoxes,
  type BoxTransferValues,
} from "../lib/box-transfer-form";
import styles from "./putaway.module.css";

export function CreateBoxTransfers({ data }: { data: WorkspaceDto }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const commands = useWarehouseCommands();
  const zones = data.warehouse.workZones.filter(
    (zone) => zone.kind === "putaway" && !zone.archived,
  );
  const form = useForm<BoxTransferValues>({
    resolver: zodResolver(boxTransferSchema),
    defaultValues: {
      fromLocationId: "",
      toLocationId: "",
      boxIds: [],
      zoneId: zones.length === 1 ? zones[0].id : "",
    },
  });
  const sourceId = useWatch({ control: form.control, name: "fromLocationId" });
  const available = transferableBoxes(data);
  const sources = data.locations.filter((location) =>
    available.some((box) => box.locationId === location.id),
  );
  const targets = data.locations.filter(
    (location) =>
      !location.archived &&
      !location.blocked &&
      ["floor", "rack"].includes(location.kind) &&
      location.id !== sourceId,
  );
  const boxes = available.filter((box) => box.locationId === sourceId);
  const errors = form.formState.errors;
  return (
    <>
      <Button
        variant="secondary"
        className={styles.transferButton}
        onClick={() => {
          commands.clearError();
          setNotice("");
          form.reset({
            fromLocationId: "",
            toLocationId: "",
            boxIds: [],
            zoneId: zones.length === 1 ? zones[0].id : "",
          });
          setOpen(true);
        }}
      >
        Перенести короба
      </Button>
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      <Modal
        open={open}
        title="Перенос коробов"
        onClose={() => {
          if (!commands.pending) setOpen(false);
        }}
      >
        <form
          className={styles.transferForm}
          onSubmit={form.handleSubmit(async (values) => {
            if (commands.pending) return;
            try {
              await commands.createBoxTransfers({
                requestId: crypto.randomUUID(),
                boxIds: values.boxIds,
                toLocationId: values.toLocationId,
                zoneId: values.zoneId,
              });
              setNotice(`Создано заданий на перенос: ${values.boxIds.length}`);
              setOpen(false);
            } catch {
              /* The command error is displayed below. */
            }
          })}
        >
          <label className="field">
            Откуда
            <Select
              aria-label="Откуда"
              disabled={commands.pending}
              {...form.register("fromLocationId", {
                onChange: () => form.setValue("boxIds", []),
              })}
            >
              <option value="">Выберите адрес</option>
              {sources.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.code}
                </option>
              ))}
            </Select>
            {errors.fromLocationId && (
              <span className={styles.error}>
                {errors.fromLocationId.message}
              </span>
            )}
          </label>
          <fieldset className={styles.fieldset} disabled={commands.pending}>
            <legend>Короба</legend>
            {boxes.map((box) => (
              <label key={box.id} className={styles.transferBox}>
                <input
                  type="checkbox"
                  value={box.id}
                  {...form.register("boxIds")}
                />
                {data.skus.find((sku) => sku.id === box.skuId)?.name} ·{" "}
                {box.code} · {box.units} шт.
              </label>
            ))}
            {errors.boxIds && (
              <p className={styles.error}>{errors.boxIds.message}</p>
            )}
          </fieldset>
          <label className="field">
            Куда
            <Select
              aria-label="Куда"
              disabled={commands.pending}
              {...form.register("toLocationId")}
            >
              <option value="">Выберите адрес</option>
              {targets.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.code}
                </option>
              ))}
            </Select>
            {errors.toLocationId && (
              <span className={styles.error}>
                {errors.toLocationId.message}
              </span>
            )}
          </label>
          {zones.length !== 1 && (
            <label className="field">
              Рабочая зона
              <Select
                aria-label="Рабочая зона"
                disabled={commands.pending}
                {...form.register("zoneId")}
              >
                <option value="">Выберите зону</option>
                {zones.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.name}
                  </option>
                ))}
              </Select>
            </label>
          )}
          {errors.zoneId && (
            <p className={styles.error}>{errors.zoneId.message}</p>
          )}
          {commands.error && (
            <p role="alert" className={styles.error}>
              {commands.error}
            </p>
          )}
          <div className={styles.actions}>
            <Button
              variant="secondary"
              disabled={commands.pending}
              onClick={() => setOpen(false)}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={commands.pending}>
              Создать задания
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
