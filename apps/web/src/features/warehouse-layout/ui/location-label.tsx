"use client";

import Link from "next/link";
import { Printer } from "lucide-react";
import { ErrorState, LoadingState, Modal } from "@/shared/ui";
import { useLocationLabel } from "../model/use-location-label";
import styles from "./warehouse-layout.module.css";

type Props = { id: string | null; onClose: () => void };

export function LocationLabel({ id, onClose }: Props) {
  const label = useLocationLabel(id);
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
          <Link
            href={`/labels/a4?type=location&id=${encodeURIComponent(id!)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="button button--secondary"
          >
            <Printer size={16} />
            Табличка на А4
          </Link>
          <Link
            href={`/labels/location/${encodeURIComponent(id!)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="button button--primary"
          >
            <Printer size={16} />
            Этикетка 75 × 120
          </Link>
        </div>
      )}
    </Modal>
  );
}
