"use client";
import type { ReactNode } from "react";
import type { WorkspaceDto } from "@/shared/api/generated/model";
import {
  LocationMapButton,
  type WorkRouteRequest,
} from "@/entities/warehouse-map";
import { Button, EmployeeScan, useEmployeeScanActivity } from "@/shared/ui";
import type { FirstScanDecision } from "../lib/receipt-pallet-scan";
import { usePairScan } from "../lib/use-pair-scan";
import { matchesScan } from "../lib/handling";
import styles from "./handling.module.css";
export function HandlingFrame({
  title,
  code,
  children,
  onIdle,
  carrying = false,
  pending = false,
  onProblem,
}: {
  title: string;
  code?: string;
  children: ReactNode;
  onIdle: () => void;
  carrying?: boolean;
  pending?: boolean;
  onProblem?: (message: string) => void;
}) {
  const { pending: scanPending } = useEmployeeScanActivity();
  return (
    <section className={`glass-panel ${styles.panel}`} aria-label={title}>
      <span className={styles.eyebrow}>{title}</span>
      {children}
      <div className={styles.actions}>
        {!carrying && (
          <Button
            variant="ghost"
            disabled={pending || scanPending > 0}
            onClick={() => {
              if (!pending && scanPending === 0) onIdle();
            }}
          >
            К основному заданию
          </Button>
        )}
        {onProblem && (
          <Button
            variant="ghost"
            onClick={() =>
              onProblem(
                `${title}${code ? ` · ${code}` : ""}. Позовите руководителя.`,
              )
            }
          >
            Нужна помощь
          </Button>
        )}
      </div>
      {carrying && (
        <p className={styles.secondary}>
          Груз уже у вас. Подтвердите размещение, прежде чем вернуться к другим
          заданиям.
        </p>
      )}
    </section>
  );
}
export function PairScan({
  contextKey,
  type,
  id,
  code,
  addressCode,
  addressId,
  routeRequest,
  data,
  phase,
  pending,
  error,
  disabled,
  onConfirm,
  onProblem,
  prepareFirst,
  firstCodeLabel,
  addressDisabled = false,
}: {
  contextKey: string;
  type: "box" | "pallet";
  id: string;
  code: string;
  addressCode: string;
  addressId?: string | null;
  routeRequest?: WorkRouteRequest;
  data: Pick<
    WorkspaceDto,
    "warehouse" | "locations" | "sections" | "aisles" | "entrances" | "revision"
  >;
  phase: "take" | "place";
  pending: boolean;
  error: string | null;
  disabled: boolean;
  onConfirm: (code: string, address: string) => Promise<boolean>;
  prepareFirst?: (value: string) => Promise<FirstScanDecision>;
  firstCodeLabel?: string;
  addressDisabled?: boolean;
  onProblem?: (message: string) => void;
}) {
  const { pending: scanPending } = useEmployeeScanActivity();
  const scan = usePairScan(
    prepareFirst ?? ((value) => matchesScan(value, type, id, code)),
    onConfirm,
  );
  return (
    <>
      <div className={styles.instruction}>
        <h3>
          {scan.first
            ? "Сканируйте адрес"
            : type === "box"
              ? "Сканируйте короб"
              : "Сканируйте паллету"}
        </h3>
        {scan.first ? (
          <>
            <strong className={styles.destinationCode}>{addressCode}</strong>
            <p>
              {phase === "take"
                ? "Подтвердите, откуда забираете груз."
                : "Поставьте груз сюда и подтвердите QR адреса."}
            </p>
            <p className={styles.objectCode}>
              {type === "box" ? "Короб" : "Паллета"} {code}
            </p>
          </>
        ) : (
          <>
            <strong className={styles.palletCode}>
              {firstCodeLabel ?? code}
            </strong>
            <p>
              {phase === "take" ? "Где взять" : "Куда поставить"}:{" "}
              <b>{addressCode}</b>
            </p>
          </>
        )}
      </div>
      <LocationMapButton
        data={data}
        locationId={addressId}
        routeRequest={routeRequest}
        intent={phase}
        contextKey={`${contextKey}:${scan.first ? "address" : "object"}:${addressId ?? "missing"}`}
      />
      <EmployeeScan
        contextKey={`${contextKey}:${scan.first ? "address" : "object"}`}
        label={
          scan.first
            ? "Сканируйте QR адреса"
            : `Сканируйте ${type === "box" ? "короб" : "паллету"}`
        }
        onScan={scan.scan}
        pending={pending}
        disabled={disabled || (!!scan.first && addressDisabled)}
        error={scan.error ?? error}
        onProblem={onProblem}
      />
      {scan.first && (
        <Button
          variant="ghost"
          disabled={pending || scanPending > 0}
          onClick={() => {
            if (!pending && scanPending === 0) scan.reset();
          }}
        >
          Сканировать {type === "box" ? "короб" : "паллету"} заново
        </Button>
      )}
    </>
  );
}
export function Done({
  message,
  onNext,
}: {
  message: string;
  onNext: () => void;
}) {
  const { pending: scanPending } = useEmployeeScanActivity();
  return (
    <>
      <p className={`${styles.notice} ${styles.success}`} role="status">
        {message}
      </p>
      <Button
        disabled={scanPending > 0}
        onClick={() => {
          if (scanPending === 0) onNext();
        }}
      >
        Следующее задание
      </Button>
    </>
  );
}
