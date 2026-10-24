"use client";
import {
  ArrowDownToLine,
  Box,
  Layers3,
  LockKeyhole,
  Pencil,
  Plus,
  QrCode,
  Warehouse,
  RotateCw,
  Trash2,
  Copy,
} from "lucide-react";
import { Badge, Button, EmptyState } from "@/shared/ui";
import type { LocationDto, WorkspaceDto } from "@/shared/api/generated/model";
import { PalletDtoKind } from "@/shared/api/generated/model";
import {
  addressAvailability,
  addressInventory,
  type MapObject,
} from "../lib/map-view-model";
import { locationKindLabel } from "../lib/location-form";
import styles from "./warehouse-layout.module.css";
import panelStyles from "./plan-panels.module.css";
import { archiveReasons } from "../lib/layout-archive";

type Props = {
  data: WorkspaceDto;
  object?: MapObject;
  selectedAddressId: string | null;
  onSelectAddress: (id: string) => void;
  onLabel: (id: string) => void;
  onEditAddress: (id: string) => void;
  onEditSection: (id: string) => void;
  onAddLevel: (id: string) => void;
  onCopySection: (id: string) => void;
  editing?: boolean;
  pending: boolean;
  error: string | null;
  onRotate: (key: string, rotation: number) => Promise<unknown>;
  onArchive: (key: string) => Promise<unknown>;
};
export function LocationDetails({
  data,
  object,
  selectedAddressId,
  onSelectAddress,
  onLabel,
  onEditAddress,
  onEditSection,
  onAddLevel,
  onCopySection,
  editing = true,
  pending,
  error,
  onRotate,
  onArchive,
}: Props) {
  if (!object)
    return (
      <aside className={`glass-panel ${styles.details}`}>
        <EmptyState
          title="Ничего не выбрано"
          description="Нажмите на помещение, коридор или объект на карте, чтобы открыть его параметры."
        />
      </aside>
    );
  const address =
    object.addresses.find((item) => item.id === selectedAddressId) ??
    object.addresses[0];
  const inventory = address ? addressInventory(data, [address.id]) : null;
  const availability = address
    ? addressAvailability(data, address)
    : "Нет ярусов";
  const tone =
    address?.blocked || inventory?.reserved
      ? "warning"
      : inventory?.occupied
        ? "neutral"
        : "success";
  const selectedSkuIds = new Set([
    ...(inventory?.pallets
      .map((pallet) => pallet.skuId)
      .filter((id): id is string => id !== null) ?? []),
    ...(inventory?.boxes.map((box) => box.skuId) ?? []),
  ]);

  const rotation =
    object.section?.rotation ?? object.addresses[0]?.rotation ?? 0;
  const addressReasons = address ? archiveReasons(data, [address.id]) : [];
  const sectionReasons = object.section
    ? archiveReasons(
        data,
        data.locations
          .filter(
            (location) =>
              location.sectionId === object.section!.id && !location.archived,
          )
          .map((location) => location.id),
      )
    : [];

  function levelStatus(level: LocationDto) {
    const content = addressInventory(data, [level.id]);
    const raw = content.pallets
      .filter((pallet) => pallet.kind === PalletDtoKind.raw)
      .reduce((sum, pallet) => sum + pallet.quantity, 0);
    return `${content.pallets.length} палл. · ${raw ? `${raw.toLocaleString("ru-RU")} раскр. · ` : ""}${content.boxes.length}/${level.maxBoxes} кор.`;
  }

  return (
    <aside
      className={`glass-panel ${styles.details}`}
      aria-label="Секция и выбранный адрес"
    >
      <div className={styles.detailsHeading}>
        <span className={styles.detailIcon}>
          <Warehouse size={21} />
        </span>
        <Badge tone={tone}>
          {object.section && address ? `Ярус ${address.level} · ` : ""}
          {availability}
        </Badge>
      </div>
      <div className={styles.eyebrow}>
        {object.section ? "Секция стеллажа" : locationKindLabel(object.kind)}
      </div>
      <h2 className={styles.address}>{object.code}</h2>
      <p className={styles.locationName}>{object.name}</p>
      <div className={styles.dimensions}>
        <div>
          <span>
            {object.width} × {object.depth}
            <small>м</small>
          </span>
          <p>Размер на плане</p>
        </div>
        <div>
          <span>{object.addresses.length}</span>
          <p>{object.section ? "Адресов ярусов" : "Конечный адрес"}</p>
        </div>
      </div>
      {editing && (
        <div className={panelStyles.rotation}>
          <span>
            Поворот на плане <strong>{rotation}°</strong>
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            aria-busy={pending}
            onClick={() =>
              void onRotate(object.id, (rotation + 90) % 360).catch(() => {})
            }
          >
            <RotateCw size={14} />
            Повернуть на 90°
          </Button>
        </div>
      )}
      {object.section && (
        <>
          {editing && (
            <Button
              variant="secondary"
              disabled={pending || object.addresses.length === 0}
              onClick={() => onCopySection(object.section!.id)}
            >
              <Copy size={15} />
              Копировать секцию
            </Button>
          )}
          <div className={styles.formSectionHeading}>
            <span className={styles.detailRow}>
              <Layers3 size={16} />
              Ярусы секции
            </span>
            {editing && (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => onAddLevel(object.section!.id)}
              >
                <Plus size={14} />
                Ярус
              </Button>
            )}
          </div>
          <div
            className={styles.addressLevels}
            aria-label="Конечные адреса ярусов"
          >
            {[...object.addresses].reverse().map((level) => (
              <div
                key={level.id}
                className={`${styles.addressLevel} ${address?.id === level.id ? styles.addressLevelSelected : ""}`}
              >
                <button
                  type="button"
                  className={styles.levelSelect}
                  onClick={() => onSelectAddress(level.id)}
                  aria-pressed={address?.id === level.id}
                >
                  <strong>
                    Ярус {level.level}
                    <span>{level.code}</span>
                  </strong>
                  <span>{levelStatus(level)}</span>
                  <small>{addressAvailability(data, level)}</small>
                </button>
                <button
                  type="button"
                  className={styles.levelQr}
                  aria-label={`QR адреса ${level.code}`}
                  onClick={() => {
                    onSelectAddress(level.id);
                    onLabel(level.id);
                  }}
                >
                  <QrCode size={16} />
                </button>
              </div>
            ))}
          </div>
          {editing && (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => onEditSection(object.section!.id)}
            >
              <Pencil size={13} />
              Настроить секцию на плане
            </Button>
          )}
        </>
      )}
      {address && inventory && (
        <>
          {object.section && (
            <div className={styles.chosenAddress}>
              <span className={styles.eyebrow}>Выбранный адрес</span>
              <h3>{address.code}</h3>
              <p>{address.name}</p>
            </div>
          )}
          <div className={styles.physicalLimits}>
            <div>
              <span>Полезные габариты</span>
              <strong>
                {address.availableWidthMm} × {address.availableDepthMm} ×{" "}
                {address.maxHeightMm} мм
              </strong>
            </div>
            <div>
              <span>Вместимость</span>
              <strong>1 паллета · до {address.maxBoxes} коробов</strong>
            </div>
            <div>
              <span>Масса паллеты</span>
              <strong>
                {address.maxWeightKg === null
                  ? "Без ограничения"
                  : `до ${address.maxWeightKg} кг`}
              </strong>
            </div>
            <div>
              <span>Сторон доступа</span>
              <strong>{address.accessSides}</strong>
            </div>
          </div>
          {(inventory.incoming.length > 0 ||
            inventory.incomingPutaways.length > 0 ||
            inventory.returnPallets.length > 0) && (
            <div className={styles.reservationNotice}>
              {inventory.incoming.map((movement) => (
                <p key={movement.id}>
                  Ожидает паллету{" "}
                  {data.pallets.find(
                    (pallet) => pallet.id === movement.palletId,
                  )?.code ?? movement.palletId}{" "}
                  · {movement.code}
                </p>
              ))}
              {inventory.incomingPutaways.map((task) => (
                <p key={task.id}>
                  Резерв для короба{" "}
                  {data.boxes.find((box) => box.id === task.boxId)?.code ??
                    task.boxId}{" "}
                  · {data.skus.find((sku) => sku.id === task.skuId)?.name} ·{" "}
                  {task.code}
                </p>
              ))}
              {inventory.returnPallets.map((pallet) => (
                <p key={pallet.id}>
                  Удерживается для возврата паллеты {pallet.code}
                </p>
              ))}
            </div>
          )}
          <div className={styles.inventoryHeading}>
            СЕЙЧАС ПО АДРЕСУ
            <span>
              {inventory.pallets.length} паллет · {inventory.boxes.length}{" "}
              коробов
            </span>
          </div>
          {selectedSkuIds.size > 0 && (
            <div className={styles.inventory}>
              {[...selectedSkuIds].map((skuId) => {
                const sku = data.skus.find((item) => item.id === skuId);
                const rawUnits = inventory.pallets
                  .filter(
                    (pallet) =>
                      pallet.skuId === skuId &&
                      pallet.kind === PalletDtoKind.raw,
                  )
                  .reduce((sum, pallet) => sum + pallet.quantity, 0);
                const boxes = inventory.boxes.filter(
                  (box) => box.skuId === skuId,
                ).length;
                return (
                  <div className={styles.sku} key={skuId}>
                    <span className={styles.skuMark}>
                      <Box size={16} />
                    </span>
                    <div>
                      <strong>{sku?.name ?? skuId}</strong>
                      <span>
                        {rawUnits.toLocaleString("ru-RU")} раскр. · {boxes} кор.
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {inventory.pallets.map((pallet) => (
            <div className={styles.palletInfo} key={pallet.id}>
              <strong>
                {pallet.kind === "assembly"
                  ? `Общая паллета сборки · ${pallet.code}`
                  : pallet.code}
              </strong>
              <span>
                {pallet.widthMm} × {pallet.depthMm} × {pallet.heightMm} мм ·{" "}
                {pallet.weightKg === null
                  ? "масса неизвестна"
                  : `${pallet.weightKg} кг`}
              </span>
              {pallet.quantity === 0 && (
                <p>Пустая паллета остаётся на месте до подтверждения вывоза.</p>
              )}
            </div>
          ))}
          {!inventory.occupied && !inventory.reserved && !address.blocked && (
            <div className={styles.freePlace}>
              <span className={styles.liveDot} />
              Адрес свободен для размещения
            </div>
          )}
          {address.blocked && (
            <p className={styles.blockedNotice}>
              <LockKeyhole size={15} />
              Новое размещение запрещено
            </p>
          )}
          <div className={styles.detailsActions}>
            <Button variant="secondary" onClick={() => onLabel(address.id)}>
              <QrCode size={16} />
              QR адреса {address.code}
              <ArrowDownToLine size={14} />
            </Button>
            {editing && (
              <>
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() => onEditAddress(address.id)}
                >
                  <Pencil size={15} />
                  Настроить выбранный адрес
                </Button>
                <Button
                  variant="danger"
                  disabled={pending || addressReasons.length > 0}
                  aria-busy={pending}
                  onClick={() =>
                    void onArchive(`location:${address.id}`).catch(() => {})
                  }
                >
                  <Trash2 size={15} />
                  Удалить выбранный адрес с плана
                </Button>
                {addressReasons.length > 0 ? (
                  <ul className={panelStyles.reasonList}>
                    {addressReasons.map((reason) => (
                      <li className={panelStyles.reason} key={reason}>
                        {reason}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={panelStyles.reason}>
                    Адрес останется в корзине вместе с историей и прежним QR.
                  </p>
                )}
              </>
            )}
          </div>
        </>
      )}
      {editing && object.section && (
        <div className={panelStyles.actions}>
          <Button
            variant="danger"
            disabled={pending || sectionReasons.length > 0}
            aria-busy={pending}
            onClick={() =>
              void onArchive(`section:${object.section!.id}`).catch(() => {})
            }
          >
            <Trash2 size={15} />
            Удалить секцию и активные ярусы
          </Button>
          {sectionReasons.length > 0 ? (
            <ul className={panelStyles.reasonList}>
              {sectionReasons.map((reason) => (
                <li className={panelStyles.reason} key={reason}>
                  {reason}
                </li>
              ))}
            </ul>
          ) : (
            <p className={panelStyles.reason}>
              В корзину попадут секция и её активные адреса (
              {object.addresses.length}). История и QR сохранятся.
            </p>
          )}
        </div>
      )}
      {error && (
        <p className={panelStyles.error} role="alert">
          {error}
        </p>
      )}
    </aside>
  );
}
