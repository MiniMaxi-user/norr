import { WebCardSkeleton } from "@yourorg/ui/web";

/** Shaped Suspense fallback for `ChecklistTemplatesBoard`: one tree-shaped
 * card of placeholder rows (the settings frame paints the header and nav). */
export function ChecklistTemplatesSkeleton() {
  return (
    <div aria-busy="true">
      <WebCardSkeleton rows={5} />
    </div>
  );
}
