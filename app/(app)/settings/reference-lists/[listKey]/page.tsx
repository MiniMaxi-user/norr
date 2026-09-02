import { notFound } from "next/navigation";
import { OverviewHeroBand, Stack } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { can, type PermissionActor } from "@/lib/rbac/permissions";
import { listReferenceItems, type ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { ReferenceListManager } from "../../components/reference-list-manager";
import { REFERENCE_LIST_SECTIONS } from "../sections";

export const metadata = { title: "Reference lists" };

interface ReferenceListLeafPageProps {
  params: Promise<{ listKey: string }>;
}

/**
 * Per-reference-list leaf route (issue #110, Settings admin shell stage 2) —
 * replaces the single mega `Tabs` board at `../reference-lists-board.tsx`
 * (17 queries fired on every visit, one tab used) with one route per list,
 * each fetching only its own 1-2 queries. `SettingsShell`'s left rail (see
 * `../../components/settings-shell.tsx`) provides the persistent navigation
 * between leaves that the old in-page `Tabs` used to provide.
 *
 * Kept as a single async Server Component (no `Suspense`/skeleton) rather
 * than the "sync page.tsx gate + Suspense-wrapped async board" split that
 * `checklist-templates/page.tsx` uses — this leaf does at most 2 lightweight
 * queries (`listReferenceItems` for itself, plus one more for a dependent
 * list's parent), versus the old board's 17-query `Promise.all`, so there's
 * no meaningfully slow work here to stream around. `SettingsSectionSkeleton`
 * still exists (`../../components/settings-section-skeleton.tsx`) for the
 * other settings leaves (Stage 3) that do have heavier fetches.
 */
export default async function ReferenceListLeafPage({ params }: ReferenceListLeafPageProps) {
  const { listKey } = await params;

  const section = REFERENCE_LIST_SECTIONS.find((candidate) => candidate.key === listKey);
  if (!section) notFound();

  // The `"settings"` feature/module gate itself already ran in
  // `app/(app)/settings/layout.tsx` before this page could render — only
  // `canWrite` is computed here (see `../reference-lists/page.tsx`, the
  // pre-Stage-2 board's `page.tsx`, for the byte-identical lines this is
  // copied from, minus its now-redundant `notFound()` entitlement checks).
  const session = await getCurrentSession();
  const actor: PermissionActor = { role: session?.role ?? null, isPlatformAdmin: session?.isPlatformAdmin ?? false };
  const canWrite = can(actor, "settings", "create");

  const result = await listReferenceItems(section.key);
  const items = result.data?.items ?? [];
  const loadError = result.error;
  const parentListKey = result.data?.parentListKey ?? null;

  // Dependent list (e.g. `asset_subtype` -> `asset_type`) — fetch the
  // parent's own items too, for `ReferenceListManager`'s parent-item
  // picker/labels. Mirrors `reference-lists-board.tsx`'s
  // `parentListKey ? ... : []` / `titleByListKey.get(parentListKey)` pattern,
  // just fetched fresh here instead of read off the board's pre-fetched map.
  let parentListTitle: string | undefined;
  let parentItems: ReferenceListItemRecord[] = [];
  if (parentListKey) {
    const parentSection = REFERENCE_LIST_SECTIONS.find((candidate) => candidate.key === parentListKey);
    parentListTitle = parentSection?.title ?? parentListKey;
    const parentResult = await listReferenceItems(parentListKey);
    parentItems = parentResult.data?.items ?? [];
  }

  return (
    <Stack gap="lg">
      <OverviewHeroBand title={section.title} subtitle={section.description} />
      <ReferenceListManager
        listKey={section.key}
        items={items}
        loadError={loadError}
        canWrite={canWrite}
        parentListKey={parentListKey}
        parentListTitle={parentListTitle}
        parentItems={parentItems}
      />
    </Stack>
  );
}
