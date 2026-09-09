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
 * a standalone `CreateWorkOrderCallout` card.
 *
 * *** Issue #133 *** ("Aanpassing Activity") replaced the old "every section
 * auto-saves the instant it's touched, no page-wide Save/Cancel" design with
 * `ArticleScreen`'s single-header-pencil model (`article-screen.tsx`'s own
 * module comment is the fuller reference): one `pageEditing` boolean, flipped
 * by the hero's own central pencil (`ActivityHero`'s `onEditHeader`), gates
 * Type/Description/Solution/Contact-person between a read view and an
 * editable one; every field writes straight into the shared `draft`
 * (`updateDraft`, passed down as each section's own `onFieldChange`); one
 * Save/Cancel pair in the hero's `actions` slot commits (or discards) the
 * whole accumulated `draft` in one shot.
 *
 * Two real differences from Article's byte-for-byte shape, both driven by
 * this story's own acceptance criteria:
 *  - Action holder is the one field that stays ALWAYS live-editable in
 *    `mode: "edit"`, independent of `pageEditing` entirely — no pencil, no
 *    dialog, no gate (`ActivityAssignmentSection`'s own doc comment). It can
 *    be reassigned without ever touching the header pencil.
 *  - The Save/Cancel pair's visibility is gated on `isDirty` (a real "did
 *    anything actually change" flag), NOT on `pageEditing` — Article shows
 *    Save the instant its pencil is clicked, before anything's touched, but
 *    Action holder changes can happen with `pageEditing` still `false`
 *    (point above), and those must ALSO surface Save. `isDirty` is set by
 *    every field-change path through `updateDraft` (including Action
 *    holder's own, whether or not `pageEditing` is on) and cleared on Cancel
 *    or a successful Save. `pageEditing` and `isDirty` are otherwise fully
 *    independent: `pageEditing` only controls which sections render as
 *    editable inputs vs. plain read text; it never gates Save/Cancel's own
 *    visibility.
 *
 * The Client/Asset/Contract/Contact-person `RelationCard`s and the Status
 * badge's own pencil/dialog are UNTOUCHED by issue #133 (same "cards keep
 * their own pencil" precedent `ArticleScreen`'s module comment documents for
 * Articles/Assets/Clients) — they keep committing immediately through
 * `commitPatch` below, exactly as before.
 *
 * `mode: "create"` needs none of the above: every section there is already
 * effectively "always live" (nothing to gate before the record even exists),
 * so it just writes straight into the shared `draft` via the same
 * `updateDraft`/`onFieldChange` plumbing, with no network call until the
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

  // The ONE editing surface for Type/Description/Solution/Contact-person
  // (see this component's own doc comment) — flipped by the hero's own
  // central pencil (`ActivityHero`'s `onEditHeader`). `mode: "create"` has no
  // use for this (every section there is already effectively "always live"),
  // so it's only ever toggled in `mode: "edit"`; forced `false` regardless
  // for a `readOnly` viewer, same "never render an edit affordance RLS would
  // reject" convention `ArticleScreen`'s own `pageEditing` documents.
  const [pageEditing, setPageEditing] = useState(false);

  // Set by every field-change path through `updateDraft` below (including
  // Action holder's own, whether or not `pageEditing` is on) — the Save/
  // Cancel pair in the hero's `actions` slot renders whenever this is `true`,
  // independent of `pageEditing` (see this component's own doc comment for
  // why the two are deliberately separate). Cleared on Cancel and on a
  // successful Save.
  const [isDirty, setIsDirty] = useState(false);

  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

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

  /** The Client/Asset/Contract/Contact-person `RelationCard`s' own small
   * popups (`ActivityRelationsDialog`/`ActivityStatusDialog`) still call this
   * directly, UNCHANGED by issue #133 (out of scope — see this component's
   * own doc comment): `mode: "edit"` persists immediately (`updateActivity`)
   * and refreshes the server-rendered data; `mode: "create"` only ever
   * merges into local draft state. Deliberately does NOT set `isDirty` —
   * these two popups already have their own Save/Cancel and persist (or
   * discard) on their own, independent of the page's own Save. */
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

  /** Every OTHER section's own field change calls this directly — a
   * local-only merge into the shared `draft`, never posted to the server
   * until `mode: "edit"`'s own page-wide Save (`handleEditSave` below) or
   * `mode: "create"`'s "Create activity" (`handleCreate` below). Always
   * marks the draft dirty, in both modes — harmless in `mode: "create"`
   * (nothing reads `isDirty` there; Cancel/Create render unconditionally). */
  function updateDraft(patch: Partial<ActivityDraft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
    setIsDirty(true);
  }

  function handleEditCancel() {
    if (!activity) return;
    setDraft(draftFromActivity(activity));
    setEditError(null);
    setIsDirty(false);
    setPageEditing(false);
  }

  async function handleEditSave() {
    if (!activity) return;
    if (!draft.description.trim()) {
      setEditError("Description is required.");
      return;
    }
    setEditError(null);
    setSaving(true);
    const result = await updateActivity(activity.id, draftToInput(draft));
    setSaving(false);
    if (!result.data) {
      const fieldMessages = Object.values(result.fieldErrors ?? {})
        .flatMap((messages) => messages ?? [])
        .filter(Boolean);
      setEditError(
        fieldMessages.length > 0
          ? fieldMessages.join(" ")
          : result.error ?? "Could not save.",
      );
      return;
    }
    router.refresh();
    setIsDirty(false);
    setPageEditing(false);
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
      isDirty ? (
        <>
          <Button type="button" variant="outline" onClick={handleEditCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={handleEditSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      ) : (
        <ActivityDetailActions activity={activity} canDelete={Boolean(canDelete)} />
      )
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

  // Drives Type/Description/Solution/Contact-person between their read and
  // editable states — `mode: "create"` is always "editable" (nothing to
  // gate before the record even exists, same as before issue #133);
  // `mode: "edit"` follows the page's own `pageEditing` flag.
  const sectionEditing = mode === "create" || pageEditing;

  return (
    <Stack gap="lg">
      {createError && <Text tone="danger">{createError}</Text>}
      {editError && <Text tone="danger">{editError}</Text>}

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
        onEditHeader={mode === "edit" && !readOnly && !pageEditing ? () => setPageEditing(true) : undefined}
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
              editing={sectionEditing}
              onFieldChange={updateDraft}
            />

            <ActivityAssignmentSection
              mode={mode}
              draft={draft}
              activity={activity}
              members={members}
              canAssignOthers={canAssignOthers}
              editing={sectionEditing}
              readOnly={readOnly}
              onFieldChange={updateDraft}
            />

            {showNotes && activity && (
              <ActivityNotesSection activityId={activity.id} notes={notes ?? []} readOnly={readOnly} />
            )}
          </>
        }
        right={
          <>
            <ActivityContactSection draft={draft} editing={sectionEditing} onFieldChange={updateDraft} />

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
