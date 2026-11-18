import { WebCardSkeleton } from "@yourorg/ui/web";

/** Shaped Suspense fallback for `TeamBoard`: one table-shaped card of
 * placeholder rows (the settings frame paints the header and nav). */
export function TeamSkeleton() {
  return (
    <div aria-busy="true">
      <WebCardSkeleton rows={5} />
    </div>
  );
}
