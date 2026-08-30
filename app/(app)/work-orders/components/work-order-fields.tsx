"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  DetailLayout,
  FormField,
  FormGrid,
  FormSelectField,
  Heading,
  Input,
  Label,
  Select,
  Stack,
  Text,
  Textarea,
} from "@yourorg/ui";
import type { WorkOrderRecord } from "../actions";
import {
  createWorkOrderFormAction,
  updateWorkOrderFormAction,
  type WorkOrderFormState,
} from "../work-order-form-actions";
import { listAssets, type AssetRecord } from "@/app/(app)/assets/actions";
import { listSites, type ClientRecord, type SiteRecord } from "@/app/(app)/clients/actions";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";
import { listContracts, type ContractRecord } from "@/app/(app)/contracts/actions";
import type { OrgMemberRecord } from "@/lib/members/actions";
import { memberDisplayName } from "@/lib/members/format";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { formatDateTime } from "@/lib/format/date";
import { WorkOrderRelationsRail } from "./work-order-relations-rail";

const initialState: WorkOrderFormState = { ok: false };

/** High enough for "every asset across this client's sites" in one request —
 * a work order's own client picker is a bounded, per-record scope, not the
 * org-wide Assets list (which paginates). Matches the client detail page's
 * `ALL_CLIENT_ASSETS_LIMIT` convention. */
const ALL_CLIENT_ASSETS_LIMIT = 500;

export interface WorkOrderFieldsProps {
  mode: "create" | "edit";
  /** Required for `mode: "edit"`. */
  workOrder?: WorkOrderRecord;
  /**
   * Resolved display records for the read-only render path below — already
   * fetched once by `[id]/page.tsx` (via `getClient`/`getAsset`) for the old
   * read-only `DetailRow` cards this component replaces, reused here rather
   * than re-fetched. Unused in `mode: "create"` (there is nothing to
   * display read-only there — a caller only ever reaches `/work-orders/new`
   * with `create` permission, see that page's own gate).
   */
  client?: ClientRecord | null;
  site?: SiteRecord | null;
  asset?: AssetRecord | null;
  /**
   * Resolved display record for the work order's linked Contract (issue #100)
   * — fetched once by `[id]/page.tsx` via `getContract(workOrder.contract_id)`
   * the same way `client`/`asset` are, and used the same two ways: the
   * read-only rail's authoritative source, and the editable rail's fallback
   * before `listContracts` (below) resolves the initially-selected contract.
   * Unused in `mode: "create"` — a brand-new work order has no saved contract
   * yet (there is no `?contractId=` pre-scoping entry point today, see this
   * component's own rail-selection comment below).
   */
  contract?: ContractRecord | null;
  assignedMember?: OrgMemberRecord | null;
  /**
   * `false` (the default) only ever matters for `mode: "edit"`: an actor
   * with neither `update` nor `update_own` on `planning` (a `finance`/
   * `administratie` viewer) sees every field below as plain read-only text —
   * with the same Client/Asset/Contract links the old read-only "Site,
   * asset & contract" card had — instead of a *disabled* input, which would
   * still visually invite interaction only to be silently rejected by RLS.
   * `mode: "create"` never sets this — a caller only ever reaches that route
   * with `can(actor, "planning", "create")` already confirmed by the page.
   */
  readOnly?: boolean;
  /** Org's clients, for the client -> site -> asset cascading pickers.
   * Ignored (and the picker hidden entirely) when `lockedClientId` is set.
   * Also unused when `readOnly`. */
  clients: ClientRecord[];
  /**
   * Pre-scopes the site/asset pickers to a single client and hides the
   * client selector entirely — used when this form is opened in a
   * client-scoped context (a future Client detail page "New work order"
   * action, via `/work-orders/new?clientId=...`), where the client is
   * already implied and re-picking it makes no sense.
   */
  lockedClientId?: string;
  /** Pre-selects (but doesn't lock) the site — e.g. `/work-orders/new?siteId=...`. */
  initialSiteId?: string;
  /** Pre-selects (but doesn't lock) the asset — e.g. `/work-orders/new?assetId=...`. */
  initialAssetId?: string;
  /**
   * The activity this work order is being created from/against (issue #87,
   * `?activityId=` on `/work-orders/new` — see that page's own doc comment),
   * submitted as a hidden `sourceActivityId` field
   * (`workOrderCreateSchema.sourceActivityId`). CREATE-only, deliberately:
   * unlike `lockedClientId`/`initialSiteId`/`initialAssetId` there is no
   * `mode: "edit"` equivalent and no picker at all — a work order's
   * originating activity is a one-time traceability link set at creation,
   * not a field a user chooses or later reassigns.
   */
  sourceActivityId?: string;
  /** This org's `work_order_status` picklist values. */
  statuses: ReferenceListItemRecord[];
  /** This org's `work_order_priority` picklist values. */
  priorities: ReferenceListItemRecord[];
  /** This org's members, for the "Assigned to" picker. */
  members: OrgMemberRecord[];
  /** Where "Cancel" navigates — `mode: "create"` only. `mode: "edit"` resets
   * the fields back to their last-saved values in place instead (issue #89
   * folded the standalone `/work-orders/[id]/edit` route into this same
   * detail page, so there is no separate route left to navigate away from). */
  cancelHref?: string;
}

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Converts the visible `datetime-local` input's local-time value (no
 * timezone offset) into a real ISO 8601 datetime, via the browser's own
 * `Date` parsing — done client-side (not in the server action) specifically
 * so it resolves against the *user's* timezone, not the server's. Fed into a
 * hidden field of the actual submitted field name (see `scheduledAt` below);
 * `workOrderCreateSchema.scheduledAt` requires an offset/`Z`-suffixed ISO
 * string, which a bare `datetime-local` value is not. */
function toIsoDateTime(local: string): string {
  if (!local) return "";
  const date = new Date(local);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

/** Label/muted-value pair for the read-only render path — same shape as the
 * old `[id]/page.tsx`'s own `DetailRow` this component's read-only branch
 * replaces. */
function ReadOnlyField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Stack gap="xs">
      <Text tone="muted">{label}</Text>
      <Text>{value}</Text>
    </Stack>
  );
}

/**
 * The work order's own fields (Job / Assignment & Schedule / Status &
 * Priority) — the single shared component behind the single shared
 * `WorkOrderScreen` (`../components/work-order-screen.tsx`) that both
 * `/work-orders/new` (`mode: "create"`) and the work order detail page
 * (`mode: "edit"`) render. Per docs/ARCHITECTURE.md "Popup vs. full page",
 * Work Orders is a top-level module entity — `/work-orders/new` stays a real
 * page, never a `Dialog`; editing an existing one no longer needs its OWN
 * page at all now that it lives inline on the record's own detail page
 * instead.
 *
 * *** Issue #100 layout pass ***: both the read-only and editable render
 * paths now wrap their fields `Card`s in `@yourorg/ui`'s `DetailLayout` —
 * the fields stay the main (left) column, and a new sticky rail
 * (`WorkOrderRelationsRail`) surfaces Client/Site/Asset/Contract as compact
 * linked-entity summary cards (name/address + a couple of key facts + a link
 * to that record's own detail page, same visual language as
 * `client-detail.tsx`'s own rail `Card`s), instead of those relations only
 * ever being a bare id in a `<Select>` or a single plain text row. This is a
 * genuine two-column split, not a cosmetic one: the rail reads from the SAME
 * selection state as the `<Select>`s below it (`selectedClientId` etc.), so
 * in the editable path it live-updates as soon as a different client/site/
 * asset/contract is picked — a running preview of what's about to be saved,
 * not just a readout of what's already saved. `mode: "create"` naturally
 * starts with every rail card empty (nothing chosen yet) until the user
 * picks a client, which is expected, not a bug.
 *
 * `mode: "edit"` + `readOnly` renders every field as plain text (see
 * `ReadOnlyField` above) instead of a form at all — no `<form>`, no Save/
 * Cancel, nothing to submit. This is what a `finance`/`administratie` viewer
 * (plain `read`, no `update`/`update_own` on `planning`) sees: the page still
 * resolves (never a 404), just with nothing editable, rather than a
 * *disabled* input that would still visually read as "maybe I can click
 * this" only to be rejected by RLS. The relations rail renders here too,
 * from the already-resolved `client`/`site`/`asset`/`contract` props only
 * (no client-side fetch — a read-only viewer never needs the picker lists).
 *
 * Client -> Site -> Asset cascade (editable path only) mirrors
 * `asset-form.tsx`'s Client -> Site pattern (fetch on parent change, disabled
 * + "select the parent first" placeholder until it has a value) with one
 * difference: unlike Asset Sub-type (which has no meaning without a chosen
 * Type), a work order's Asset is only *optionally* scoped further by Site —
 * the backend (`validate_work_order_relations`) allows an `asset_id` with no
 * `site_id` at all, just requires the two to agree when both are set. So
 * Asset here is a plain `<Select>` (not the shared `CascadingSelect`
 * primitive, which disables its child entirely until the parent has a
 * value) filtered to the selected Site's assets when one is chosen, and to
 * every asset of the selected Client otherwise.
 */
export function WorkOrderFields({
  mode,
  workOrder,
  client,
  site,
  asset,
  contract,
  assignedMember,
  readOnly = false,
  clients,
  lockedClientId,
  initialSiteId,
  initialAssetId,
  sourceActivityId,
  statuses,
  priorities,
  members,
  cancelHref,
}: WorkOrderFieldsProps) {
  const router = useRouter();
  const action =
    mode === "edit" && workOrder ? updateWorkOrderFormAction.bind(null, workOrder.id) : createWorkOrderFormAction;
  const [state, formAction] = useActionState(action, initialState);
  // Bumped on Cancel (edit mode only) to force-remount the `<form>` subtree,
  // discarding any unsaved edits in its uncontrolled fields (Title,
  // Description, Notes, Assigned to, Status, Priority — all plain
  // `defaultValue`, which only re-applies on mount). The controlled fields
  // (client/site/asset/contract/scheduled) are reset explicitly in
  // `handleCancel` below instead, since a remount alone wouldn't touch state
  // owned by this component.
  const [formKey, setFormKey] = useState(0);

  const [selectedClientId, setSelectedClientId] = useState(lockedClientId ?? workOrder?.client_id ?? "");
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [loadingSites, setLoadingSites] = useState(false);
  const [selectedSiteId, setSelectedSiteId] = useState(workOrder?.site_id ?? initialSiteId ?? "");

  const [clientAssets, setClientAssets] = useState<AssetRecord[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState(workOrder?.asset_id ?? initialAssetId ?? "");

  const [clientContracts, setClientContracts] = useState<ContractRecord[]>([]);
  const [loadingContracts, setLoadingContracts] = useState(false);
  const [selectedContractId, setSelectedContractId] = useState(workOrder?.contract_id ?? "");

  const [scheduledAtLocal, setScheduledAtLocal] = useState(toDatetimeLocalValue(workOrder?.scheduled_at));

  // Skipped entirely when `readOnly` — a read-only viewer never needs the
  // site/asset/contract picker lists at all; the resolved `site`/`asset`/
  // `workOrder.contract` props already have everything the read-only render
  // path below shows.
  useEffect(() => {
    if (readOnly || !selectedClientId) {
      setSites([]);
      return;
    }
    let cancelled = false;
    setLoadingSites(true);
    listSites(selectedClientId)
      .then((result) => {
        if (cancelled) return;
        setSites(result.data?.sites ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoadingSites(false);
      });
    return () => {
      cancelled = true;
    };
  }, [readOnly, selectedClientId]);

  useEffect(() => {
    if (readOnly || !selectedClientId) {
      setClientAssets([]);
      return;
    }
    let cancelled = false;
    setLoadingAssets(true);
    listAssets({ clientId: selectedClientId, limit: ALL_CLIENT_ASSETS_LIMIT })
      .then((result) => {
        if (cancelled) return;
        setClientAssets(result.data?.assets ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoadingAssets(false);
      });
    return () => {
      cancelled = true;
    };
  }, [readOnly, selectedClientId]);

  // Contract picker, filtered to the selected client's contracts — same
  // "fetch on parent change" shape as Site/Asset above (issue #33).
  useEffect(() => {
    if (readOnly || !selectedClientId) {
      setClientContracts([]);
      return;
    }
    let cancelled = false;
    setLoadingContracts(true);
    listContracts({ clientId: selectedClientId, limit: ALL_CLIENT_ASSETS_LIMIT })
      .then((result) => {
        if (cancelled) return;
        setClientContracts(result.data?.contracts ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoadingContracts(false);
      });
    return () => {
      cancelled = true;
    };
  }, [readOnly, selectedClientId]);

  useEffect(() => {
    if (state.ok && state.workOrder && mode === "create") {
      router.push(`/work-orders/${state.workOrder.id}`);
    }
    // `mode: "edit"` deliberately does NOT navigate anywhere on success (issue
    // #89) — it's already on the one and only screen for this record; the
    // page's own server data is refreshed by the caller (`[id]/page.tsx`
    // re-keys this component by `workOrder.updated_at`, so a fresh save
    // naturally remounts it with the latest saved values).
    // Only re-run when the action result actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok, state.workOrder, mode]);

  function handleClientChange(nextClientId: string) {
    setSelectedClientId(nextClientId);
    // A new client invalidates any previously selected site/asset/contract —
    // same "discard the now-stale child selection" reasoning as the
    // Sub-type remount in `asset-form.tsx`, just done via controlled state
    // here instead of a `key` remount (this form needs the live values for
    // filtering, not just for submission).
    setSelectedSiteId("");
    setSelectedAssetId("");
    setSelectedContractId("");
  }

  function handleSiteChange(nextSiteId: string) {
    setSelectedSiteId(nextSiteId);
    const selectedAsset = clientAssets.find((candidate) => candidate.id === selectedAssetId);
    if (nextSiteId && selectedAsset && selectedAsset.site_id !== nextSiteId) {
      setSelectedAssetId("");
    }
  }

  function handleCancel() {
    if (mode === "create") {
      router.push(cancelHref ?? "/work-orders");
      return;
    }
    // Edit mode: reset in place rather than navigate — see this component's
    // own doc comment.
    setSelectedClientId(lockedClientId ?? workOrder?.client_id ?? "");
    setSelectedSiteId(workOrder?.site_id ?? initialSiteId ?? "");
    setSelectedAssetId(workOrder?.asset_id ?? initialAssetId ?? "");
    setSelectedContractId(workOrder?.contract_id ?? "");
    setScheduledAtLocal(toDatetimeLocalValue(workOrder?.scheduled_at));
    setFormKey((key) => key + 1);
  }

  const filteredAssets = selectedSiteId
    ? clientAssets.filter((candidate) => candidate.site_id === selectedSiteId)
    : clientAssets;

  const defaultStatus = statuses.find((item) => item.is_default);

  // "Assigned to" is this work order's standard/default engineer (issue #87)
  // — the technician a Time Entry's engineer picker defaults to (see
  // `time-entries-panel.tsx`'s `createTimeEntry` default-to-`assigned_to`
  // logic). Filtered to `role === "engineer"` members only: assigning a
  // work order to an owner/planner/finance/administratie member has no
  // meaning in that downstream flow. The currently-assigned member is always
  // included even if they aren't (or are no longer) an engineer — otherwise
  // editing a work order assigned before this filter existed (or to someone
  // whose role since changed) would render with no matching `<option>`, and
  // saving without touching this field would silently unassign it.
  const engineers = members.filter(
    (member) => member.role === "engineer" || member.id === workOrder?.assigned_to,
  );

  if (readOnly) {
    return (
      <DetailLayout
        rail={
          <WorkOrderRelationsRail
            client={client ?? null}
            hasClientSelection={Boolean(workOrder?.client_id)}
            clientLoading={false}
            site={site ?? null}
            hasSiteSelection={Boolean(workOrder?.site_id)}
            siteLoading={false}
            asset={asset ?? null}
            hasAssetSelection={Boolean(workOrder?.asset_id)}
            assetLoading={false}
            contract={contract ?? null}
            hasContractSelection={Boolean(workOrder?.contract_id)}
            contractLoading={false}
          />
        }
      >
        <Stack gap="lg">
          <Card>
            <Stack gap="sm">
              <Heading level={6}>Job</Heading>
              <ReadOnlyField label="Title" value={workOrder?.title ?? "—"} />
              <ReadOnlyField label="Description" value={workOrder?.description ?? "—"} />
              <ReadOnlyField label="Notes" value={workOrder?.notes ?? "—"} />
            </Stack>
          </Card>

          <Card>
            <Stack gap="sm">
              <Heading level={6}>Assignment &amp; Schedule</Heading>
              <ReadOnlyField label="Assigned to" value={memberDisplayName(assignedMember)} />
              <ReadOnlyField
                label="Scheduled for"
                value={formatDateTime(workOrder?.scheduled_at ?? null, { month: "long" })}
              />
            </Stack>
          </Card>

          <Card>
            <Stack gap="sm">
              <Heading level={6}>Status &amp; Priority</Heading>
              <ReadOnlyField label="Status" value={workOrder?.work_order_status?.label ?? "—"} />
              <ReadOnlyField label="Priority" value={workOrder?.work_order_priority?.label ?? "—"} />
              <ReadOnlyField
                label="Completed at"
                value={formatDateTime(workOrder?.completed_at ?? null, { month: "long" })}
              />
            </Stack>
          </Card>
        </Stack>
      </DetailLayout>
    );
  }

  // Rail preview values (editable path) — each prefers the live picker-list
  // lookup (so the rail updates the instant a different client/site/asset/
  // contract is picked), falling back to the already-resolved `client`/
  // `site`/`asset`/`contract` props only while that list hasn't loaded yet
  // (or — for `client` specifically — never loads at all, e.g. a locked
  // client, whose picker/list is hidden entirely). See this component's own
  // doc comment above for why this is safe: the fallback prop always
  // corresponds to the SAME id the picker started with, never a stale one —
  // once a user picks something new, the just-fetched list already contains
  // it (it's literally where the `<option>` they clicked came from).
  const selectedClient = clients.find((candidate) => candidate.id === selectedClientId) ?? client ?? null;
  const selectedSite =
    sites.find((candidate) => candidate.id === selectedSiteId) ?? (selectedSiteId ? (site ?? null) : null);
  const selectedAsset =
    clientAssets.find((candidate) => candidate.id === selectedAssetId) ?? (selectedAssetId ? (asset ?? null) : null);
  const selectedContract =
    clientContracts.find((candidate) => candidate.id === selectedContractId) ??
    (selectedContractId ? (contract ?? null) : null);

  return (
    <form key={formKey} action={formAction}>
      <Stack gap="lg">
        {state.error && <Text tone="danger">{state.error}</Text>}

        <DetailLayout
          rail={
            <WorkOrderRelationsRail
              client={selectedClient}
              hasClientSelection={Boolean(selectedClientId)}
              clientLoading={false}
              site={selectedSite}
              hasSiteSelection={Boolean(selectedSiteId)}
              siteLoading={loadingSites}
              asset={selectedAsset}
              hasAssetSelection={Boolean(selectedAssetId)}
              assetLoading={loadingAssets}
              contract={selectedContract}
              hasContractSelection={Boolean(selectedContractId)}
              contractLoading={loadingContracts}
            />
          }
        >
          <Stack gap="lg">
            <Card>
              <Stack gap="sm">
                <Heading level={6}>Job</Heading>
                <Text tone="muted">What needs to happen.</Text>
                <Stack gap="md">
                  <FormField
                    label="Title"
                    name="title"
                    defaultValue={workOrder?.title}
                    required
                    maxLength={200}
                    errors={state.fieldErrors?.title}
                  />

                  <Stack gap="sm">
                    <Label htmlFor="wo-description">Description</Label>
                    <Textarea
                      id="wo-description"
                      name="description"
                      defaultValue={workOrder?.description ?? ""}
                      rows={3}
                    />
                    {state.fieldErrors?.description && <Text tone="danger">{state.fieldErrors.description[0]}</Text>}
                  </Stack>

                  <Stack gap="sm">
                    <Label htmlFor="wo-notes">Notes</Label>
                    <Textarea id="wo-notes" name="notes" defaultValue={workOrder?.notes ?? ""} rows={3} />
                    {state.fieldErrors?.notes && <Text tone="danger">{state.fieldErrors.notes[0]}</Text>}
                  </Stack>
                </Stack>
              </Stack>
            </Card>

            <Card>
              <Stack gap="sm">
                <Heading level={6}>Assignment &amp; Schedule</Heading>
                <Text tone="muted">Where, what, who, and when.</Text>
                <Stack gap="md">
                  {!lockedClientId && (
                    <Stack gap="sm">
                      <Label htmlFor="wo-client">Client</Label>
                      <Select
                        id="wo-client"
                        name="clientId"
                        value={selectedClientId}
                        onChange={(event) => handleClientChange(event.target.value)}
                        required
                      >
                        <option value="" disabled>
                          Select a client…
                        </option>
                        {clients.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.name}
                          </option>
                        ))}
                      </Select>
                      {state.fieldErrors?.clientId && <Text tone="danger">{state.fieldErrors.clientId[0]}</Text>}
                    </Stack>
                  )}
                  {lockedClientId && <input type="hidden" name="clientId" value={lockedClientId} />}
                  {mode === "create" && sourceActivityId && (
                    <input type="hidden" name="sourceActivityId" value={sourceActivityId} />
                  )}

                  <FormGrid columns={2}>
                    <Stack gap="sm">
                      <Label htmlFor="wo-site">Site</Label>
                      <Select
                        id="wo-site"
                        name="siteId"
                        value={selectedSiteId}
                        onChange={(event) => handleSiteChange(event.target.value)}
                        disabled={!selectedClientId || loadingSites}
                      >
                        <option value="">{loadingSites ? "Loading sites…" : "No specific site"}</option>
                        {sites.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {formatSiteAddressShort(candidate) ?? "Unnamed site"}
                          </option>
                        ))}
                      </Select>
                      {state.fieldErrors?.siteId && <Text tone="danger">{state.fieldErrors.siteId[0]}</Text>}
                    </Stack>

                    <Stack gap="sm">
                      <Label htmlFor="wo-asset">Asset</Label>
                      <Select
                        id="wo-asset"
                        name="assetId"
                        value={selectedAssetId}
                        onChange={(event) => setSelectedAssetId(event.target.value)}
                        disabled={!selectedClientId || loadingAssets}
                      >
                        <option value="">
                          {!selectedClientId
                            ? "Select a client first…"
                            : loadingAssets
                              ? "Loading assets…"
                              : "No specific asset"}
                        </option>
                        {filteredAssets.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.name}
                          </option>
                        ))}
                      </Select>
                      {state.fieldErrors?.assetId && <Text tone="danger">{state.fieldErrors.assetId[0]}</Text>}
                    </Stack>
                  </FormGrid>

                  <Stack gap="sm">
                    <Label htmlFor="wo-contract">Contract</Label>
                    <Select
                      id="wo-contract"
                      name="contractId"
                      value={selectedContractId}
                      onChange={(event) => setSelectedContractId(event.target.value)}
                      disabled={!selectedClientId || loadingContracts}
                    >
                      <option value="">
                        {!selectedClientId
                          ? "Select a client first…"
                          : loadingContracts
                            ? "Loading contracts…"
                            : "No contract"}
                      </option>
                      {clientContracts.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name}
                        </option>
                      ))}
                    </Select>
                    {state.fieldErrors?.contractId && <Text tone="danger">{state.fieldErrors.contractId[0]}</Text>}
                  </Stack>

                  <FormGrid columns={2}>
                    <Stack gap="sm">
                      <Label htmlFor="assignedTo">Assigned to (standard engineer)</Label>
                      <Select id="assignedTo" name="assignedTo" defaultValue={workOrder?.assigned_to ?? ""}>
                        <option value="">Unassigned</option>
                        {engineers.map((member) => (
                          <option key={member.id} value={member.id}>
                            {memberDisplayName(member)}
                          </option>
                        ))}
                      </Select>
                      <Text tone="muted">
                        Defaults every logged travel/work time entry to this engineer — changeable per entry.
                      </Text>
                      {state.fieldErrors?.assignedTo && <Text tone="danger">{state.fieldErrors.assignedTo[0]}</Text>}
                    </Stack>

                    <Stack gap="sm">
                      <Label htmlFor="wo-scheduled">Scheduled for</Label>
                      <Input
                        id="wo-scheduled"
                        type="datetime-local"
                        value={scheduledAtLocal}
                        onChange={(event) => setScheduledAtLocal(event.target.value)}
                      />
                      <input type="hidden" name="scheduledAt" value={toIsoDateTime(scheduledAtLocal)} />
                      {state.fieldErrors?.scheduledAt && (
                        <Text tone="danger">{state.fieldErrors.scheduledAt[0]}</Text>
                      )}
                    </Stack>
                  </FormGrid>
                </Stack>
              </Stack>
            </Card>

            <Card>
              <Stack gap="sm">
                <Heading level={6}>Status &amp; Priority</Heading>
                <Text tone="muted">Lifecycle state and urgency.</Text>
                <FormGrid columns={2}>
                  <FormSelectField
                    label="Status"
                    name="statusId"
                    defaultValue={workOrder?.status_id ?? ""}
                    errors={state.fieldErrors?.statusId}
                  >
                    <option value="">
                      {defaultStatus ? `Use default (${defaultStatus.label})` : "Use organization default"}
                    </option>
                    {statuses.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </FormSelectField>

                  <FormSelectField
                    label="Priority"
                    name="priorityId"
                    defaultValue={workOrder?.priority_id ?? ""}
                    errors={state.fieldErrors?.priorityId}
                  >
                    <option value="">No priority</option>
                    {priorities.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </FormSelectField>
                </FormGrid>
                {/* Never an input — `completed_at` is a derived/system field (set
                    when a work order's status transitions to done), not
                    something a user sets directly, so it's always shown
                    read-only regardless of mode. */}
                {mode === "edit" && (
                  <ReadOnlyField
                    label="Completed at"
                    value={formatDateTime(workOrder?.completed_at ?? null, { month: "long" })}
                  />
                )}
              </Stack>
            </Card>
          </Stack>
        </DetailLayout>

        <div>
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>{" "}
          <SubmitButton mode={mode} />
        </div>
      </Stack>
    </form>
  );
}

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? "Saving…" : mode === "create" ? "Add work order" : "Save changes"}
    </Button>
  );
}
