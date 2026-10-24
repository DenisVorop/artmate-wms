"use client";
import { useEffect, useMemo, useRef } from "react";
import {
  ArchiveRestore,
  Check,
  DoorOpen,
  Hand,
  Layers3,
  LoaderCircle,
  Maximize2,
  Minus,
  MousePointer2,
  Move,
  Route,
  Ruler,
  Square,
  X,
  ZoomIn,
} from "lucide-react";
import { useWorkspace } from "@/entities/workspace";
import { Button, EmptyState, ErrorState, LoadingState } from "@/shared/ui";
import { PalletDtoStatus } from "@/shared/api/generated/model";
import {
  addressInventory,
  mapObjects,
  selectSavedCanvasObject,
} from "../lib/map-view-model";
import { findSuggestedPosition } from "../lib/plan-geometry";
import { scaleBar } from "../lib/plan-viewport";
import { DEFAULT_STORAGE_FOOTPRINT } from "../lib/location-form";
import { useMapInteraction } from "../lib/use-map-interaction";
import { useLayoutState } from "../lib/use-layout-state";
import { useLocationActions } from "../model/use-location-actions";
import { LocationForm } from "./location-form";
import { LocationLabel } from "./location-label";
import { RackSectionForm } from "./rack-section-form";
import { RackLevelForm } from "./rack-level-form";
import { LocationDetails } from "./location-details";
import { PlanObjectDetails } from "./plan-object-details";
import { WarehousePlanForm } from "./warehouse-plan-form";
import { AisleForm } from "./aisle-form";
import { EntranceForm } from "./entrance-form";
import { LayoutTrash } from "./layout-trash";
import { PlanCanvas } from "./plan-canvas";
import { SpaceForm } from "./space-form";
import { SpaceDetails } from "./space-details";
import { SpaceResizeForm } from "./space-resize-form";
import { SectionCopyPlacement } from "./section-copy-placement";
import {
  growWorkingField,
  MAX_WORKING_FIELD_METERS,
} from "../lib/field-resize";
import resizeStyles from "./resize-shell.module.css";
import styles from "./warehouse-layout.module.css";
import scaleStyles from "./scale-controls.module.css";

export function WarehouseLayoutFeature() {
  const workspace = useWorkspace();
  const commands = useLocationActions();
  const ui = useLayoutState();
  const copying = useRef(false);
  const data = workspace.data;
  const copySection = data?.sections.find(
    (section) => section.id === ui.sectionCopyId && !section.archived,
  );
  useEffect(() => {
    if (data && ui.sectionCopyId && !copySection) ui.setSectionCopyId(null);
  }, [data, ui.sectionCopyId, copySection, ui.setSectionCopyId]);
  const objects = useMemo(() => (data ? mapObjects(data) : []), [data]);
  const aisles = useMemo(
    () => data?.aisles.filter((item) => !item.archived) ?? [],
    [data],
  );
  const entrances = useMemo(
    () => data?.entrances.filter((item) => !item.archived) ?? [],
    [data],
  );
  const room = data?.warehouse;
  const spaces = room?.spaces.filter((item) => !item.archived) ?? [];
  const suggestion = useMemo(
    () =>
      room
        ? findSuggestedPosition(
            room,
            [...objects, ...aisles],
            DEFAULT_STORAGE_FOOTPRINT,
          )
        : null,
    [room, objects, aisles],
  );
  const aisleSuggestion = useMemo(
    () =>
      room
        ? findSuggestedPosition(room, objects, {
            width: 2,
            depth: 3,
            rotation: 0,
          })
        : null,
    [room, objects],
  );
  const formIsOpen = !!(
    ui.spaceFormId ||
    ui.spaceResizeId ||
    ui.locationFormId ||
    ui.sectionFormId ||
    ui.addLevelSectionId ||
    ui.aisleFormId ||
    ui.entranceFormId ||
    ui.planSettingsOpen ||
    ui.trashOpen
  );
  const map = useMapInteraction({
    bounds: room ?? { width: 1, depth: 1 },
    enabled: !!room,
    dragEnabled:
      !ui.drawKind && !ui.sectionCopyId && !formIsOpen && !commands.pending,
    onMove: commands.move,
    onMoveEntrance: commands.moveEntrance,
    onResizeSpace: commands.resizeSpace,
  });
  if (workspace.isPending)
    return <LoadingState label="Загружаем план склада…" />;
  if (!data || !room)
    return (
      <ErrorState
        message="Не удалось загрузить план склада"
        onRetry={() => void workspace.refetch()}
      />
    );
  const ruler = scaleBar(map.pixelsPerMeter);
  const selectedKey =
    [
      ...spaces.map((item) => `space:${item.id}`),
      ...objects.map((item) => item.id),
      ...aisles.map((item) => `aisle:${item.id}`),
      ...entrances.map((item) => `entrance:${item.id}`),
    ].find((key) => key === map.selectedId) ?? null;
  const selected = objects.find((item) => item.id === selectedKey);
  const selectedSpace = spaces.find(
    (item) => `space:${item.id}` === selectedKey,
  );
  const selectedAisle = aisles.find(
    (item) => `aisle:${item.id}` === selectedKey,
  );
  const selectedEntrance = entrances.find(
    (item) => `entrance:${item.id}` === selectedKey,
  );
  const activeAddresses = data.locations.filter((address) => !address.archived);
  const usedAddresses = activeAddresses.filter(
    (address) => addressInventory(data, [address.id]).occupied,
  );
  const physicalPallets = data.pallets.filter(
    (pallet) => pallet.status === PalletDtoStatus.stored,
  );
  const editSpace = room.spaces.find((space) => space.id === ui.spaceFormId);
  const resizeSpace = room.spaces.find(
    (space) => space.id === ui.spaceResizeId,
  );
  const editLocation = data.locations.find(
    (address) => address.id === ui.locationFormId,
  );
  const editSection = data.sections.find(
    (section) => section.id === ui.sectionFormId,
  );
  const addLevelSection = data.sections.find(
    (section) => section.id === ui.addLevelSectionId,
  );
  const clear = () => commands.clearError();
  const busy = commands.pending || map.saveState === "saving";
  const cancelSectionCopy = () => {
    if (!ui.sectionCopyId || copying.current) return;
    ui.setSectionCopyId(null);
    commands.clearError();
  };
  const clearSelection = () => {
    cancelSectionCopy();
    map.setSelectedId(null);
    ui.setSelectedAddressId(null);
  };
  const saved = map.saveState === "saved" && !commands.error;
  const saveText = busy
    ? "Сохраняем изменения…"
    : commands.error || map.saveState === "error"
      ? "Изменения не сохранены"
      : saved
        ? "Изменения сохранены"
        : "Изменения сохраняются автоматически";
  const openSettings = () => {
    clear();
    ui.setDrawKind(null);
    ui.setPlanSettingsOpen(true);
  };
  const openSpaceResize = (id: string) => {
    clear();
    ui.setDrawKind(null);
    map.setSelectedId(`space:${id}`);
    ui.setSpaceResizeId(id);
  };
  const growField = async (side: "right" | "bottom") => {
    if (busy || map.resizing) return;
    const next = growWorkingField(room, side);
    if (next.width === room.width && next.depth === room.depth) return;
    clear();
    try {
      await commands.resizePlan(next);
      map.markSaved();
    } catch {
      /* The shared command exposes its error; keep the current field. */
    }
  };
  const onRotate = async (key: string, rotation: number) => {
    await commands.rotate(key, rotation);
    map.markSaved();
  };
  const beginSectionCopy = (id: string) => {
    const source = data.sections.find(
      (section) => section.id === id && !section.archived,
    );
    if (!source || busy) return;
    clear();
    ui.setDrawKind(null);
    map.onPointerCancel();
    map.setPanMode(false);
    map.setSelectedId(`section:${id}`);
    ui.setSectionCopyPosition(
      findSuggestedPosition(room, [...objects, ...aisles], source) ?? {
        x: source.x,
        y: source.y,
      },
    );
    ui.setSectionCopyId(id);
  };
  const placeSectionCopy = async (position: { x: number; y: number }) => {
    if (!copySection || busy || copying.current) return;
    copying.current = true;
    const beforeIds = new Set(data.sections.map((section) => section.id));
    try {
      const updated = await commands.copySection(copySection.id, position);
      const saved = selectSavedCanvasObject(
        updated.sections,
        beforeIds,
        (section) => section.x === position.x && section.y === position.y,
      );
      ui.setSectionCopyId(null);
      map.setPanMode(false);
      if (saved) {
        map.setSelectedId(`section:${saved.id}`);
        ui.setSelectedAddressId(
          updated.locations.find(
            (address) => !address.archived && address.sectionId === saved.id,
          )?.id ?? null,
        );
      }
      map.markSaved();
    } finally {
      copying.current = false;
    }
  };
  const onArchive = async (key: string) => {
    await commands.archive(key);
    map.setSelectedId(null);
    map.markSaved();
  };
  const onEditPlanObject = (key: string) => {
    clear();
    if (key.startsWith("aisle:")) ui.setAisleFormId(key.slice(6));
    else ui.setEntranceFormId(key.slice(9));
  };

  return (
    <section className={styles.feature} aria-label="Карта и конструктор склада">
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>ПРОСТРАНСТВО · СХЕМА · АДРЕСА</div>
          <h1 className="page-heading">
            Карта склада
            <span className={styles.headingDot} />
          </h1>
          <p className="page-description">
            {room.name} · поле {room.width} × {room.depth} м. Помещения,
            коридоры и места хранения на одном плане.
          </p>
        </div>
        {!map.editing && (
          <Button onClick={() => map.setEditing(true)} disabled={busy}>
            <Move size={17} />
            Открыть конструктор
          </Button>
        )}
      </header>
      <div className={styles.summary}>
        <div>
          <span className={styles.metricValue}>
            {room.layoutMode === "spaces"
              ? Number(
                  spaces
                    .reduce((sum, space) => sum + space.width * space.depth, 0)
                    .toFixed(2),
                )
              : Number((room.width * room.depth).toFixed(2))}
          </span>
          <span>
            м² площади ·{" "}
            {room.layoutMode === "spaces"
              ? `${spaces.length} участков`
              : "прямоугольник"}
          </span>
        </div>
        <div>
          <span className={styles.metricValue}>
            {objects.filter((item) => item.section).length}
          </span>
          <span>секций стеллажей</span>
        </div>
        <div>
          <span className={styles.metricValue}>{activeAddresses.length}</span>
          <span>конечных адресов</span>
        </div>
        <div>
          <span className={styles.metricValue}>{usedAddresses.length}</span>
          <span>занято физически</span>
        </div>
        <div className={styles.summaryNote}>
          <span className={styles.liveDot} />
          Паллет на местах: {physicalPallets.length}
        </div>
      </div>
      <div className={styles.workspace}>
        <div className={`glass-panel ${styles.planCard}`}>
          <div className={styles.toolbar}>
            <div className={styles.modeSwitch} aria-label="Режим карты">
              <button
                type="button"
                className={!map.editing ? styles.modeActive : ""}
                aria-pressed={!map.editing}
                disabled={busy}
                onClick={() => {
                  cancelSectionCopy();
                  map.setEditing(false);
                  ui.setDrawKind(null);
                }}
              >
                <MousePointer2 size={15} />
                Обзор
              </button>
              <button
                type="button"
                className={map.editing ? styles.modeActive : ""}
                aria-pressed={map.editing}
                disabled={busy}
                onClick={() => map.setEditing(true)}
              >
                <Move size={15} />
                Конструктор
              </button>
            </div>
            <div className={styles.zoomControls}>
              <button
                type="button"
                aria-label="Снять выделение"
                title="Снять выделение"
                disabled={!selectedKey || busy || map.resizing}
                onClick={clearSelection}
              >
                <X size={16} />
              </button>
              <button
                type="button"
                aria-label="Перемещать карту"
                aria-pressed={map.panMode}
                onClick={() => {
                  ui.setDrawKind(null);
                  map.setPanMode(!map.panMode);
                }}
              >
                <Hand size={16} />
              </button>
              <button
                type="button"
                aria-label="Уменьшить масштаб"
                disabled={map.zoom <= 0.25}
                onClick={map.zoomOut}
              >
                <Minus size={16} />
              </button>
              <span aria-label="Текущий масштаб">
                {Math.round(map.zoom * 100)}%
              </span>
              <button
                type="button"
                aria-label="Увеличить масштаб"
                disabled={map.zoom >= 32}
                onClick={map.zoomIn}
              >
                <ZoomIn size={16} />
              </button>
              <button
                type="button"
                className={styles.fitButton}
                aria-label="Рабочий масштаб"
                onClick={map.workingScale}
              >
                <Ruler size={15} />
                <span>Рабочий</span>
              </button>
              <button
                type="button"
                className={styles.fitButton}
                aria-label="Вписать план целиком"
                onClick={map.fitPlan}
              >
                <Maximize2 size={15} />
                <span>Вписать</span>
              </button>
            </div>
          </div>
          {map.editing && (
            <div
              className={styles.toolPalette}
              role="toolbar"
              aria-label="Инструменты конструктора"
              onClickCapture={cancelSectionCopy}
            >
              <button
                type="button"
                disabled={busy}
                aria-pressed={
                  ui.drawKind === null && !map.panMode && !copySection
                }
                onClick={() => {
                  ui.setDrawKind(null);
                  map.setPanMode(false);
                }}
              >
                <Move size={17} />
                <span>Двигать объекты</span>
              </button>
              <button
                type="button"
                disabled={busy}
                aria-label="Добавить помещение рисованием"
                aria-pressed={ui.drawKind === "room"}
                onClick={() => {
                  clear();
                  map.setPanMode(false);
                  ui.setDrawKind("room");
                }}
              >
                <Square size={17} />
                <span>Добавить помещение</span>
              </button>
              <button
                type="button"
                disabled={busy}
                aria-label="Рисовать коридор"
                aria-pressed={ui.drawKind === "corridor"}
                onClick={() => {
                  clear();
                  map.setPanMode(false);
                  ui.setDrawKind("corridor");
                }}
              >
                <Route size={17} />
                <span>Коридор</span>
              </button>
              <button
                type="button"
                disabled={busy}
                aria-label="Добавить участок по размерам"
                onClick={() => {
                  clear();
                  const size = { width: 6, depth: 6, rotation: 0 };
                  const point = findSuggestedPosition(
                    { width: room.width, depth: room.depth },
                    spaces.map((item) => ({ ...item, rotation: 0 })),
                    size,
                  );
                  ui.setSpaceDraft({
                    kind: ui.drawKind ?? "room",
                    ...(point ?? { x: 0, y: 0 }),
                    width: 6,
                    depth: 6,
                  });
                  ui.setDrawKind(null);
                  ui.setSpaceFormId("new");
                }}
              >
                <Ruler size={17} />
                <span>По размерам</span>
              </button>
              <span className={styles.toolDivider} />
              <button
                type="button"
                disabled={busy}
                aria-label="Добавить секцию стеллажа"
                onClick={() => {
                  clear();
                  ui.setDrawKind(null);
                  map.setPanMode(false);
                  ui.setSectionFormId("new");
                }}
              >
                <Layers3 size={17} />
                <span>Секция</span>
              </button>
              <button
                type="button"
                disabled={busy}
                aria-label="Добавить напольное место или зону"
                onClick={() => {
                  clear();
                  ui.setDrawKind(null);
                  map.setPanMode(false);
                  ui.setLocationFormId("new");
                }}
              >
                <Square size={17} />
                <span>Место</span>
              </button>
              <button
                type="button"
                disabled={busy}
                aria-label="Добавить проход"
                onClick={() => {
                  clear();
                  ui.setDrawKind(null);
                  ui.setAisleFormId("new");
                }}
              >
                <Route size={17} />
                <span>Проход</span>
              </button>
              <button
                type="button"
                disabled={busy}
                aria-label="Добавить вход в стене"
                onClick={() => {
                  clear();
                  ui.setDrawKind(null);
                  ui.setEntranceFormId("new");
                }}
              >
                <DoorOpen size={17} />
                <span>Вход</span>
              </button>
              <span className={styles.toolDivider} />
              <button type="button" disabled={busy} onClick={openSettings}>
                <Ruler size={17} />
                <span>Рабочее поле</span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  clear();
                  ui.setDrawKind(null);
                  ui.setTrashOpen(true);
                }}
              >
                <ArchiveRestore size={17} />
                <span>Корзина</span>
              </button>
            </div>
          )}
          {map.editing && (
            <div
              className={resizeStyles.fieldToolbar}
              role="group"
              aria-label="Расширение рабочего поля"
            >
              <div className={resizeStyles.fieldTitle}>
                <strong>Рабочее поле</strong>
                <span>
                  {room.width} × {room.depth} м
                </span>
              </div>
              <div className={resizeStyles.fieldActions}>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={
                    busy ||
                    map.resizing ||
                    room.depth >= MAX_WORKING_FIELD_METERS
                  }
                  onClick={() => void growField("bottom")}
                >
                  +10 м снизу
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={
                    busy ||
                    map.resizing ||
                    room.width >= MAX_WORKING_FIELD_METERS
                  }
                  onClick={() => void growField("right")}
                >
                  +10 м справа
                </Button>
              </div>
              <p className={resizeStyles.fieldHint}>
                Расширение добавляет пустое место, сохраняя помещения и
                оборудование. Новую область создайте кнопкой «Добавить
                помещение» или «По размерам».
              </p>
            </div>
          )}
          {workspace.isError && (
            <div className={styles.layoutWarning} role="alert">
              Не удалось обновить план. Показана последняя версия, введённые
              размеры сохранены.{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() => void workspace.refetch()}
              >
                Обновить данные
              </button>
            </div>
          )}
          {map.editing && !ui.drawKind && !ui.sectionCopyId && !map.panMode && (
            <div className={styles.dragHint}>
              <Move size={16} aria-hidden="true" />
              <p>
                Перетаскивайте помещения и коридоры вместе с целиком
                расположенными внутри стеллажами, местами и проходами. Объекты
                также можно двигать отдельно, входы — вдоль стен. Размеры
                выбранного помещения меняются ручками по краям. Масштаб —
                колесом мыши или жестом на трекпаде. Шаг — 10 см; Escape
                отменяет жест. Точные координаты доступны в настройках
                выбранного объекта.
              </p>
            </div>
          )}
          {!ui.drawKind && !ui.sectionCopyId && (
            <div className={styles.dragHint}>
              <Hand size={16} aria-hidden="true" />
              <p>
                Тяните пустой фон, чтобы перемещаться по карте. Клик по пустому
                месту снимает выделение. Инструмент «Рука» позволяет тянуть
                карту поверх объектов. Стрелки клавиатуры перемещают вид, когда
                карта в фокусе.
              </p>
            </div>
          )}
          {map.editing && ui.drawKind && (
            <div className={styles.layoutWarning} role="status">
              Нарисуйте {ui.drawKind === "room" ? "помещение" : "коридор"}:
              зажмите кнопку мыши и потяните по сетке. Шаг 0,5 м. После рисунка
              уточните размеры и сохраните. Escape отменяет жест.
            </div>
          )}
          {commands.error && !formIsOpen && !copySection && (
            <div className={styles.mapError} role="alert">
              {commands.error}
              <button type="button" onClick={clear}>
                Закрыть
              </button>
            </div>
          )}
          {map.editing &&
            !ui.drawKind &&
            (!suggestion || !aisleSuggestion) &&
            !(room.layoutMode === "spaces" && spaces.length === 0) && (
              <div className={styles.layoutWarning} role="status">
                Не найдена свободная позиция для{" "}
                {!suggestion ? "нового места 1,3 × 0,9 м" : "прохода 2 × 3 м"}.
                Задайте другое положение и размеры в форме или{" "}
                <button type="button" onClick={openSettings} disabled={busy}>
                  расширьте рабочее поле
                </button>
                .
              </div>
            )}
          <PlanCanvas
            data={data}
            warehouse={room}
            objects={objects}
            aisles={aisles}
            entrances={entrances}
            interaction={map}
            selectedId={selectedKey}
            pending={busy}
            drawKind={map.editing && !formIsOpen ? ui.drawKind : null}
            selectedSpaceId={selectedSpace?.id ?? null}
            onClearSelection={clearSelection}
            onRequestSpaceResize={openSpaceResize}
            copySection={copySection}
            copyPosition={ui.sectionCopyPosition}
            onCopyPositionChange={ui.setSectionCopyPosition}
            onPlaceSectionCopy={placeSectionCopy}
            onCancelSectionCopy={cancelSectionCopy}
            onSelectSpace={(id) => {
              map.setSelectedId(`space:${id}`);
              ui.setDrawKind(null);
            }}
            onDraw={(draft) => {
              clear();
              ui.setSpaceDraft(draft);
              ui.setDrawKind(null);
              ui.setSpaceFormId("new");
            }}
          />
          <footer className={styles.planFooter}>
            <div className={styles.legend}>
              <span>
                <i className={styles.rackKey} />
                Секция
              </span>
              <span>
                <i className={styles.floorKey} />
                Место
              </span>
              <span>
                <i className={styles.aisleKey} />
                Проход
              </span>
              <span>
                <i className={styles.entranceKey} />
                Вход
              </span>
              <span>
                <i className={styles.reserveKey} />
                Резерв
              </span>
            </div>
            <span
              className={scaleStyles.ruler}
              aria-label={`Масштабная линейка: ${ruler.meters} м`}
            >
              <i
                className={scaleStyles.rulerLine}
                style={{ width: ruler.widthPx }}
                aria-hidden="true"
              />
              {ruler.meters.toLocaleString("ru-RU", {
                maximumFractionDigits: 4,
              })}{" "}
              м
            </span>
            <span className={styles.planInstruction}>
              {map.panMode
                ? "Тяните карту для перемещения"
                : copySection
                  ? "Клик — разместить копию"
                  : map.editing
                    ? ui.drawKind
                      ? "Рисование — шаг 0,5 м"
                      : "Перетаскивание — шаг 0,1 м"
                    : "Выберите объект, затем нужный адрес"}
            </span>
          </footer>
          <div
            className={`${styles.saveStatus} ${commands.error || map.saveState === "error" ? styles.saveStatusError : ""}`}
            role="status"
            aria-live="polite"
          >
            {busy ? (
              <LoaderCircle size={13} className={styles.savingSpinner} />
            ) : saved ? (
              <Check size={13} />
            ) : (
              <span className={styles.saveStatusDot} />
            )}
            {saveText}
          </div>
          {!ui.drawKind &&
            spaces.length === 0 &&
            objects.length === 0 &&
            aisles.length === 0 &&
            entrances.length === 0 && (
              <div className={styles.emptyOverlay}>
                <EmptyState
                  title={
                    spaces.length
                      ? "Добавьте места хранения"
                      : "Нарисуйте свой склад"
                  }
                  description={
                    spaces.length
                      ? "Внутри помещений и коридоров можно разместить секции и временные места."
                      : "Выберите «Добавить помещение» или «Коридор» и растяните прямоугольник на сетке. Точные размеры можно задать числом."
                  }
                  action={
                    <Button
                      onClick={() => {
                        map.setEditing(true);
                        map.setPanMode(false);
                        ui.setDrawKind("room");
                      }}
                    >
                      Рисовать помещение
                    </Button>
                  }
                />
              </div>
            )}
        </div>
        {copySection ? (
          <SectionCopyPlacement
            section={copySection}
            position={ui.sectionCopyPosition}
            activeLevelCount={
              data.locations.filter(
                (address) =>
                  !address.archived && address.sectionId === copySection.id,
              ).length
            }
            pending={busy}
            error={commands.error}
            onPositionChange={ui.setSectionCopyPosition}
            onPlace={placeSectionCopy}
            onCancel={cancelSectionCopy}
          />
        ) : selectedSpace ? (
          <SpaceDetails
            data={data}
            space={selectedSpace}
            editing={map.editing}
            pending={busy}
            error={formIsOpen ? null : commands.error}
            onEdit={(id) => {
              clear();
              ui.setSpaceDraft(undefined);
              ui.setSpaceFormId(id);
            }}
            onResize={openSpaceResize}
            onArchive={onArchive}
          />
        ) : selectedAisle || selectedEntrance ? (
          <PlanObjectDetails
            aisle={selectedAisle}
            entrance={selectedEntrance}
            warehouse={room}
            editing={map.editing}
            pending={busy}
            error={formIsOpen ? null : commands.error}
            onEdit={onEditPlanObject}
            onRotate={onRotate}
            onArchive={onArchive}
          />
        ) : (
          <LocationDetails
            data={data}
            object={selected}
            selectedAddressId={ui.selectedAddressId}
            editing={map.editing}
            pending={busy}
            error={formIsOpen ? null : commands.error}
            onSelectAddress={ui.setSelectedAddressId}
            onLabel={ui.setLabelId}
            onEditAddress={(id) => {
              clear();
              ui.setLocationFormId(id);
            }}
            onEditSection={(id) => {
              clear();
              ui.setSectionFormId(id);
            }}
            onAddLevel={(id) => {
              clear();
              ui.setAddLevelSectionId(id);
            }}
            onCopySection={beginSectionCopy}
            onRotate={onRotate}
            onArchive={onArchive}
          />
        )}
      </div>
      <SpaceResizeForm
        open={!!ui.spaceResizeId}
        space={resizeSpace}
        warehouse={room}
        pending={busy}
        error={commands.error}
        onClose={() => ui.setSpaceResizeId(null)}
        onSave={async (id, values) => {
          await commands.resizeSpace(id, values);
          map.markSaved();
        }}
      />
      <SpaceForm
        open={!!ui.spaceFormId}
        space={editSpace}
        draft={ui.spaceDraft}
        warehouse={room}
        pending={busy}
        error={commands.error}
        onClose={() => {
          ui.setSpaceFormId(null);
          ui.setSpaceDraft(undefined);
        }}
        onSave={async (values, id) => {
          const beforeIds = new Set(room.spaces.map((item) => item.id));
          const updated = await commands.saveSpace(values, id);
          const saved = selectSavedCanvasObject(
            updated.warehouse.spaces,
            beforeIds,
            (item) =>
              item.name === values.name &&
              item.x === values.x &&
              item.y === values.y &&
              item.width === values.width &&
              item.depth === values.depth &&
              item.kind === values.kind,
            id,
          );
          if (saved) map.setSelectedId(`space:${saved.id}`);
          map.markSaved();
        }}
      />
      <LocationForm
        open={!!ui.locationFormId}
        location={editLocation}
        sections={data.sections}
        allLocations={data.locations}
        suggestedPosition={suggestion ?? { x: 0, y: 0 }}
        onClose={() => ui.setLocationFormId(null)}
        pending={busy}
        error={commands.error}
        onSave={async (values, id, isRack) => {
          const updated = await commands.saveLocation(values, id, isRack);
          const saved = updated.locations.find((address) =>
            id ? address.id === id : address.code === values.code,
          );
          if (saved) {
            map.setSelectedId(
              saved.sectionId
                ? `section:${saved.sectionId}`
                : `location:${saved.id}`,
            );
            ui.setSelectedAddressId(saved.id);
          }
          map.markSaved();
        }}
      />
      <RackSectionForm
        open={!!ui.sectionFormId}
        section={editSection}
        sections={data.sections}
        allLocations={data.locations}
        locations={data.locations.filter(
          (address) => address.sectionId === editSection?.id,
        )}
        suggestedPosition={suggestion ?? { x: 0, y: 0 }}
        onClose={() => ui.setSectionFormId(null)}
        pending={busy}
        error={commands.error}
        onSave={async (values, id) => {
          const updated = await commands.saveSection(values, id);
          const saved = updated.sections.find((section) =>
            id ? section.id === id : section.code === values.code,
          );
          if (saved) {
            map.setSelectedId(`section:${saved.id}`);
            ui.setSelectedAddressId(
              updated.locations.find(
                (address) =>
                  !address.archived && address.sectionId === saved.id,
              )?.id ?? null,
            );
          }
          map.markSaved();
        }}
      />
      <RackLevelForm
        section={addLevelSection}
        locations={data.locations.filter(
          (address) => address.sectionId === addLevelSection?.id,
        )}
        onClose={() => ui.setAddLevelSectionId(null)}
        pending={busy}
        error={commands.error}
        onSave={async (sectionId, values) => {
          const updated = await commands.addLevel(sectionId, values);
          const saved = updated.locations.find(
            (address) =>
              address.sectionId === sectionId && address.code === values.code,
          );
          if (saved) {
            map.setSelectedId(`section:${sectionId}`);
            ui.setSelectedAddressId(saved.id);
          }
          map.markSaved();
        }}
      />
      <WarehousePlanForm
        open={ui.planSettingsOpen}
        warehouse={room}
        onClose={() => ui.setPlanSettingsOpen(false)}
        pending={busy}
        error={commands.error}
        onSave={async (values) => {
          await commands.saveWarehousePlan(values);
          map.markSaved();
        }}
      />
      <AisleForm
        open={!!ui.aisleFormId}
        aisle={data.aisles.find((item) => item.id === ui.aisleFormId)}
        suggestedPosition={aisleSuggestion ?? { x: 0, y: 0 }}
        onClose={() => ui.setAisleFormId(null)}
        pending={busy}
        error={commands.error}
        onSave={async (values, id) => {
          const beforeIds = new Set(data.aisles.map((item) => item.id));
          const updated = await commands.saveAisle(values, id);
          const saved = selectSavedCanvasObject(
            updated.aisles,
            beforeIds,
            (item) =>
              item.name === values.name &&
              item.x === values.x &&
              item.y === values.y &&
              item.width === values.width &&
              item.depth === values.depth &&
              item.rotation === values.rotation,
            id,
          );
          if (saved) map.setSelectedId(`aisle:${saved.id}`);
          map.markSaved();
        }}
      />
      <EntranceForm
        entrances={data.entrances}
        open={!!ui.entranceFormId}
        entrance={data.entrances.find((item) => item.id === ui.entranceFormId)}
        warehouse={room}
        onClose={() => ui.setEntranceFormId(null)}
        pending={busy}
        error={commands.error}
        onSave={async (values, id) => {
          const beforeIds = new Set(data.entrances.map((item) => item.id));
          const updated = await commands.saveEntrance(values, id);
          const saved = selectSavedCanvasObject(
            updated.entrances,
            beforeIds,
            (item) =>
              item.name === values.name &&
              item.spaceId === values.spaceId &&
              item.wall === values.wall &&
              item.offset === values.offset &&
              item.width === values.width,
            id,
          );
          if (saved) map.setSelectedId(`entrance:${saved.id}`);
          map.markSaved();
        }}
      />
      <LayoutTrash
        open={ui.trashOpen}
        data={data}
        onClose={() => ui.setTrashOpen(false)}
        pending={busy}
        error={commands.error}
        onRestore={async (key) => {
          const updated = await commands.restore(key);
          if (key.startsWith("location:")) {
            const address = updated.locations.find(
              (item) => item.id === key.slice(9),
            );
            if (address) {
              map.setSelectedId(
                address.sectionId ? `section:${address.sectionId}` : key,
              );
              ui.setSelectedAddressId(address.id);
            }
          } else map.setSelectedId(key);
          map.markSaved();
        }}
      />
      <LocationLabel id={ui.labelId} onClose={() => ui.setLabelId(null)} />
    </section>
  );
}
