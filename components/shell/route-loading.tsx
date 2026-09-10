import { Spinner } from "@yourorg/ui";

/**
 * Shared minimal `loading.tsx` fallback (issue #140, part 2) for any route
 * segment that has no bespoke, content-shaped skeleton of its own — every
 * `[id]` detail page except `clients/[id]` (which reuses
 * `ClientDetailSkeleton`), the `new`/`edit` create-flow routes, and a few
 * settings leaves that fetch a couple of lightweight reference lists inline
 * rather than behind their own `Suspense`. Hand-building a full shaped
 * skeleton per route is real design work out of scope here — every route
 * that already has (or is worth building) one of those uses it directly in
 * its own `loading.tsx` instead of this component; this is deliberately just
 * the branded `Spinner` (see `packages/ui/src/components/spinner.tsx`),
 * centered, with enough breathing room to read as "this route is loading"
 * rather than a layout glitch.
 */
export function RouteLoading() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "40vh",
        padding: "3rem 1.5rem",
      }}
    >
      <Spinner size={40} label="Loading…" />
    </div>
  );
}
