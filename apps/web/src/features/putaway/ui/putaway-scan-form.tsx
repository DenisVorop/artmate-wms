"use client";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ScanLine } from "lucide-react";
import { Button, Input } from "@/shared/ui";
import {
  emptyPutawayScans,
  putawayScanSchema,
  type PutawayScanValues,
} from "../lib/putaway-form";
import styles from "./putaway.module.css";
export function PutawayScanForm({
  phase,
  pending,
  onScan,
}: {
  phase: "take" | "place";
  pending: boolean;
  onScan: (values: PutawayScanValues) => Promise<boolean>;
}) {
  const form = useForm<PutawayScanValues>({
    resolver: zodResolver(putawayScanSchema),
    defaultValues: emptyPutawayScans(),
  });
  const focused = useRef(false);
  const { setFocus } = form;
  useEffect(() => {
    if (!pending && !focused.current) {
      setFocus("boxCode");
      focused.current = true;
    }
  }, [pending, setFocus]);
  const submit = form.handleSubmit(async (values) => {
    if (pending) return;
    if (await onScan(values)) form.reset(emptyPutawayScans());
  });
  return (
    <form
      onSubmit={submit}
      noValidate
      className={styles.scanForm}
      aria-busy={pending}
    >
      <fieldset disabled={pending} className={styles.fieldset}>
        <label className="field">
          <span className={styles.scanStep}>
            <span>1</span>Код короба
          </span>
          <Input
            className={styles.scanInput}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="Отсканируйте QR короба"
            {...form.register("boxCode")}
            aria-invalid={!!form.formState.errors.boxCode}
            onKeyDown={async (event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (await form.trigger("boxCode"))
                  form.setFocus("locationCode");
              }
            }}
          />
          {form.formState.errors.boxCode && (
            <span className={styles.error}>
              {form.formState.errors.boxCode.message}
            </span>
          )}
        </label>
        <label className="field">
          <span className={styles.scanStep}>
            <span>2</span>
            {phase === "take"
              ? "Адрес накопительной паллеты"
              : "Зарезервированный адрес хранения"}
          </span>
          <Input
            className={styles.scanInput}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={
              phase === "take"
                ? "Отсканируйте QR места сборки"
                : "Отсканируйте QR места хранения"
            }
            {...form.register("locationCode")}
            aria-invalid={!!form.formState.errors.locationCode}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
          />
          {form.formState.errors.locationCode && (
            <span className={styles.error}>
              {form.formState.errors.locationCode.message}
            </span>
          )}
        </label>
      </fieldset>
      <Button type="submit" disabled={pending} aria-busy={pending}>
        <ScanLine size={15} />
        {phase === "take" ? "Забрать короб" : "Разместить короб"}
      </Button>
      <p className={styles.help}>
        Поля заполняются сканером или вручную. Показанные коды не подставляются
        автоматически.
      </p>
    </form>
  );
}
