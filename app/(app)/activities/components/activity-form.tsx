"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  Combobox,
  DefinitionList,
  FormGrid,
  FormSection,
  IconTileSelect,
  Input,
  Label,
  Select,
  Stack,
  Text,
  Textarea,
} from "@yourorg/ui";
import type { ActivityRecord } from "../actions";
import { createActivityFormAction, updateActivityFormAction, type ActivityFormState } from "../activity-form-actions";
import { resolveActivityTypeIcon } from "../icon-map";
import { listAssets, type AssetRecord } from "@/app/(app)/assets/actions";
import { listSites, type ClientRecord, type SiteRecord } from "@/app/(app)/clients/actions";
import { listContacts, type ContactRecord } from "@/app/(app)/clients/contacts-actions";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";
import type { OrgMemberRecord } from "@/lib/members/actions";
import { memberDisplayName } from "@/lib/members/format";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";

const initialState: ActivityFormState = { ok: false };

/** High enough for "every asset/contact across this client" in one request —
 * same bounded, per-record-scope reasoning as `WorkOrderForm`'s own
 * `ALL_CLIENT_ASSETS_LIMIT`. */
const ALL_CLIENT_LIMIT = 500;

export interface ActivityFormProps {
  mode: "create" | "edit";
  /** Required for `mode: "edit"`. */
  activity?: ActivityRecord;
  /** Org's clients, for the plain (unlocked) client picker. Ignored when the
   * form is locked to a client or an asset (see below). */
  clients: ClientRecord[];
  /** Present exactly when this form was opened pre-scoped to a client
   * (`/activities/new?clientId=...`, or an asset's own client once resolved)
   * — locks the client picker to a read-only label. `mode: "edit"` never
   * locks (the client stays editable there). */
  lockedClientId?: string;
  /** The resolved client record for `lockedClientId` — used for the
   * read-only display label. */
  lockedClient?: ClientRecord | null;
  /** Present exactly when this form was opened pre-scoped to an asset
   * (`/activities/new?assetId=...`) — locks BOTH the client and the asset;
   * the client is derived server-side from this asset, never re-picked (per
   * `resolveActivityClientId` in `../actions.ts`). */
  lockedAsset?: AssetRecord | null;
  /** Pre-resolved short address for `lockedAsset`'s own site — avoids a
   * client-side re-fetch of that client's sites just to show one address. */
  lockedAssetAddress?: string | null;
  /** This org's `activity_type` picklist (5 icon-carrying items). */
  activityTypes: ReferenceListItemRecord[];
  /** This org's `activity_status` picklist. */
  activityStatuses: ReferenceListItemRecord[];
  /** This org's members, for the "Action holder" picker. */
  members: OrgMemberRecord[];
  /** The signed-in user's own id — used to pin "Action holder" for a caller
   * who can only ever act as themselves (an engineer, `create_own`/
   * `update_own` only — the server silently pins this regardless of what's
   * submitted, see `../actions.ts`; this is purely the matching UI so it
   * doesn't look like a free choice that then gets silently overridden). */
  currentUserId: string;
  /** Whether this actor holds the unscoped `create`/`update` action (owner/
   * planner) — when `false`, the Action holder picker is locked to
   * `currentUserId`. */
  canAssignOthers: boolean;
  /** Where "Cancel" navigates to, and where a successful save redirects —
   * back to the client/asset this was created in the context of, or the
   * module's own overview otherwise. */
  redirectHref: string;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Create/edit form for an activity, rendered as a real page (`/activities/new`,
 * `/activities/[id]/edit`) rather than a `Dialog` — per docs/ARCHITECTURE.md
 * "Popup vs. full page" (Activities is a top-level module's own primary
 * record, not one of the Clients/Assets carve-outs).
 *
 * Same field set for every activity type (per the acceptance criteria), with
 * conditional required-ness driven by the currently-selected type's stable
 * `value` slug (never its label, which is tenant-editable): Asset for
 * storing/onderhoud, a contact person or name+phone for bel_activiteit. This
 * mirrors `../actions.ts`'s own `createActivity` server-side check, but is
 * purely a client-side UX nicety — the server (and ultimately
 * `validate_activity_relations`) is always the real backstop.
 */
export function ActivityForm({
  mode,
  activity,
  clients,
  lockedClientId,
  lockedClient,
  lockedAsset,
  lockedAssetAddress,
  activityTypes,
  activityStatuses,
  members,
  currentUserId,
  canAssignOthers,
  redirectHref,
}: ActivityFormProps) {
  const router = useRouter();
  const action =
    mode === "edit" && activity ? updateActivityFormAction.bind(null, activity.id) : createActivityFormAction;
  const [state, formAction] = useActionState(action, initialState);

  const isAssetLocked = mode === "create" && Boolean(lockedAsset);
  const isClientLocked = mode === "create" && (Boolean(lockedClientId) || isAssetLocked);

  const [selectedClientId, setSelectedClientId] = useState(
    isAssetLocked ? (lockedAsset as AssetRecord).client_id : (lockedClientId ?? activity?.client_id ?? ""),
  );
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState(
    isAssetLocked ? (lockedAsset as AssetRecord).id : (activity?.asset_id ?? ""),
  );

  const [sites, setSites] = useState<SiteRecord[]>([]);

  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [selectedContactPersonId, setSelectedContactPersonId] = useState(activity?.contact_person_id ?? "");
  const [contactName, setContactName] = useState(activity?.contact_name ?? "");
  const [contactPhone, setContactPhone] = useState(activity?.contact_phone ?? "");
  const [contactEmail, setContactEmail] = useState(activity?.contact_email ?? "");

  const [selectedTypeId, setSelectedTypeId] = useState(activity?.type_id ?? "");
  const [selectedStatusId, setSelectedStatusId] = useState(activity?.status_id ?? "");
  const [selectedActionHolderId, setSelectedActionHolderId] = useState(
    canAssignOthers ? (activity?.action_holder_id ?? "") : currentUserId,
  );

  useEffect(() => {
    if (isAssetLocked || !selectedClientId) {
      setAssets([]);
      setSites([]);
      return;
    }
    let cancelled = false;
    setLoadingAssets(true);
    Promise.all([listAssets({ clientId: selectedClientId, limit: ALL_CLIENT_LIMIT }), listSites(selectedClientId)])
      .then(([assetsResult, sitesResult]) => {
        if (cancelled) return;
        setAssets(assetsResult.data?.assets ?? []);
        setSites(sitesResult.data?.sites ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoadingAssets(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedClientId, isAssetLocked]);

  useEffect(() => {
    if (!selectedClientId) {
      setContacts([]);
      return;
    }
    let cancelled = false;
    setLoadingContacts(true);
    listContacts(selectedClientId)
      .then((result) => {
        if (cancelled) return;
        setContacts(result.data?.contacts ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoadingContacts(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedClientId]);

  useEffect(() => {
    if (state.ok && state.activity) {
      router.push(redirectHref);
    }
    // Depends on the whole `state` object, not `state.ok` — this form isn't
    // reused across multiple opens the way a Dialog is, but the same
    // reasoning (`AssetFormDialog`'s doc comment) applies defensively.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const selectedType = activityTypes.find((item) => item.id === selectedTypeId);
  const typeValue = selectedType?.value;
  const assetRequired = typeValue === "storing" || typeValue === "onderhoud";
  const contactRequired = typeValue === "bel_activiteit";

  const typeOptions = useMemo(
    () =>
      activityTypes.map((item) => {
        const TypeIcon = resolveActivityTypeIcon(item.icon);
        return { value: item.id, label: item.label, icon: <TypeIcon /> };
      }),
    [activityTypes],
  );

  const assetOptions = useMemo(() => assets.map((asset) => ({ value: asset.id, label: asset.name })), [assets]);
  const contactOptions = useMemo(
    () => contacts.map((contact) => ({ value: contact.id, label: contact.name })),
    [contacts],
  );

  function handleClientChange(nextClientId: string) {
    setSelectedClientId(nextClientId);
    // A new client invalidates any previously selected asset/contact — same
    // "discard the now-stale child selection" reasoning as
    // `WorkOrderForm.handleClientChange`.
    setSelectedAssetId("");
    setSelectedContactPersonId("");
  }

  function handleContactChange(nextContactId: string) {
    setSelectedContactPersonId(nextContactId);
    if (!nextContactId) return;
    const contact = contacts.find((candidate) => candidate.id === nextContactId);
    if (!contact) return;
    // One-time copy into the override fields, per the migration's own design
    // note — never synced back to `contacts` afterward, and each field stays
    // independently editable from here on.
    setContactName(contact.name);
    setContactPhone(contact.phone ?? "");
    setContactEmail(contact.email ?? "");
  }

  const resolvedAsset: AssetRecord | null = isAssetLocked
    ? (lockedAsset ?? null)
    : (assets.find((asset) => asset.id === selectedAssetId) ?? null);
  const resolvedAssetSite = resolvedAsset ? (sites.find((site) => site.id === resolvedAsset.site_id) ?? null) : null;
  const resolvedAssetAddress = isAssetLocked ? (lockedAssetAddress ?? null) : formatSiteAddressShort(resolvedAssetSite);

  const defaultStatus = activityStatuses.find((item) => item.is_default);

  return (
    <Card>
      <form action={formAction}>
        <Stack gap="lg">
          {state.error && <Text tone="danger">{state.error}</Text>}

          <FormSection title="Type" description="What kind of melding is this?">
            <Stack gap="xs">
              <IconTileSelect
                options={typeOptions}
                value={selectedTypeId}
                onChange={setSelectedTypeId}
                name="typeId"
                aria-label="Activity type"
              />
              {state.fieldErrors?.typeId?.map((message) => (
                <Text key={message} tone="danger">
                  {message}
                </Text>
              ))}
            </Stack>
          </FormSection>

          <FormSection title="Client & asset" description="Who and what this melding is about.">
            <Stack gap="md">
              {isClientLocked ? (
                <Stack gap="xs">
                  <Label>Client</Label>
                  <Text>{lockedClient?.name ?? "—"}</Text>
                  {!isAssetLocked && <input type="hidden" name="clientId" value={selectedClientId} />}
                </Stack>
              ) : (
                <Stack gap="xs">
                  <Label htmlFor="activity-client">Client</Label>
                  <Select
                    id="activity-client"
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
                  {state.fieldErrors?.clientId?.map((message) => (
                    <Text key={message} tone="danger">
                      {message}
                    </Text>
                  ))}
                </Stack>
              )}

              {isAssetLocked ? (
                <Stack gap="xs">
                  <Label>Asset</Label>
                  <Text>{lockedAsset?.name ?? "—"}</Text>
                  <input type="hidden" name="assetId" value={lockedAsset?.id ?? ""} />
                </Stack>
              ) : (
                <Stack gap="xs">
                  <Label htmlFor="activity-asset">Asset{assetRequired ? " *" : ""}</Label>
                  <Combobox
                    id="activity-asset"
                    name="assetId"
                    options={assetOptions}
                    value={selectedAssetId}
                    onChange={setSelectedAssetId}
                    placeholder={!selectedClientId ? "Select a client first…" : "Search assets…"}
                    disabled={!selectedClientId || loadingAssets}
                    required={assetRequired}
                    clearable
                    emptyMessage="No assets for this client."
                  />
                  {assetRequired && <Text tone="muted">Required for Storing or Onderhoud activities.</Text>}
                  {state.fieldErrors?.assetId?.map((message) => (
                    <Text key={message} tone="danger">
                      {message}
                    </Text>
                  ))}
                </Stack>
              )}

              {resolvedAsset && (
                <DefinitionList
                  items={[
                    { label: "Type", value: resolvedAsset.asset_type?.label ?? "—" },
                    { label: "Sub-type", value: resolvedAsset.asset_subtype?.label ?? "—" },
                    { label: "Brand", value: resolvedAsset.asset_brand?.label ?? "—" },
                    { label: "Model", value: resolvedAsset.asset_model?.name ?? "—" },
                    { label: "Address", value: resolvedAssetAddress ?? "—" },
                  ]}
                />
              )}
            </Stack>
          </FormSection>

          <FormSection
            title="Contact"
            description={
              contactRequired
                ? "A contact person, or a name and phone number, is required for Bel activiteit."
                : "Who to contact about this melding, if anyone."
            }
          >
            <Stack gap="md">
              <Stack gap="xs">
                <Label htmlFor="activity-contact-person">Contact person</Label>
                <Combobox
                  id="activity-contact-person"
                  options={contactOptions}
                  value={selectedContactPersonId}
                  onChange={handleContactChange}
                  placeholder={!selectedClientId ? "Select a client first…" : "Search contacts…"}
                  disabled={!selectedClientId || loadingContacts}
                  clearable
                  emptyMessage="No contacts for this client."
                />
                <input type="hidden" name="contactPersonId" value={selectedContactPersonId} />
              </Stack>

              <FormGrid columns={2}>
                <Stack gap="xs">
                  <Label htmlFor="activity-contact-name">Name{contactRequired ? " *" : ""}</Label>
                  <Input
                    id="activity-contact-name"
                    name="contactName"
                    value={contactName}
                    onChange={(event) => setContactName(event.target.value)}
                    required={contactRequired && !selectedContactPersonId}
                    maxLength={200}
                  />
                  {state.fieldErrors?.contactName?.map((message) => (
                    <Text key={message} tone="danger">
                      {message}
                    </Text>
                  ))}
                </Stack>
                <Stack gap="xs">
                  <Label htmlFor="activity-contact-phone">Phone{contactRequired ? " *" : ""}</Label>
                  <Input
                    id="activity-contact-phone"
                    name="contactPhone"
                    value={contactPhone}
                    onChange={(event) => setContactPhone(event.target.value)}
                    required={contactRequired && !selectedContactPersonId}
                    maxLength={50}
                  />
                  {state.fieldErrors?.contactPhone?.map((message) => (
                    <Text key={message} tone="danger">
                      {message}
                    </Text>
                  ))}
                </Stack>
              </FormGrid>

              <Stack gap="xs">
                <Label htmlFor="activity-contact-email">Email</Label>
                <Input
                  id="activity-contact-email"
                  name="contactEmail"
                  type="email"
                  value={contactEmail}
                  onChange={(event) => setContactEmail(event.target.value)}
                  maxLength={320}
                />
                {state.fieldErrors?.contactEmail?.map((message) => (
                  <Text key={message} tone="danger">
                    {message}
                  </Text>
                ))}
              </Stack>
            </Stack>
          </FormSection>

          <FormSection title="Description">
            <Stack gap="xs">
              <Label htmlFor="activity-description">Description</Label>
              <Textarea
                id="activity-description"
                name="description"
                defaultValue={activity?.description ?? ""}
                required
                rows={4}
              />
              {state.fieldErrors?.description?.map((message) => (
                <Text key={message} tone="danger">
                  {message}
                </Text>
              ))}
            </Stack>
          </FormSection>

          <FormSection title="Assignment & status">
            <Stack gap="md">
              <FormGrid columns={2}>
                <Stack gap="xs">
                  <Label htmlFor="activity-action-holder">Action holder</Label>
                  <Select
                    id="activity-action-holder"
                    value={selectedActionHolderId}
                    onChange={(event) => setSelectedActionHolderId(event.target.value)}
                    required
                    disabled={!canAssignOthers}
                  >
                    <option value="" disabled>
                      Select a member…
                    </option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {memberDisplayName(member)}
                      </option>
                    ))}
                  </Select>
                  {/* Real submitted value, independent of the `<select>`'s own
                      `name` — a `disabled` control is excluded from
                      `FormData` entirely, which would otherwise silently drop
                      `actionHolderId` for a caller who can't assign others. */}
                  <input type="hidden" name="actionHolderId" value={selectedActionHolderId} />
                  {!canAssignOthers && <Text tone="muted">Always assigned to you.</Text>}
                  {state.fieldErrors?.actionHolderId?.map((message) => (
                    <Text key={message} tone="danger">
                      {message}
                    </Text>
                  ))}
                </Stack>

                <Stack gap="xs">
                  <Label htmlFor="activity-status">Status</Label>
                  <Select
                    id="activity-status"
                    name="statusId"
                    value={selectedStatusId}
                    onChange={(event) => setSelectedStatusId(event.target.value)}
                  >
                    <option value="">{defaultStatus ? `Use default (${defaultStatus.label})` : "Use organization default"}</option>
                    {activityStatuses.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                  {state.fieldErrors?.statusId?.map((message) => (
                    <Text key={message} tone="danger">
                      {message}
                    </Text>
                  ))}
                </Stack>
              </FormGrid>

              {mode === "edit" && activity && (
                <DefinitionList
                  items={[
                    { label: "Reported at", value: formatDateTime(activity.reported_at) },
                    { label: "Reported by", value: memberDisplayName(activity.reporter) },
                  ]}
                />
              )}
            </Stack>
          </FormSection>

          <div>
            <Button type="button" variant="outline" onClick={() => router.push(redirectHref)}>
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
      {pending ? "Saving…" : mode === "create" ? "Add activity" : "Save changes"}
    </Button>
  );
}
