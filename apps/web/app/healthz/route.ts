export const dynamic = "force-dynamic";

// Process health only; API readiness is a separate Compose dependency/probe.
export function GET() {
  return Response.json(
    { status: "ok" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
