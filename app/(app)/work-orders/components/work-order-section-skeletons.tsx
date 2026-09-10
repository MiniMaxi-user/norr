import { SectionHeader, Skeleton, Stack } from "@yourorg/ui";
import { Boxes, Clock, ClipboardList } from "@yourorg/ui/icons";

/**
 * Shaped `Suspense` fallbacks (issue #146) for the three below-fold work
 * order sections (`work-order-hours-slot.tsx`/`-material-slot.tsx`/
 * `-checklist-slot.tsx`, each its own async Server Component) — mirror the
 * real section's `SectionHeader` (icon + title, no actions yet since those
 * live on the not-yet-resolved data) plus a couple of row-height bars, same
 * "shaped, not a bare spinner" convention `ClientDetailSkeleton`/
 * `AssetCompositeSection`'s own loading branch already use, per
 * docs/ARCHITECTURE.md's streaming guidance.
 */
export function WorkOrderHoursSectionSkeleton() {
  return (
    <Stack gap="md" aria-hidden>
      <SectionHeader icon={Clock} title="Hours" />
      <Skeleton height="2.75rem" />
      <Skeleton height="2.75rem" />
      <Skeleton height="1.75rem" width="60%" />
    </Stack>
  );
}

export function WorkOrderMaterialSectionSkeleton() {
  return (
    <Stack gap="md" aria-hidden>
      <SectionHeader icon={Boxes} title="Material" />
      <Skeleton height="2.75rem" />
      <Skeleton height="1.75rem" width="50%" />
    </Stack>
  );
}

export function WorkOrderChecklistSectionSkeleton() {
  return (
    <Stack gap="md" aria-hidden>
      <SectionHeader icon={ClipboardList} title="Checklist" />
      <Skeleton height="2.75rem" />
      <Skeleton height="2.75rem" />
    </Stack>
  );
}
