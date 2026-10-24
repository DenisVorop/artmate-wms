import type { Point } from "./plan-geometry";

export type PointerGesture = { startClient: Point; dragging: boolean };

export function beginPointerGesture(client: Point): PointerGesture {
  return { startClient: client, dragging: false };
}

/** Only an actual pointermove may promote a press to a drag; layout/scroll on up never does. */
export function updatePointerGesture(
  gesture: PointerGesture,
  phase: "move" | "up",
  client: Point,
  threshold = 5,
): PointerGesture {
  if (phase !== "move" || gesture.dragging) return gesture;
  const distance = Math.hypot(
    client.x - gesture.startClient.x,
    client.y - gesture.startClient.y,
  );
  return distance >= threshold ? { ...gesture, dragging: true } : gesture;
}
