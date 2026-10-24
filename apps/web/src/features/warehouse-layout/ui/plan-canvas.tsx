"use client";
import { useEffect } from "react";
import type {
  AisleDto,
  RackSectionDto,
  EntranceDto,
  WarehousePlanDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";
import {
  addressInventory,
  mapObjects,
  type MapObject,
} from "../lib/map-view-model";
import { locationKindLabel } from "../lib/location-form";
import {
  entranceCenter,
  entranceRotation,
  rotatedFootprint,
  planWallLines,
  type SpaceDraft,
  type Point,
} from "../lib/plan-geometry";
import { useSpaceDrawing } from "../lib/use-space-drawing";
import type { useMapInteraction } from "../lib/use-map-interaction";
import { canShowObjectLabel, shortScreenLabel } from "../lib/plan-viewport";
import { workspaceWithResizePreview } from "../lib/resize-preview";
import { resizeDirections, resizeHandlePoint } from "../lib/resize-geometry";
import resizeStyles from "./resize-handles.module.css";
import { workspaceWithSpacePreview } from "../lib/space-preview";
import { isMapObjectTarget } from "../lib/map-navigation";
import navigationStyles from "./map-navigation.module.css";
import { useSectionCopyPlacement } from "../lib/use-section-copy-placement";
import copyStyles from "./section-copy-placement.module.css";
import styles from "./warehouse-layout.module.css";

type Props = {
  data: WorkspaceDto;
  warehouse: WarehousePlanDto;
  objects: MapObject[];
  aisles: AisleDto[];
  entrances: EntranceDto[];
  interaction: ReturnType<typeof useMapInteraction>;
  selectedId: string | null;
  pending: boolean;
  highlightedAddressIds?: string[];
  drawKind?: SpaceDraft["kind"] | null;
  onDraw?: (rectangle: SpaceDraft) => void;
  selectedSpaceId?: string | null;
  onSelectSpace?: (id: string) => void;
  onRequestSpaceResize?: (id: string) => void;
  onClearSelection?: () => void;
  copySection?: RackSectionDto;
  copyPosition?: Point;
  onCopyPositionChange?: (position: Point) => void;
  onPlaceSectionCopy?: (position: Point) => Promise<unknown>;
  onCancelSectionCopy?: () => void;
};
function ScreenCallout({
  text,
  centerX,
  pixelsPerMeter,
}: {
  text: string;
  centerX: number;
  pixelsPerMeter: number;
}) {
  const width = (text.length * 7.8 + 16) / pixelsPerMeter;
  return (
    <g pointerEvents="none" className={styles.screenCallout}>
      <rect
        x={centerX - width / 2}
        y={-32 / pixelsPerMeter}
        width={width}
        height={24 / pixelsPerMeter}
        rx={5 / pixelsPerMeter}
      />
      <text
        x={centerX}
        y={-16 / pixelsPerMeter}
        textAnchor="middle"
        style={{ fontSize: 12 / pixelsPerMeter }}
      >
        {text}
      </text>
    </g>
  );
}
const wallLabels = {
  north: "верхняя",
  east: "правая",
  south: "нижняя",
  west: "левая",
};

export function PlanCanvas({
  data,
  warehouse,
  objects,
  aisles,
  entrances,
  interaction: map,
  selectedId,
  pending,
  highlightedAddressIds = [],
  drawKind = null,
  onDraw,
  selectedSpaceId = null,
  onSelectSpace,
  onRequestSpaceResize,
  onClearSelection,
  copySection,
  copyPosition,
  onCopyPositionChange,
  onPlaceSectionCopy,
  onCancelSectionCopy,
}: Props) {
  const copying = !!copySection && map.editing && !copySection.archived;
  const drawing = !!drawKind && map.editing && !map.panMode && !copying;
  const copy = useSectionCopyPlacement({
    section: copySection,
    bounds: warehouse,
    pending: pending || map.resizing || map.saveState === "saving",
    panMode: map.panMode,
    enabled: copying,
    onPositionChange: onCopyPositionChange,
    onPlace: onPlaceSectionCopy,
    onCancel: onCancelSectionCopy,
  });
  const ghostPosition = copyPosition ?? copySection;
  const ghostSize = copySection ? rotatedFootprint(copySection) : null;
  const cancelDrag = map.onPointerCancel;
  useEffect(() => {
    if (drawing || pending) cancelDrag();
  }, [drawing, pending, cancelDrag]);
  const cancelPan = map.onPanPointerCancel;
  useEffect(() => {
    if (drawing || pending || map.resizing) cancelPan();
  }, [drawing, pending, map.resizing, cancelPan]);
  const ppm = map.pixelsPerMeter;
  const unit = (pixels: number) => pixels / ppm;
  const draw = useSpaceDrawing({
    bounds: warehouse,
    kind: drawing ? drawKind : null,
    disabled: pending,
    onDraw,
  });
  const effectiveData = workspaceWithResizePreview(
    workspaceWithSpacePreview(data, map.preview),
    map.resizeSpacePreview,
  );
  const effectiveWarehouse = effectiveData.warehouse;
  const effectiveObjects =
    effectiveData === data ? objects : mapObjects(effectiveData);
  const effectiveAisles =
    effectiveData === data
      ? aisles
      : effectiveData.aisles.filter((aisle) => !aisle.archived);
  const spaces = effectiveWarehouse.spaces.filter((space) => !space.archived);
  const effectiveEntrances = entrances.map((entrance) =>
    map.entrancePreview?.id === entrance.id
      ? { ...entrance, ...map.entrancePreview }
      : entrance,
  );
  const svgProps = (id: string) => ({
    "data-map-object": id,
    tabIndex: drawing || copying ? -1 : 0,
    pointerEvents: drawing ? ("none" as const) : undefined,
    "aria-disabled": drawing || copying || undefined,
    role: "button" as const,
    "aria-pressed": selectedId === id,
    onClick: () => {
      if (!drawing && !copying) map.setSelectedId(id);
    },
    onKeyDown: (event: React.KeyboardEvent<SVGGElement>) => {
      if (
        !drawing &&
        !copying &&
        (event.key === "Enter" || event.key === " ")
      ) {
        event.preventDefault();
        map.setSelectedId(id);
      }
    },
    onPointerMove: map.onPointerMove,
    onPointerUp: (event: React.PointerEvent<SVGGElement>) =>
      void map.onPointerUp(event),
    onPointerCancel: map.onPointerCancel,
    onLostPointerCapture: map.onLostPointerCapture,
  });
  return (
    <div className={styles.canvasFrame}>
      <div
        className={`${styles.planScroll} ${!drawing ? navigationStyles.backgroundPan : ""} ${map.panMode ? styles.panViewport : ""} ${map.panning ? `${styles.panningViewport} ${navigationStyles.panning}` : ""}`}
        ref={map.scrollRef}
        tabIndex={0}
        role="region"
        aria-label="Прокручиваемая карта склада. Стрелки клавиатуры перемещают вид."
        onWheelCapture={copy.cancelPress}
        onScroll={copy.cancelPress}
        onPointerDownCapture={(event) =>
          map.onPanPointerDownCapture(event, {
            background: !isMapObjectTarget(event.target),
            drawing,
            disabled: pending || map.resizing || map.saveState === "saving",
          })
        }
        onPointerMove={map.onPanPointerMove}
        onPointerUp={map.onPanPointerUp}
        onPointerCancel={map.onPanPointerCancel}
        onLostPointerCapture={map.onPanLostPointerCapture}
        onClickCapture={(event) => {
          const outcome = map.onPanClickCapture(event);
          if (
            outcome === "clear" &&
            !drawing &&
            !copying &&
            !pending &&
            !map.resizing
          ) {
            event.currentTarget.focus({ preventScroll: true });
            onClearSelection?.();
          }
        }}
      >
        <div
          style={{
            width: map.canvasWidth + map.canvasInsetX * 2,
            height: map.canvasHeight + map.canvasInsetY * 2,
            padding: `${map.canvasInsetY}px ${map.canvasInsetX}px`,
            boxSizing: "border-box",
          }}
        >
          <svg
            ref={map.svgRef}
            className={`${styles.plan} ${drawing ? styles.drawingPlan : ""}`}
            onPointerDown={draw.onPointerDown}
            onPointerMove={draw.onPointerMove}
            onPointerUp={draw.onPointerUp}
            onPointerCancel={draw.onPointerCancel}
            onLostPointerCapture={(event) => {
              if (event.target === event.currentTarget) draw.cancel();
            }}
            style={{ width: map.canvasWidth, height: map.canvasHeight }}
            viewBox={`-1.4 -1.4 ${warehouse.width + 2.8} ${warehouse.depth + 2.8}`}
            aria-label={`План: ${warehouse.name}. Поле ${warehouse.width} на ${warehouse.depth} метров. ${drawing ? "Нарисуйте прямоугольник по фону. Escape отменяет рисунок." : "Выберите участок или объект, чтобы открыть параметры."}`}
            role="group"
          >
            <defs>
              <pattern
                id="warehouse-grid"
                width=".5"
                height=".5"
                patternUnits="userSpaceOnUse"
              >
                <circle cx=".025" cy=".025" r=".018" fill="currentColor" />
              </pattern>
              <pattern
                id="warehouse-aisle-pattern"
                width=".35"
                height=".35"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <line
                  x1="0"
                  y1="0"
                  x2="0"
                  y2=".35"
                  className={styles.aisleHatch}
                />
              </pattern>
            </defs>
            <rect
              data-draw-surface="true"
              width={warehouse.width}
              height={warehouse.depth}
              className={styles.canvasBackground}
            />
            {warehouse.layoutMode === "rectangle" && (
              <rect
                data-draw-surface="true"
                width={warehouse.width}
                height={warehouse.depth}
                className={styles.roomFill}
              />
            )}
            <rect
              width={warehouse.width}
              height={warehouse.depth}
              fill="url(#warehouse-grid)"
              className={styles.grid}
              pointerEvents="none"
            />
            <rect
              width={warehouse.width}
              height={warehouse.depth}
              className={styles.canvasBorder}
              pointerEvents="none"
            />
            <text
              x="0"
              y="-.85"
              className={styles.planLabel}
              style={{ fontSize: unit(11) }}
              pointerEvents="none"
            >
              {shortScreenLabel(
                warehouse.name,
                warehouse.width * ppm * 0.55,
                11,
              ).toLocaleUpperCase("ru-RU")}
            </text>
            <text
              x={warehouse.width}
              y="-.85"
              textAnchor="end"
              className={styles.planLabel}
              style={{ fontSize: unit(11) }}
              pointerEvents="none"
            >
              ПОЛЕ {warehouse.width} × {warehouse.depth} М
            </text>
            {warehouse.layoutMode === "spaces" &&
              spaces.map((space) => {
                const fontSize = unit(12);
                const padding = Math.min(unit(8), space.width * 0.12);
                const showName =
                  space.width * ppm >= 30 && space.depth * ppm >= 20;
                const showArea = showName && space.depth * ppm >= 38;
                const area = (space.width * space.depth).toLocaleString(
                  "ru-RU",
                  {
                    maximumFractionDigits: 2,
                  },
                );
                return (
                  <g
                    key={space.id}
                    {...svgProps(`space:${space.id}`)}
                    pointerEvents={undefined}
                    role="button"
                    tabIndex={drawing || copying ? -1 : 0}
                    aria-label={`${space.kind === "room" ? "Помещение" : "Коридор"} ${space.name}, ${area} квадратных метров`}
                    aria-pressed={selectedSpaceId === space.id}
                    aria-disabled={drawing || copying || undefined}
                    className={`${styles.spaceObject} ${space.kind === "corridor" ? styles.corridorSpace : styles.roomSpace} ${selectedSpaceId === space.id ? styles.spaceSelected : ""} ${map.editing && !drawing && !map.panMode ? styles.draggable : ""}`}
                    onPointerDown={(event) =>
                      map.onPointerDown(
                        event,
                        { ...space, id: `space:${space.id}`, rotation: 0 },
                        pending || drawing,
                      )
                    }
                    onClick={() => {
                      if (!drawing && !copying) onSelectSpace?.(space.id);
                    }}
                    onKeyDown={(event) => {
                      if (
                        !drawing &&
                        !copying &&
                        (event.key === "Enter" || event.key === " ")
                      ) {
                        event.preventDefault();
                        onSelectSpace?.(space.id);
                      }
                    }}
                  >
                    <title>
                      {space.name} ·{" "}
                      {space.kind === "room" ? "Помещение" : "Коридор"} · {area}{" "}
                      м²
                    </title>
                    <rect
                      data-draw-surface="true"
                      x={space.x}
                      y={space.y}
                      width={space.width}
                      height={space.depth}
                      className={styles.spaceFloor}
                    />
                    {showName && (
                      <text
                        x={space.x + padding}
                        y={space.y + unit(18)}
                        className={styles.spaceName}
                        style={{ fontSize }}
                        pointerEvents="none"
                      >
                        {shortScreenLabel(
                          space.name,
                          (space.width - padding * 2) * ppm,
                          12,
                        )}
                      </text>
                    )}
                    {showArea && (
                      <text
                        x={space.x + padding}
                        y={space.y + unit(34)}
                        className={styles.spaceArea}
                        style={{ fontSize: unit(10) }}
                        pointerEvents="none"
                      >
                        {shortScreenLabel(
                          `${area} м²`,
                          (space.width - padding * 2) * ppm,
                          10,
                        )}
                      </text>
                    )}
                    {selectedSpaceId === space.id && !showName && (
                      <g transform={`translate(${space.x} ${space.y})`}>
                        <ScreenCallout
                          text={`${space.name} · ${area} м²`}
                          centerX={space.width / 2}
                          pixelsPerMeter={ppm}
                        />
                      </g>
                    )}
                  </g>
                );
              })}
            {effectiveAisles.map((aisle) => {
              const id = `aisle:${aisle.id}`;
              const position = map.preview?.id === id ? map.preview : aisle;
              const footprint = rotatedFootprint(aisle);
              const selected = selectedId === id;
              const showAisleName = canShowObjectLabel(
                aisle.name,
                footprint.width,
                footprint.depth,
                ppm,
              );
              return (
                <g
                  key={id}
                  transform={`translate(${position.x} ${position.y})`}
                  {...svgProps(id)}
                  onPointerDown={(event) =>
                    map.onPointerDown(
                      event,
                      { ...aisle, id },
                      pending || drawing,
                    )
                  }
                  aria-label={`Проход ${aisle.name}, ${aisle.width} на ${aisle.depth} метров, поворот ${aisle.rotation} градусов`}
                  className={`${styles.aisleObject} ${selected ? styles.aisleSelected : ""} ${map.editing ? styles.draggable : ""}`}
                >
                  <title>{aisle.name} · Проход</title>
                  <rect
                    width={footprint.width}
                    height={footprint.depth}
                    rx=".05"
                    className={styles.aisleBase}
                  />
                  <rect
                    width={footprint.width}
                    height={footprint.depth}
                    fill="url(#warehouse-aisle-pattern)"
                    className={styles.aislePattern}
                  />
                  {selected && (
                    <rect
                      x="-.07"
                      y="-.07"
                      width={footprint.width + 0.14}
                      height={footprint.depth + 0.14}
                      rx=".1"
                      className={styles.selectionHalo}
                      pointerEvents="none"
                    />
                  )}
                  <g
                    transform={`translate(${footprint.width / 2} ${footprint.depth / 2}) rotate(${aisle.rotation})`}
                  >
                    <path
                      d="M0 .23 V-.23 M-.1 -.1 L0 -.23 L.1 -.1"
                      className={styles.aisleDirection}
                    />
                  </g>
                  {showAisleName && (
                    <text
                      x={footprint.width / 2}
                      y={footprint.depth / 2 + unit(20)}
                      style={{ fontSize: unit(11) }}
                      textAnchor="middle"
                      className={styles.aisleLabel}
                    >
                      {shortScreenLabel(
                        aisle.name,
                        footprint.width * ppm - 12,
                        11,
                      )}
                    </text>
                  )}
                  {selected && !showAisleName && (
                    <ScreenCallout
                      text={aisle.name}
                      centerX={footprint.width / 2}
                      pixelsPerMeter={ppm}
                    />
                  )}
                </g>
              );
            })}
            {effectiveObjects.map((object) => {
              const position =
                map.preview?.id === object.id ? map.preview : object;
              const footprint = rotatedFootprint(object);
              const inventory = addressInventory(
                effectiveData,
                object.addresses.map((address) => address.id),
              );
              const selected = selectedId === object.id;
              const showCode = canShowObjectLabel(
                object.code,
                footprint.width,
                footprint.depth,
                ppm,
              );
              const showSecondary = showCode && footprint.depth * ppm >= 44;
              const railX = Math.min(0.16, object.width * 0.12),
                railY = Math.min(0.12, object.depth * 0.12);
              const blocked =
                object.addresses.length > 0 &&
                object.addresses.every((address) => address.blocked);
              const subtitle = blocked
                ? "ЗАКРЫТО"
                : object.section
                  ? `ЯРУСОВ: ${object.addresses.length} · ПАЛЛ.: ${inventory.pallets.length}`
                  : inventory.occupied
                    ? `${inventory.pallets.length} ПАЛЛ. · ${inventory.boxes.length} КОР.`
                    : inventory.reserved
                      ? "РЕЗЕРВ"
                      : "СВОБОДНО";
              return (
                <g
                  key={object.id}
                  transform={`translate(${position.x} ${position.y})`}
                  {...svgProps(object.id)}
                  onPointerDown={(event) =>
                    map.onPointerDown(event, object, pending || drawing)
                  }
                  aria-label={`${object.code}, ${locationKindLabel(object.kind)}, поворот ${object.rotation} градусов, адресов ${object.addresses.length}, паллет ${inventory.pallets.length}${inventory.reserved ? ", есть резерв" : ""}`}
                  className={`${styles.location} ${styles[object.kind] ?? ""} ${selected ? styles.selected : ""} ${blocked ? styles.blocked : ""} ${map.editing ? styles.draggable : ""}`}
                >
                  <title>
                    {object.code} · {object.name}
                  </title>
                  {object.addresses.some((address) =>
                    highlightedAddressIds.includes(address.id),
                  ) && (
                    <rect
                      x="-.13"
                      y="-.13"
                      width={footprint.width + 0.26}
                      height={footprint.depth + 0.26}
                      rx=".15"
                      className={styles.workZoneHalo}
                      pointerEvents="none"
                    />
                  )}
                  {selected && (
                    <rect
                      x="-.09"
                      y="-.09"
                      width={footprint.width + 0.18}
                      height={footprint.depth + 0.18}
                      rx=".15"
                      className={styles.selectionHalo}
                      pointerEvents="none"
                    />
                  )}
                  <rect
                    width={footprint.width}
                    height={footprint.depth}
                    rx={object.section ? ".1" : ".18"}
                    className={styles.locationBody}
                  />
                  <g
                    transform={`translate(${footprint.width / 2} ${footprint.depth / 2}) rotate(${object.rotation}) translate(${-object.width / 2} ${-object.depth / 2})`}
                  >
                    {object.section && (
                      <>
                        <line
                          x1={railX}
                          y1={railY}
                          x2={railX}
                          y2={object.depth - railY}
                          className={styles.rackRail}
                        />
                        <line
                          x1={object.width - railX}
                          y1={railY}
                          x2={object.width - railX}
                          y2={object.depth - railY}
                          className={styles.rackRail}
                        />
                      </>
                    )}
                    <path
                      d={`M${object.width * 0.4} ${Math.min(0.29, object.depth * 0.25)} L${object.width / 2} ${Math.min(0.14, object.depth * 0.1)} L${object.width * 0.6} ${Math.min(0.29, object.depth * 0.25)}`}
                      className={styles.orientationMark}
                    />
                  </g>
                  {showCode && (
                    <text
                      x={footprint.width / 2}
                      y={footprint.depth / 2 + unit(showSecondary ? -3 : 4)}
                      textAnchor="middle"
                      className={styles.locationCode}
                      style={{ fontSize: unit(12) }}
                    >
                      {object.code}
                    </text>
                  )}
                  {showSecondary && (
                    <text
                      x={footprint.width / 2}
                      y={footprint.depth / 2 + unit(14)}
                      textAnchor="middle"
                      className={styles.locationSubtitle}
                      style={{ fontSize: unit(11) }}
                    >
                      {shortScreenLabel(
                        subtitle,
                        footprint.width * ppm - 12,
                        11,
                      )}
                    </text>
                  )}
                  {selected && !showCode && (
                    <ScreenCallout
                      text={object.code}
                      centerX={footprint.width / 2}
                      pixelsPerMeter={ppm}
                    />
                  )}
                  {inventory.occupied &&
                    footprint.width * ppm >= 16 &&
                    footprint.depth * ppm >= 16 && (
                      <circle
                        cx={footprint.width - unit(5)}
                        cy={unit(5)}
                        r={unit(2.5)}
                        className={styles.occupiedDot}
                      />
                    )}
                  {inventory.reserved &&
                    footprint.width * ppm >= 16 &&
                    footprint.depth * ppm >= 16 && (
                      <circle
                        cx={unit(5)}
                        cy={unit(5)}
                        r={unit(2.5)}
                        className={styles.reservedDot}
                      />
                    )}
                </g>
              );
            })}
            {planWallLines(effectiveWarehouse, effectiveEntrances).map(
              (line) => (
                <line
                  key={`${line.x1},${line.y1},${line.x2},${line.y2}`}
                  {...line}
                  className={styles.roomWall}
                  pointerEvents="none"
                />
              ),
            )}
            {effectiveEntrances.map((entrance) => {
              const id = `entrance:${entrance.id}`,
                center = entranceCenter(entrance, effectiveWarehouse);
              if (!center) return null;
              const original = entrances.find(
                (item) => item.id === entrance.id,
              )!;
              return (
                <g
                  key={id}
                  transform={`translate(${center.x} ${center.y}) rotate(${entranceRotation(entrance.wall)})`}
                  {...svgProps(id)}
                  onPointerDown={(event) =>
                    map.onEntrancePointerDown(
                      event,
                      original,
                      pending || drawing,
                    )
                  }
                  aria-label={`Вход ${entrance.name}, ${wallLabels[entrance.wall]} стена, ширина ${entrance.width} метров`}
                  className={`${styles.entranceObject} ${selectedId === id ? styles.entranceSelected : ""} ${map.editing ? styles.draggable : ""}`}
                >
                  <title>
                    {entrance.name} · {wallLabels[entrance.wall]} стена
                  </title>
                  <rect
                    x={-entrance.width / 2 - 0.1}
                    y="-.4"
                    width={entrance.width + 0.2}
                    height="1.35"
                    className={styles.entranceHit}
                  />
                  <line
                    x1={-entrance.width / 2}
                    y1="-.14"
                    x2={-entrance.width / 2}
                    y2=".14"
                    className={styles.entranceJamb}
                  />
                  <line
                    x1={entrance.width / 2}
                    y1="-.14"
                    x2={entrance.width / 2}
                    y2=".14"
                    className={styles.entranceJamb}
                  />
                  <line
                    x1={-entrance.width / 2 + 0.08}
                    y1="0"
                    x2={entrance.width / 2 - 0.08}
                    y2="0"
                    className={styles.entranceThreshold}
                  />
                  <path
                    d="M0 .22 V.78 M-.13 .6 L0 .78 L.13 .6"
                    className={styles.entranceArrow}
                  />
                  <text
                    x="0"
                    y="-.43"
                    textAnchor="middle"
                    className={styles.entranceLabel}
                  >
                    {shortScreenLabel(
                      entrance.name,
                      Math.max(40, entrance.width * ppm),
                      11,
                    )}
                  </text>
                </g>
              );
            })}
            {spaces
              .filter(
                (space) =>
                  selectedSpaceId === space.id ||
                  map.preview?.id === `space:${space.id}`,
              )
              .map((space) => (
                <rect
                  key={`space-selection:${space.id}`}
                  x={space.x}
                  y={space.y}
                  width={space.width}
                  height={space.depth}
                  className={`${styles.selectionHalo} ${styles.spaceDragOutline}`}
                  pointerEvents="none"
                />
              ))}
            {map.editing &&
              !copying &&
              !drawing &&
              !map.panMode &&
              map.canResizeSpaces &&
              spaces
                .filter((space) => space.id === selectedSpaceId)
                .map((space) => (
                  <g
                    key={`resize:${space.id}`}
                    aria-label={`Изменение размеров ${space.name}`}
                  >
                    {resizeDirections.map((direction) => {
                      const point = resizeHandlePoint(space, direction);
                      const labels = {
                        nw: "Верхний левый угол",
                        n: "Верхняя сторона",
                        ne: "Верхний правый угол",
                        e: "Правая сторона",
                        se: "Нижний правый угол",
                        s: "Нижняя сторона",
                        sw: "Нижний левый угол",
                        w: "Левая сторона",
                      };
                      const original = warehouse.spaces.find(
                        (item) => item.id === space.id,
                      )!;
                      return (
                        <g
                          key={direction}
                          transform={`translate(${point.x} ${point.y})`}
                          className={`${resizeStyles.handle} ${resizeStyles[direction]}`}
                          data-map-object={`resize:${space.id}:${direction}`}
                          data-resize-target={`space:${space.id}`}
                          data-resize-handle={direction}
                          role="button"
                          tabIndex={pending ? -1 : 0}
                          aria-label={`${labels[direction]} · изменить размер ${space.name}`}
                          aria-disabled={pending || undefined}
                          onPointerDown={(event) =>
                            map.onResizePointerDown(
                              event,
                              space.id,
                              original,
                              direction,
                              pending,
                            )
                          }
                          onPointerMove={map.onResizePointerMove}
                          onPointerUp={(event) =>
                            void map.onResizePointerUp(event)
                          }
                          onPointerCancel={map.onResizePointerCancel}
                          onLostPointerCapture={map.onResizeLostPointerCapture}
                          onClick={(event) => {
                            event.stopPropagation();
                          }}
                          onKeyDown={(event) => {
                            if (
                              (event.key === "Enter" || event.key === " ") &&
                              !pending
                            ) {
                              event.preventDefault();
                              event.stopPropagation();
                              onRequestSpaceResize?.(space.id);
                            }
                          }}
                        >
                          <title>
                            {labels[direction]}. Точные размеры — Enter или
                            настройки участка.
                          </title>
                          <rect
                            className={resizeStyles.hit}
                            x={unit(-12)}
                            y={unit(-12)}
                            width={unit(24)}
                            height={unit(24)}
                            rx={unit(4)}
                          />
                          <rect
                            className={resizeStyles.knob}
                            x={unit(-4)}
                            y={unit(-4)}
                            width={unit(8)}
                            height={unit(8)}
                            rx={unit(2)}
                          />
                        </g>
                      );
                    })}
                  </g>
                ))}
            {draw.draft && (
              <g pointerEvents="none">
                <rect
                  x={draw.draft.x}
                  y={draw.draft.y}
                  width={draw.draft.width}
                  height={draw.draft.depth}
                  className={styles.spaceDraft}
                />
                <text
                  x={draw.draft.x + draw.draft.width / 2}
                  y={draw.draft.y + draw.draft.depth / 2}
                  textAnchor="middle"
                  className={styles.draftDimension}
                >
                  {draw.draft.width} × {draw.draft.depth} м
                </text>
              </g>
            )}
            {copying && copySection && ghostPosition && ghostSize && (
              <g
                data-map-object="section-copy-placement"
                data-section-copy-overlay="true"
                className={`${copyStyles.overlay} ${pending ? copyStyles.pending : ""} ${map.panMode ? copyStyles.hand : ""}`}
                role="group"
                aria-label={`Размещение копии ${copySection.code}`}
                onPointerDown={copy.onPointerDown}
                onPointerMove={copy.onPointerMove}
                onPointerUp={(event) => void copy.onPointerUp(event)}
                onPointerCancel={copy.onPointerCancel}
                onLostPointerCapture={copy.onLostPointerCapture}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
              >
                <rect
                  x={-1.4}
                  y={-1.4}
                  width={warehouse.width + 2.8}
                  height={warehouse.depth + 2.8}
                  className={copyStyles.surface}
                />
                <g
                  data-section-copy-ghost="true"
                  transform={`translate(${ghostPosition.x} ${ghostPosition.y})`}
                  pointerEvents="none"
                >
                  <rect
                    width={ghostSize.width}
                    height={ghostSize.depth}
                    rx={0.1}
                    className={copyStyles.ghost}
                  />
                  <g
                    transform={`translate(${ghostSize.width / 2} ${ghostSize.depth / 2}) rotate(${copySection.rotation}) translate(${-copySection.width / 2} ${-copySection.depth / 2})`}
                  >
                    <line
                      x1={0.1}
                      y1={0.1}
                      x2={0.1}
                      y2={Math.max(0.1, copySection.depth - 0.1)}
                      className={copyStyles.orientation}
                    />
                    <line
                      x1={Math.max(0.1, copySection.width - 0.1)}
                      y1={0.1}
                      x2={Math.max(0.1, copySection.width - 0.1)}
                      y2={Math.max(0.1, copySection.depth - 0.1)}
                      className={copyStyles.orientation}
                    />
                    <path
                      d={`M${copySection.width * 0.4} ${Math.min(0.29, copySection.depth * 0.25)} L${copySection.width / 2} ${Math.min(0.14, copySection.depth * 0.1)} L${copySection.width * 0.6} ${Math.min(0.29, copySection.depth * 0.25)}`}
                      className={copyStyles.orientation}
                    />
                  </g>
                  <text
                    x={ghostSize.width / 2}
                    y={-unit(9)}
                    className={copyStyles.ghostLabel}
                    style={{ fontSize: unit(12) }}
                  >
                    Копия {copySection.code}
                  </text>
                </g>
              </g>
            )}
          </svg>
        </div>
      </div>
      {map.resizing && (
        <div className={resizeStyles.readout} role="status">
          <strong>{map.resizeReadout ?? "Изменение размеров участка"}</strong>
          <span>
            {map.saveState === "saving"
              ? "Сохраняем размеры…"
              : "Шаг — 10 см · Escape — отмена. Содержимое остаётся на месте."}
          </span>
        </div>
      )}
      {draw.draft && (
        <div className={styles.drawingReadout} role="status">
          <strong>
            {draw.draft.kind === "room" ? "Помещение" : "Коридор"} ·{" "}
            {draw.draft.width} × {draw.draft.depth} м ·{" "}
            {(draw.draft.width * draw.draft.depth).toLocaleString("ru-RU", {
              maximumFractionDigits: 2,
            })}{" "}
            м²
          </strong>
          <span>
            {draw.draft.width >= 0.5 && draw.draft.depth >= 0.5
              ? "Отпустите, чтобы задать имя и точные размеры"
              : "Минимальный размер — 0,5 × 0,5 м"}{" "}
            · Escape — отмена
          </span>
        </div>
      )}
    </div>
  );
}
