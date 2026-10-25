"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MapPin, X } from "lucide-react";
import { getAuthEpoch } from "@/shared/api/auth-memory";
import {
  createLocationMap,
  type LocationMapData,
  type MapRectangle,
} from "../lib/location-map";
import {
  createWorkRouteMap,
  workRouteRequestKey,
  type WorkRouteRequest,
} from "../lib/work-route";
import { RouteLayoutChangedError, useWorkRoute } from "../model/use-work-route";
import styles from "./location-map.module.css";

type Props = {
  data: LocationMapData;
  locationId: string | null | undefined;
  intent: "take" | "place";
  contextKey: string;
  routeRequest?: WorkRouteRequest;
};
type OpenContext = {
  key: string;
  locationId: Props["locationId"];
  intent: Props["intent"];
  epoch: number;
  routeKey: string;
};

export function LocationMapButton({
  data,
  locationId,
  intent,
  contextKey,
  routeRequest,
}: Props) {
  const [opened, setOpened] = useState<OpenContext | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const routeKey = workRouteRequestKey(routeRequest);
  const live = useRef({ contextKey, locationId, intent, routeKey });
  live.current = { contextKey, locationId, intent, routeKey };
  const current = (snapshot: OpenContext) =>
    snapshot.epoch === getAuthEpoch() &&
    snapshot.key === live.current.contextKey &&
    snapshot.locationId === live.current.locationId &&
    snapshot.intent === live.current.intent &&
    snapshot.routeKey === live.current.routeKey;
  useEffect(() => {
    if (!opened) return;
    const timer = window.setInterval(() => {
      if (!current(opened)) setOpened(null);
    }, 150);
    return () => window.clearInterval(timer);
  }, [opened]);
  const visible = opened && current(opened);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        onClick={() => {
          if (document.querySelector("dialog[open]")) return;
          setOpened({
            key: contextKey,
            locationId,
            intent,
            epoch: getAuthEpoch(),
            routeKey,
          });
        }}
      >
        <MapPin size={18} aria-hidden="true" /> Показать на карте
      </button>
      {visible && (
        <LocationMapDialog
          data={data}
          locationId={locationId}
          intent={intent}
          contextKey={contextKey}
          routeRequest={routeRequest}
          current={() => current(opened)}
          restoreFocus={() => {
            const field = trigger.current
              ?.closest("section")
              ?.querySelector<HTMLInputElement>(
                "input[data-employee-scan-input]",
              );
            if (field) {
              if (!field.disabled) field.focus({ preventScroll: true });
              else if (document.activeElement instanceof HTMLElement)
                document.activeElement.blur();
            } else trigger.current?.focus({ preventScroll: true });
          }}
          onClose={() => setOpened(null)}
        />
      )}
    </>
  );
}

function LocationMapDialog({
  data,
  locationId,
  intent,
  contextKey,
  routeRequest,
  current,
  restoreFocus,
  onClose,
}: Props & {
  current: () => boolean;
  restoreFocus: () => void;
  onClose: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const live = useRef({ current, onClose, restoreFocus });
  live.current = { current, onClose, restoreFocus };
  const [overview, setOverview] = useState(false);
  const model = createLocationMap(data, locationId);
  const query = useWorkRoute(routeRequest, data, contextKey);
  const route =
    query.data && !query.isError
      ? createWorkRouteMap(data, query.data, query.data.verifiedLayoutKey, {
          intent,
          locationId,
        })
      : null;
  const drawableRoute = route?.available && route.line ? route : null;
  const routeProblem = route && !route.available ? route.message : null;
  useEffect(() => {
    const element = dialog.current;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    element?.showModal();
    return () => {
      element?.close();
      // Do not focus an input belonging to a previous operation or identity.
      if (document.querySelector("dialog[open]")) return;
      if (live.current.current()) live.current.restoreFocus();
      else if (document.activeElement === previousFocus) previousFocus?.blur();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-address`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== dialog.current || !dialog.current) return;
        const rect = dialog.current.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onClose();
      }}
    >
      <header className={styles.header}>
        <h2 id={`${id}-title`}>
          {routeRequest
            ? "Маршрут"
            : intent === "take"
              ? "Откуда забрать"
              : "Куда поставить"}
        </h2>
        <button
          type="button"
          className={styles.close}
          aria-label="Закрыть карту"
          onClick={onClose}
          autoFocus
        >
          <X size={24} aria-hidden="true" />
        </button>
      </header>
      {model.available ? (
        <>
          {route?.available ? (
            <div id={`${id}-address`} className={styles.routeAddresses}>
              <RouteAddress model={route.source} intent="take" />
              <span className={styles.routeDirection} aria-hidden="true">
                →
              </span>
              <RouteAddress model={route.destination} intent="place" />
            </div>
          ) : (
            <div id={`${id}-address`} className={styles.address}>
              <strong>{model.location.code}</strong>
              <span>{model.location.name}</span>
              <p>
                {model.detail}
                {model.room && <> · {model.room.name}</>}
              </p>
            </div>
          )}
          {routeRequest && (
            <div className={styles.routeStatus} role="status">
              {query.isPending ? (
                "Строим маршрут…"
              ) : query.isError ? (
                <>
                  {query.error instanceof RouteLayoutChangedError
                    ? query.error.message
                    : "Не удалось загрузить маршрут."}{" "}
                  <button
                    type="button"
                    className={styles.retry}
                    disabled={query.isFetching}
                    onClick={() => void query.refetch()}
                  >
                    Повторить
                  </button>
                </>
              ) : routeProblem ? (
                <>
                  {routeProblem}{" "}
                  <button
                    type="button"
                    className={styles.retry}
                    disabled={query.isFetching}
                    onClick={() => void query.refetch()}
                  >
                    Обновить
                  </button>
                </>
              ) : drawableRoute && query.data ? (
                <>
                  <strong>
                    {query.data.distanceMeters === null
                      ? "Маршрут"
                      : `≈ ${Math.round(query.data.distanceMeters)} м`}
                  </strong>
                  {query.data.status === "floor" && (
                    <span>
                      Оценка по свободному полу: проходы не заданы полностью.
                    </span>
                  )}
                </>
              ) : (
                query.data?.note ||
                "Маршрут недоступен. Уточните проход у руководителя."
              )}
            </div>
          )}
          <div className={styles.mapFrame}>
            <MapDrawing
              model={model}
              route={drawableRoute}
              overview={overview}
              id={id}
            />
          </div>
          <div className={styles.footer}>
            <span className={styles.legend}>
              <i aria-hidden="true" />{" "}
              {drawableRoute ? "Взять" : "Нужное место"}
              {drawableRoute && (
                <>
                  <span aria-hidden="true">→</span>
                  <i
                    className={styles.destinationLegend}
                    aria-hidden="true"
                  />{" "}
                  Нести
                </>
              )}
            </span>
            {(model.room || drawableRoute) && (
              <button
                type="button"
                className={styles.overview}
                aria-pressed={overview}
                onClick={() => setOverview((value) => !value)}
              >
                {overview
                  ? drawableRoute
                    ? "Маршрут"
                    : "Ближе к месту"
                  : "Весь склад"}
              </button>
            )}
          </div>
        </>
      ) : (
        <p id={`${id}-address`} className={styles.unavailable} role="status">
          {model.message}
        </p>
      )}
    </dialog>
  );
}

type AvailableMap = Extract<
  ReturnType<typeof createLocationMap>,
  { available: true }
>;
type AvailableRoute = Extract<
  ReturnType<typeof createWorkRouteMap>,
  { available: true }
>;
function RouteAddress({
  model,
  intent,
}: {
  model: AvailableMap;
  intent: Props["intent"];
}) {
  return (
    <div className={styles.routeAddress}>
      <span>{intent === "take" ? "Взять" : "Нести"}</span>
      <strong>{model.location.code}</strong>
      <small>{model.detail}</small>
    </div>
  );
}
function MapDrawing({
  model,
  route,
  overview,
  id,
}: {
  model: AvailableMap;
  route: AvailableRoute | null;
  overview: boolean;
  id: string;
}) {
  const bounds = overview
    ? model.wholeBounds
    : (route?.bounds ?? model.focusedBounds);
  const width = 480,
    height = 310,
    inset = 14;
  const scale = Math.min(
    (width - inset * 2) / bounds.width,
    (height - inset * 2) / bounds.depth,
  );
  const dx = (width - bounds.width * scale) / 2 - bounds.x * scale;
  const dy = (height - bounds.depth * scale) / 2 - bounds.y * scale;
  const x = (value: number) => value * scale + dx;
  const y = (value: number) => value * scale + dy;
  const rect = (shape: MapRectangle) => ({
    x: x(shape.x),
    y: y(shape.y),
    width: shape.width * scale,
    height: shape.depth * scale,
  });
  const clipId = `${id}-map-clip`;
  const arrowId = `${id}-route-arrow`;
  const target = rect(model.target);
  const centerX = target.x + target.width / 2;
  const centerY = target.y + target.height / 2;
  return (
    <svg
      className={styles.map}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-labelledby={`${id}-map-title ${id}-map-description`}
    >
      <title id={`${id}-map-title`}>
        {route
          ? `Маршрут: ${route.source.location.code} → ${route.destination.location.code}`
          : `Место ${model.location.code} на карте склада`}
      </title>
      <desc id={`${id}-map-description`}>
        {route
          ? `От ${route.source.location.code}, ${route.source.detail}, до ${route.destination.location.code}, ${route.destination.detail}. Линия со стрелкой показывает направление от места получения к месту назначения.`
          : `${model.room?.name ?? "Общий план склада"}. ${model.detail}. Нужное место выделено мятным цветом и меткой.`}
      </desc>
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width={width} height={height} />
        </clipPath>
        <marker
          id={arrowId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" className={styles.arrow} />
        </marker>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {model.spaces.map((space) => (
          <g key={space.id}>
            <rect
              {...rect(space)}
              className={
                space.kind === "corridor" ? styles.corridor : styles.room
              }
            />
            {space.width * scale > 90 && space.depth * scale > 70 && (
              <text
                x={x(space.x) + 9}
                y={y(space.y) + 22}
                className={styles.roomLabel}
              >
                {space.name.length > 26
                  ? `${space.name.slice(0, 25)}…`
                  : space.name}
              </text>
            )}
          </g>
        ))}
        {model.aisles.map((aisle, index) => (
          <rect key={index} {...rect(aisle)} className={styles.aisle} />
        ))}
        {model.shapes
          .filter((shape) =>
            route
              ? shape.id !== route.source.targetShapeId &&
                shape.id !== route.destination.targetShapeId
              : shape.id !== model.targetShapeId,
          )
          .map((shape) => {
            const bounds = rect(shape);
            const horizontalLabel =
              bounds.width > shape.label.length * 11 + 10 && bounds.height > 27;
            const verticalLabel =
              !horizontalLabel &&
              bounds.height > shape.label.length * 11 + 10 &&
              bounds.width > 27;
            const centerX = bounds.x + bounds.width / 2;
            const centerY = bounds.y + bounds.height / 2;
            return (
              <g key={shape.id}>
                <rect
                  {...bounds}
                  rx="3"
                  className={
                    shape.kind === "section" ? styles.section : styles.floor
                  }
                />
                {(horizontalLabel || verticalLabel) && (
                  <text
                    x={centerX}
                    y={centerY + 6}
                    textAnchor="middle"
                    transform={
                      verticalLabel
                        ? `rotate(-90 ${centerX} ${centerY})`
                        : undefined
                    }
                    className={styles.shapeLabel}
                  >
                    {shape.label}
                  </text>
                )}
              </g>
            );
          })}
        {model.entrances.map((line, index) => (
          <line
            key={index}
            x1={x(line.x1)}
            y1={y(line.y1)}
            x2={x(line.x2)}
            y2={y(line.y2)}
            className={styles.entrance}
          />
        ))}
        {route ? (
          <>
            <rect
              {...rect(route.source.target)}
              rx="3"
              className={styles.source}
              data-route-source-location={route.source.location.id}
            />
            <rect
              {...rect(route.destination.target)}
              rx="3"
              className={styles.target}
              data-route-target-location={route.destination.location.id}
            />
            <polyline
              points={route
                .line!.map((point) => `${x(point.x)},${y(point.y)}`)
                .join(" ")}
              className={styles.routeLine}
              markerEnd={`url(#${arrowId})`}
              data-route-line="true"
              data-route-layout-key={route.layoutKey}
            />
            <circle
              cx={x(route.line![0].x)}
              cy={y(route.line![0].y)}
              r="7"
              className={styles.sourceMarker}
            />
            <circle
              cx={x(route.line!.at(-1)!.x)}
              cy={y(route.line!.at(-1)!.y)}
              r="6"
              className={styles.destinationMarker}
            />
          </>
        ) : (
          <>
            <rect
              {...target}
              rx="3"
              className={styles.target}
              data-highlighted-location={model.location.id}
              data-location-id={model.location.id}
            />
            <circle
              cx={centerX}
              cy={centerY}
              r={Math.max(
                13,
                Math.min(20, Math.max(target.width, target.height) / 2 + 5),
              )}
              className={styles.targetRing}
            />
            <circle
              cx={centerX}
              cy={centerY}
              r="5"
              className={styles.targetDot}
            />
            {target.width > model.location.code.length * 11 + 10 &&
              target.height > 48 && (
                <text
                  x={centerX}
                  y={target.y + target.height - 8}
                  textAnchor="middle"
                  className={styles.targetLabel}
                >
                  {model.location.code}
                </text>
              )}
          </>
        )}
      </g>
    </svg>
  );
}
