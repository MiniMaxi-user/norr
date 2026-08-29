"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  FormField,
  FormGrid,
  FormSection,
  FormSelectField,
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

const initialState: WorkOrderFormState = { ok: false };

/** High enough for "every asset across this client's sites" in one request —
 * a work order's own client picker is a bounded, per-record scope, not the
 * org-wide Assets list (which paginates). Matches the client detail page's
 * `ALL_CLIENT_ASSETS_LIMIT` convention. */
const ALL_CLIENT_ASSETS_LIMIT = 500;

export interface WorkOrderFormProps {
  mode: "create" | "edit";
  /** Required for `mode: "edit"`. */
  workOrder?: WorkOrderRecord;
  /** Org's clients, for the client -> site -> asset cascading pickers.
   * Ignored (and the picker hidden entirely) when `lockedClientId` is set. */
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
  /** This org's `work_order_status` picklist values. */
  statuses: ReferenceListItemRecord[];
  /** This org's `work_order_priority` picklist values. */
  priorities: ReferenceListItemRecord[];
  /** This org's members, for the "Assigned to" picker. */
  members: OrgMemberRecord[];
  /** Where "Cancel" navigates to. */
  cancelHref: string;
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

/**
 * Create/edit form for a work order, rendered as a real page (`/work-orders/new`,
 * `/work-orders/[id]/edit`) rather than a `Dialog` — per docs/ARCHITECTURE.md
 * "Popup vs. full page — pick by weight, not habit" (Planning/Work Orders is
 * a named top-level module entity there).
 *
 * Client -> Site -> Asset cascade mirrors `asset-form.tsx`'s Client -> Site
 * pattern (fetch on parent change, disabled + "select the parent first"
 * placeholder until it has a value) with one difference: unlike Asset
 * Sub-type (which has no meaning without a chosen Type), a work order's
 * Asset is only *optionally* scoped further by Site — the backend
 * (`validate_work_order_relations`) allows an `asset_id` with no `site_id`
 * at all, just requires the two to agree when both are set. So Asset here is
 * a plain `<Select>` (not the shared `CascadingSelect` primitive, which
 * disables its child entirely until the parent has a value) filtered to the
 * selected Site's assets when one is chosen, and to every asset of the
 * selected Client otherwise.
 */
export function WorkOrderForm({
  mode,
  workOrder,
  clients,
  lockedClientId,
  initialSiteId,
  initialAssetId,
  statuses,
  priorities,
  members,
  cancelHref,
}: WorkOrderFormProps) {
  const router = useRouter();
  const action =
    mode === "edit" && workOrder ? updateWorkOrderFormAction.bind(null, workOrder.id) : createWorkOrderFormAction;
  const [state, formAction] = useActionState(action, initialState);

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

  useEffect(() => {
    if (!selectedClientId) {
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
  }, [selectedClientId]);

  useEffect(() => {
    if (!selectedClientId) {
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
  }, [selectedClientId]);

  // Contract picker, filtered to the selected client's contracts — same
  // "fetch on parent change" shape as Site/Asset above (issue #33).
  useEffect(() => {
    if (!selectedClientId) {
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
  }, [selectedClientId]);

  useEffect(() => {
    if (state.ok && state.workOrder) {
      router.push(`/work-orders/${state.workOrder.id}`);
    }
    // Only re-run when the action result actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok, state.workOrder]);

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
    const selectedAsset = clientAssets.find((asset) => asset.id === selectedAssetId);
    if (nextSiteId && selectedAsset && selectedAsset.site_id !== nextSiteId) {
      setSelectedAssetId("");
    }
  }

  const filteredAssets = selectedSiteId
    ? clientAssets.filter((asset) => asset.site_id === selectedSiteId)
    : clientAssets;

  const defaultStatus = statuses.find((item) => item.is_default);

  return (
    <Card>
      <form action={formAction}>
        <Stack gap="lg">
          {state.error && <Text tone="danger">{state.error}</Text>}

          <FormSection title="Job" description="What needs to happen.">
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
          </FormSection>

          <FormSection title="Assignment & Schedule" description="Where, what, who, and when.">
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
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </Select>
                  {state.fieldErrors?.clientId && <Text tone="danger">{state.fieldErrors.clientId[0]}</Text>}
                </Stack>
              )}
              {lockedClientId && <input type="hidden" name="clientId" value={lockedClientId} />}

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
                    {sites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {formatSiteAddressShort(site) ?? "Unnamed site"}
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
                    {filteredAssets.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.name}
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
                  {clientContracts.map((contract) => (
                    <option key={contract.id} value={contract.id}>
                      {contract.name}
                    </option>
                  ))}
                </Select>
                {state.fieldErrors?.contractId && <Text tone="danger">{state.fieldErrors.contractId[0]}</Text>}
              </Stack>

              <FormGrid columns={2}>
                <FormSelectField
                  label="Assigned to"
                  name="assignedTo"
                  defaultValue={workOrder?.assigned_to ?? ""}
                  errors={state.fieldErrors?.assignedTo}
                >
                  <option value="">Unassigned</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {memberDisplayName(member)}
                    </option>
                  ))}
                </FormSelectField>

                <Stack gap="sm">
                  <Label htmlFor="wo-scheduled">Scheduled for</Label>
                  <Input
                    id="wo-scheduled"
                    type="datetime-local"
                    value={scheduledAtLocal}
                    onChange={(event) => setScheduledAtLocal(event.target.value)}
                  />
                  <input type="hidden" name="scheduledAt" value={toIsoDateTime(scheduledAtLocal)} />
                  {state.fieldErrors?.scheduledAt && <Text tone="danger">{state.fieldErrors.scheduledAt[0]}</Text>}
                </Stack>
              </FormGrid>
            </Stack>
          </FormSection>

          <FormSection title="Status & Priority" description="Lifecycle state and urgency.">
            <FormGrid columns={2}>
              <FormSelectField
                label="Status"
                name="statusId"
                defaultValue={workOrder?.status_id ?? ""}
                errors={state.fieldErrors?.statusId}
              >
                <option value="">{defaultStatus ? `Use default (${defaultStatus.label})` : "Use organization default"}</option>
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
          </FormSection>

          <div>
            <Button type="button" variant="outline" onClick={() => router.push(cancelHref)}>
              Cancel
            </Button>{" "}
            <SubmitButton mode={mode} />
          </div>
        </Stack>
      </form>
    </Card>
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
