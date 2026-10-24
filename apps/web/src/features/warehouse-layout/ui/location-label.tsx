"use client";

import { Printer } from "lucide-react";
import { useState } from "react";
import { Button, ErrorState, LoadingState, Modal } from "@/shared/ui";
import { useLocationLabel } from "../model/use-location-label";
import styles from "./warehouse-layout.module.css";

type Props = { id: string | null; onClose: () => void };

export function LocationLabel({ id, onClose }: Props) {
  const label = useLocationLabel(id);
  const [printError, setPrintError] = useState<string | null>(null);

  function print() {
    if (!label.data) return;
    setPrintError(null);
    const page = window.open("", "_blank", "width=540,height=650");
    if (!page) {
      setPrintError(
        "Разрешите открытие окна печати в настройках браузера и повторите.",
      );
      return;
    }
    page.opener = null;
    page.document.title = `Адрес ${label.data.code}`;
    const style = page.document.createElement("style");
    style.textContent =
      "body{font-family:Arial,sans-serif;text-align:center;padding:24px;color:#111}h1{font-size:42px;margin:16px 0}p{font-size:18px}img{width:260px;height:260px}";
    const title = page.document.createElement("h1");
    title.textContent = label.data.code;
    const name = page.document.createElement("p");
    name.textContent = label.data.title;
    const image = page.document.createElement("img");
    image.alt = `QR адреса ${label.data.code}`;
    image.onload = () => {
      page.focus();
      page.print();
    };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(label.data.svg)}`;
    page.document.head.append(style);
    page.document.body.append(title, image, name);
  }

  return (
    <Modal
      open={!!id}
      onClose={onClose}
      title="Этикетка адреса"
      description="Наклейте QR на соответствующее место хранения."
    >
      {label.isPending && <LoadingState label="Готовим QR…" />}
      {label.isError && (
        <ErrorState
          message="Не удалось загрузить этикетку"
          onRetry={() => void label.refetch()}
        />
      )}
      {label.data && (
        <div className={styles.labelPreview}>
          <span className={styles.labelCode}>{label.data.code}</span>
          {/* This is an image, so SVG cannot execute scripts in the document. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(label.data.svg)}`}
            width={240}
            height={240}
            alt={`QR адреса ${label.data.code}`}
          />
          <p>{label.data.title}</p>
          {printError && (
            <p className={styles.error} role="alert">
              {printError}
            </p>
          )}
          <Button onClick={print}>
            <Printer size={16} />
            Распечатать
          </Button>
        </div>
      )}
    </Modal>
  );
}
