"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumbs, Button, DetailColumns, Stack, Text, type BreadcrumbItem } from "@yourorg/ui";
import { createActivity, updateActivity, type ActivityRecord } from "../actions";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import type { ClientRecord } from "@/app/(app)/clients/actions";
import type { OrgMemberRecord } from "@/lib/members/actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { WorkOrderRecord } from "@/app/(app)/work-orders/actions";
import type { ActivityNoteRecord } from "../notes-actions";
import type { ActivityEventRecord } from "../history-actions";
import { usePageHeader } from "@/components/shell/page-header-context";
import { ActivityDetailActions } from "../[id]/activity-detail-actions";
import { ActivityHero } from "./activity-hero";
import { ActivityTypeSection } from "./activity-type-section";
import { ActivityAssignmentSection } from "./activity-assignment-section";
import { ActivityNotesSection } from "./activity-notes-section";
import { ActivityContactSection } from "./activity-contact-section";
import { ActivityLinkedWorkOrders } from "./activity-linked-work-orders";
import { ActivityHistorySection } from "./activity-history-section";
import { useClientScopedActivityLists } from "./use-client-scoped-activity-lists";
import { draftFromActivity, draftToInput, emptyDraft, type ActivityDraft } from "./activity-draft";

export interface ActivityScreenProps {
  mode: "create" | "edit";
  /** Built by the server `page.tsx` and pushed into the Topbar via
   * `usePageHeader` below — never rendered inline in the page body, matching
   * `client-detail.tsx`/`WorkOrderScreen`'s own pattern. */
  breadcrumbItems: BreadcrumbItem[];

  /** Required for `mode: "edit"`. */
  activity?: ActivityRecord;
  client?: ClientRecord | null;
  asset?: AssetRecord | null;
  readOnly?: boolean;
  clients: ClientRecord[];
  activityTypes: ReferenceListItemRecord[];
  activityStatuses: ReferenceListItemRecord[];
  members: OrgMemberRecord[];
  /** Locks the Action holder select to the caller's own id — see
   * `getActivityFormContext` in `../actions.ts`. */
  canAssignOthers: boolean;
  lockedClientId?: string;
  lockedAssetId?: string;
  /** `mode: "create"` only — pins "Action holder" for a caller who can't
   * assign others (an engineer, `create_own` only), resolved server-side by
   * `new/page.tsx`. */
  initialActionHolderId?: string;
  cancelHref?: string;

  canDelete?: boolean;
  /** `can(actor, "planning", "create")`, gated behind the `planning` feature
   * being entitled/accessible for this actor at all (issue #87). Consumed by
   * the "Linked work orders" section's own "+ Work order" button (issue
   * #118 moved it there from the deleted standalone `CreateWorkOrderCallout`
   * card). `mode: "edit"` only. */
  canCreateWorkOrder?: boolean;
  /** `listWorkOrders({ sourceActivityId: activity.id })`'s result, fetched by
   * `[id]/page.tsx` only when the actor can read the `planning` module at
   * all — `undefined` (not merely empty) skips rendering the section
   * entirely, same "don't fetch/render what can't render" convention every
   * other conditional section in this app follows. */
  linkedWorkOrders?: WorkOrderRecord[];
  /** `listActivityNotes(activity.id)`'s result — `mode: "edit"` only, always
   * fetched by `[id]/page.tsx` for any caller who can view the activity at
   * all (see that page's own comment for the gate). `undefined` in
   * `mode: "create"` (nothing to fetch yet). */
  notes?: ActivityNoteRecord[];
  /** `listActivityEvents(activity.id)`'s result — same `mode: "edit"`-only
   * shape as `notes` above. */
  events?: ActivityEventRecord[];
}

/**
 * The single shared screen behind both `/activities/new` (`mode: "create"`)
 * and the activity detail page (`mode: "edit"`) — mirrors
 * `app/(app)/work-orders/components/work-order-screen.tsx`'s own "one real
 * screen, not two" shape (issue #89), applied to Activities by issue #118
 * (replacing the old `ActivityFormPanel` slide-in, see
 * `docs/ARCHITECTURE.md`'s "Popup vs. full page" section for the history).
 *
 * *** Issue #118 *** rebuilt the body onto Pattern A's two-column
 * `DetailColumns` layout (`.design-handoff/melding_detail/README.md`): Type/
 * Assignment/Notes on the left, Contact person/Linked work orders/Historie
 * on the right — replacing the old single-column stack of just Assignment +
 * a standalone `CreateWorkOrderCallout` card. Notes/Linked-work-orders/
 * Historie stay `mode: "edit"`-only (nothing to show before the record
 * exists); Type/Contact-person work in both modes since they only ever touch
 * `commitPatch`, which already makes a local-only draft merge in
 * `mode: "create"`.
 *
 * Owns one flat `ActivityDraft` (`./activity-draft.ts`) as the source of
 * truth for every editable field; every section reads from it and writes
 * back through `commitPatch` below — in `mode: "edit"` that's an immediate
 * `updateActivity` call (small, section-scoped popups/inline fields, saved
 * the instant they're committed — no page-wide Save/Cancel, same as
 * `WorkOrderScreen`), in `mode: "create"` it's a local-only merge until the
 * hero's own "Create activity" action fires `createActivity` with the whole
 * accumulated draft and navigates to the new record.
 */
export function ActivityScreen({
  mode,
  breadcrumbItems,
  activity,
  client = null,
  asset = null,
  readOnly,
  clients,
  activityTypes,
  activityStatuses,
  members,
  canAssignOthers,
  lockedClientId,
  lockedAssetId,
  initialActionHolderId,
  cancelHref,
  canDelete,
  canCreateWorkOrder,
  linkedWorkOrders,
  notes,
  events,
}: ActivityScreenProps) {
  const router = useRouter();

  const breadcrumbNode = useMemo(() => <Breadcrumbs items={breadcrumbItems} />, [breadcrumbItems]);
  usePageHeader(breadcrumbNode);

  const [draft, setDraft] = useState<ActivityDraft>(() =>
    activity
      ? draftFromActivity(activity)
      : emptyDraft({ lockedClientId, lockedAssetId, initialActionHolderId }),
  );

  // The client currently being PREVIEWED for the relation cards + the
  // relations dialog's own asset/contact pickers — kept separate from
  // `draft.clientId` so opening the dialog and trying a different client
  // updates both live, without touching the actually-saved value until Save
  // is clicked. Self-heals back to `draft.clientId` the moment that value
  // legitimately changes — same pattern `WorkOrderScreen`'s own
  // `scopingClientId` uses.
  const [scopingClientId, setScopingClientId] = useState(draft.clientId);
  useEffect(() => {
    setScopingClientId(draft.clientId);
  }, [draft.clientId]);
  const clientScoped = useClientScopedActivityLists(scopingClientId, !readOnly);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  /** Every section's own "Save" ultimately calls this. `mode: "edit"` persists
   * immediately (`updateActivity`) and refreshes the server-rendered data;
   * `mode: "create"` only ever merges into local draft state. */
  async function commitPatch(patch: Partial<ActivityDraft>): Promise<{ ok: boolean; error?: string }> {
    if (mode === "edit" && activity) {
      const result = await updateActivity(activity.id, draftToInput(patch));
      if (!result.data) return { ok: false, error: result.error };
      setDraft((prev) => ({ ...prev, ...patch }));
      router.refresh();
      return { ok: true };
    }
    setDraft((prev) => ({ ...prev, ...patch }));
    return { ok: true };
  }

  async function handleCreate() {
    if (!draft.typeId) {
      setCreateError("Select an activity type.");
      return;
    }
    if (!draft.clientId && !draft.assetId) {
      setCreateError("Select a client or an asset.");
      return;
    }
    if (!draft.description.trim()) {
      setCreateError("Description is required.");
      return;
    }
    if (!draft.actionHolderId) {
      setCreateError("Select an action holder.");
      return;
    }
    setCreateError(null);
    setCreating(true);
    const result = await createActivity(draftToInput(draft));
    setCreating(false);
    if (!result.data) {
      setCreateError(result.error ?? "Could not create this activity.");
      return;
    }
    router.push(`/activities/${result.data.activity.id}`);
  }

  const heroActions =
    mode === "edit" && activity ? (
      <ActivityDetailActions activity={activity} canDelete={Boolean(canDelete)} />
    ) : (
      <>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(cancelHref ?? "/activities")}
          disabled={creating}
        >
          Cancel
        </Button>
        <Button type="button" variant="primary" onClick={handleCreate} disabled={creating}>
          {creating ? "Creating…" : "Create activity"}
        </Button>
      </>
    );

  // Notes section render gate (issue #118 — see `ActivityNotesSection`'s own
  // doc comment for the full reasoning): a read-only viewer with zero notes
  // never sees an empty "Notes" section, but anyone who can actually add one
  // always does, even before the first note exists.
  const showNotes = mode === "edit" && Boolean(activity) && (!readOnly || (notes?.length ?? 0) > 0);

  return (
    <Stack gap="lg">
      {createError && <Text tone="danger">{createError}</Text>}

      <ActivityHero
        mode={mode}
        draft={draft}
        activity={activity}
        client={client}
        asset={asset}
        clients={clients}
        activityTypes={activityTypes}
        activityStatuses={activityStatuses}
        lockedClientId={lockedClientId}
        lockedAssetId={lockedAssetId}
        clientScoped={clientScoped}
        readOnly={readOnly}
        actions={heroActions}
        onClientChange={setScopingClientId}
        onRelationsSave={commitPatch}
        onStatusSave={commitPatch}
      />

      <DetailColumns
        left={
          <>
            <ActivityTypeSection
              typeId={draft.typeId}
              activityTypes={activityTypes}
              readOnly={readOnly}
              onSave={commitPatch}
            />

            <ActivityAssignmentSection
              mode={mode}
              draft={draft}
              activity={activity}
              members={members}
              canAssignOthers={canAssignOthers}
              readOnly={readOnly}
              onSave={commitPatch}
            />

            {showNotes && activity && (
              <ActivityNotesSection activityId={activity.id} notes={notes ?? []} readOnly={readOnly} />
            )}
          </>
        }
        right={
          <>
            <ActivityContactSection draft={draft} readOnly={readOnly} onSave={commitPatch} />

            {mode === "edit" && activity && linkedWorkOrders !== undefined && (
              <ActivityLinkedWorkOrders
                activity={activity}
                workOrders={linkedWorkOrders}
                canCreateWorkOrder={canCreateWorkOrder}
              />
            )}

            {mode === "edit" && events !== undefined && <ActivityHistorySection events={events} />}
          </>
        }
      />
    </Stack>
  );
}
