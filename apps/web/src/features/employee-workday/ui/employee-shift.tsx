"use client";
import { Play, Coffee, CircleCheck } from "lucide-react";
import { Button } from "@/shared/ui";
import type { EmployeeDto } from "@/shared/api/generated/model";
import styles from "./workday.module.css";
export function EmployeeShift({
  employee,
  pending,
  error,
  onStart,
  onWork,
}: {
  employee: EmployeeDto;
  pending: boolean;
  error: string | null;
  onStart: () => void;
  onWork: () => void;
}) {
  const working = employee.status === "working",
    pause = employee.status === "break";
  return (
    <section className={styles.card} aria-label="Моя смена">
      <div className={styles.icon}>
        {working ? (
          <CircleCheck size={28} />
        ) : pause ? (
          <Coffee size={28} />
        ) : (
          <Play size={28} />
        )}
      </div>
      <p className={styles.name}>{employee.name}</p>
      <h1>
        {working ? "Вы на смене" : pause ? "Вы на перерыве" : "Начнём работу?"}
      </h1>
      <p className={styles.hint}>
        {working
          ? "Можно вернуться к заданию."
          : pause
            ? "Задание и собранный товар сохранены."
            : "Начните смену и отсканируйте QR рабочей зоны."}
      </p>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <Button
        className={styles.action}
        disabled={pending}
        aria-busy={pending}
        onClick={working ? onWork : onStart}
      >
        {working ? "К заданию" : pause ? "Продолжить смену" : "Начать смену"}
      </Button>
    </section>
  );
}
