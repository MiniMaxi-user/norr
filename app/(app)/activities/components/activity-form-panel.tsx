"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Button,
  Combobox,
  DefinitionList,
  Dialog,
  FormGrid,
  FormSection,
  Heading,
  IconTileSelect,
  Input,
  Label,
  Select,
  Stack,
  Text,
  Textarea,
  useEscapeToClose,
} from "@yourorg/ui";
import { Bell, ClipboardList, FileText, Phone, UserRound } from "@yourorg/ui/icons";
import { getActivityFormContext, type ActivityRecord } from "../actions";
import { createActivityFormAction, updateActivityFormAction, type ActivityFormState } from "../activity-form-actions";
import { resolveActivityTypeIcon } from "../icon-map";
import { getAsset, listAssets, type AssetRecord } from "@/app/(app)/assets/actions";
import { getClient, listClients, listSites, type ClientRecord, type SiteRecord } from "@/app/(app)/clients/actions";
import { listContacts, type ContactRecord } from "@/app/(app)/clients/contacts-actions";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";
import { listOrgMembers, type OrgMemberRecord } from "@/lib/members/actions";
import { memberDisplayName } from "@/lib/members/format";
import { listReferenceItems, type ReferenceListItemRecord } from "@/lib/reference-lists/actions";

const initialState: ActivityFormState = { ok: false };

/** High enough for "every asset/contact across this client" in one request —
 * same bounded, per-record-scope reasoning as `WorkOrderForm`'s own
 * `ALL_CLIENT_ASSETS_LIMIT`. */
const ALL_CLIENT_LIMIT = 500;

export interface ActivityFormPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  /** Required for `mode: "edit"` — already has every embed the form needs
   * (client/asset/contact names, action holder, reporter), the same
   * `ACTIVITY_SELECT` shape `listActivities` and `getActivity` both return,
   * so a row a caller already has on screen (`ActivitiesTable`,
   * `ActivityQuickViewDialog`) can be passed straight through with no extra
   * fetch. */
  activity?: ActivityRecord;
  /** `mode: "create"` only — pre-scopes to a client (locks the client picker
   * to a read-only label), mirroring the old `/activities/new?clientId=...`
   * query param. */
  lockedClientId?: string;
  /** `mode: "create"` only — pre-scopes to an asset (locks BOTH the client
   * and the asset; the client is resolved from the asset's own `client_id`,
   * never a separately supplied id — an asset's client is always the source
   * of truth, matching `resolveActivityClientId` in `../actions.ts`),
   * mirroring the old `/activities/new?assetId=...` query param. */
  lockedAssetId?: string;
}

/**
 * Create/edit slide-in panel for an activity ("Edit activity pagina, maar
 * ook de new activity pagina is niet lekker ingedeeld... gebruik hier maar
 * slider popup voor" — 2026-08-28 feedback). Replaces the old full-page
 * `/activities/new` and `/activities/[id]/edit` routes (both deleted in the
 * same change) — this is Activities' own version of the same "Popup vs. full
 * page" override Clients (issue #43/#46) and Assets (issue #53) already got;
 * see `docs/ARCHITECTURE.md`'s note on that section for why a form this
 * shape (record-editing, not a hierarchy-defining primary page) is a
 * reasonable carve-out for any module, not just those two.
 *
 * Self-fetches every reference-data list it needs (clients, activity
 * types/statuses, org members, the locked client/asset, and the caller's own
 * actor context) on open, the same way `AssetFormDialog` does — every call
 * site (`CreateActivityButton`, `ActivitiesTable`'s row Edit,
 * `ActivityQuickViewDialog`'s Edit) stays a thin trigger with local `open`
 * state, no page-level prop-threading of picklists required.
 *
 * Split into this outer component (owns `useActionState`, so a failed
 * submit's error/fieldErrors survive whatever else re-renders) and
 * `ActivityFormBody` below (owns every other piece of local state — selected
 * client/asset/contact/type, fetched options — which lives INSIDE
 * `<Dialog>`'s children and therefore gets a guaranteed-fresh remount every
 * time the panel opens, since `Dialog` returns `null` while `open` is
 * false). Same split `AssetFormDialog`/`AssetFormBody` use, for the same
 * reason (see that file's own doc comment).
 *
 * No post-success navigation, unlike the old full pages' `redirectHref` —
 * closes and calls `router.refresh()` so whichever Server Component list is
 * already on screen (the Activities overview, a client's Activiteiten tab,
 * ...) picks up the change immediately, same as `AssetFormDialog`/
 * `EditClientPanel`'s own post-success flow. There's no separate Activities
 * detail page to navigate to the way `NewClientPanel` navigates to
 * `/clients/[id]` — the caller is already wherever this activity belongs.
 */
export function ActivityFormPanel({ open, onOpenChange, mode, activity, lockedClientId, lockedAssetId }: ActivityFormPanelProps) {
  const router = useRouter();
  useEscapeToClose(open, onOpenChange);

  const action =
    mode === "edit" && activity ? updateActivityFormAction.bind(null, activity.id) : createActivityFormAction;
  const [state, formAction] = useActionState(action, initialState);

  useEffect(() => {
    if (state.ok) {
      onOpenChange(false);
      router.refresh();
    }
    // Depends on the whole `state` object, not `state.ok` — this panel
    // instance is reused across multiple opens (different rows, or create
    // then create again), same reasoning as `AssetFormDialog`'s identical
    // fix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="panel">
      <Dialog.Header>
        <Heading level={3}>{mode === "edit" ? "Edit activity" : "New activity"}</Heading>
      </Dialog.Header>
      <ActivityFormBody
        mode={mode}
        activity={activity}
        lockedClientId={lockedClientId}
        lockedAssetId={lockedAssetId}
        formAction={formAction}
        state={state}
        onCancel={() => onOpenChange(false)}
      />
    </Dialog>
  );
}

function SubmitButton({ mode, disabled }: { mode: "create" | "edit"; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending || disabled}>
      {pending ? "Saving…" : mode === "create" ? "Add activity" : "Save changes"}
    </Button>
  );
}

interface ActivityFormBodyProps {
  mode: "create" | "edit";
  activity?: ActivityRecord;
  lockedClientId?: string;
  lockedAssetId?: string;
  formAction: (formData: FormData) => void;
  state: ActivityFormState;
  onCancel: () => void;
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
 * The actual `<form>` — lives inside `<Dialog>`'s children (see
 * `ActivityFormPanel`'s doc comment above), so its `useState`s and the
 * fetch-on-mount effect below are guaranteed fresh every time the panel
 * opens.
 *
 * Layout is deliberately denser than the old full-page form ("wil eigenlijk
 * niet scrollen" — 2026-08-28 feedback): the 640px panel is wider than that
 * page's own content column, so Client/Asset and Name/Phone/Email now sit in
 * `FormGrid` rows instead of stacking full-width — same "group related
 * fields, 2/3-column where the panel is wide enough" convention
 * `site-form-dialog.tsx`/`AssetFormDialog` already use. Same field set for
 * every activity type (per the acceptance criteria), with conditional
 * required-ness driven by the currently-selected type's stable `value` slug
 * (never its label, which is tenant-editable): Asset for storing/onderhoud,
 * a contact person or name+phone for bel_activiteit — mirrors `../actions.ts`'s
 * own `createActivity` server-side check, but is purely a client-side UX
 * nicety, the server (and ultimately `validate_activity_relations`) is
 * always the real backstop.
 */
function ActivityFormBody({ mode, activity, lockedClientId, lockedAssetId, formAction, state, onCancel }: ActivityFormBodyProps) {
  const isAssetLocked = mode === "create" && Boolean(lockedAssetId);
  const isClientLocked = mode === "create" && (Boolean(lockedClientId) || isAssetLocked);

  const [currentUserId, setCurrentUserId] = useState("");
  const [canAssignOthers, setCanAssignOthers] = useState(false);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [activityTypes, setActivityTypes] = useState<ReferenceListItemRecord[]>([]);
  const [activityStatuses, setActivityStatuses] = useState<ReferenceListItemRecord[]>([]);
  const [members, setMembers] = useState<OrgMemberRecord[]>([]);
  const [lockedClient, setLockedClient] = useState<ClientRecord | null>(null);
  const [lockedAsset, setLockedAsset] = useState<AssetRecord | null>(null);
  const [lockedAssetAddress, setLockedAssetAddress] = useState<string | null>(null);
  const [loadingContext, setLoadingContext] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoadingContext(true);
    Promise.all([
      getActivityFormContext(),
      isClientLocked ? Promise.resolve(null) : listClients({ limit: 200 }),
      listReferenceItems("activity_type"),
      listReferenceItems("activity_status"),
      listOrgMembers(),
      isAssetLocked ? getAsset(lockedAssetId as string) : Promise.resolve(null),
      mode === "create" && !isAssetLocked && lockedClientId ? getClient(lockedClientId) : Promise.resolve(null),
    ])
      .then(async ([contextResult, clientsResult, typesResult, statusesResult, membersResult, assetResult, clientByIdResult]) => {
        if (cancelled) return;
        setCurrentUserId(contextResult.data?.currentUserId ?? "");
        setCanAssignOthers(contextResult.data?.canAssignOthers ?? false);
        setClients(clientsResult?.data?.clients ?? []);
        setActivityTypes(typesResult.data?.items ?? []);
        setActivityStatuses(statusesResult.data?.items ?? []);
        setMembers(membersResult.data?.members ?? []);

        const asset = assetResult?.data?.asset ?? null;
        if (asset) {
          setLockedAsset(asset);
          const assetClientResult = await getClient(asset.client_id);
          if (cancelled) return;
          setLockedClient(assetClientResult.data?.client ?? null);
          const site = assetClientResult.data?.sites.find((candidate) => candidate.id === asset.site_id) ?? null;
          setLockedAssetAddress(formatSiteAddressShort(site));
        } else {
          setLockedClient(clientByIdResult?.data?.client ?? null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingContext(false);
      });
    return () => {
      cancelled = true;
    };
    // Runs once on mount only — this component remounts fresh every panel
    // open (see `ActivityFormPanel`'s doc comment), so there's no case where
    // `lockedClientId`/`lockedAssetId`/`mode` change under an
    // already-mounted instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [selectedClientId, setSelectedClientId] = useState(
    isAssetLocked ? "" : (lockedClientId ?? activity?.client_id ?? ""),
  );
  // `isAssetLocked`'s own client id isn't known synchronously (it's resolved
  // via `getAsset` above) — pick it up once `lockedAsset` loads.
  useEffect(() => {
    if (isAssetLocked && lockedAsset) setSelectedClientId(lockedAsset.client_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedAsset]);

  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState(
    isAssetLocked ? (lockedAssetId as string) : (activity?.asset_id ?? ""),
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
  const [selectedActionHolderId, setSelectedActionHolderId] = useState(activity?.action_holder_id ?? "");

  // `canAssignOthers`/`currentUserId` only resolve once the context fetch
  // above finishes — pin "Action holder" the moment that lands for a caller
  // who can't assign others (create mode with nothing selected yet; edit
  // mode leaves the activity's existing assignment alone).
  useEffect(() => {
    if (!canAssignOthers && currentUserId && !activity) setSelectedActionHolderId(currentUserId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAssignOthers, currentUserId]);

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
    ? lockedAsset
    : (assets.find((asset) => asset.id === selectedAssetId) ?? null);
  const resolvedAssetSite = resolvedAsset ? (sites.find((site) => site.id === resolvedAsset.site_id) ?? null) : null;
  const resolvedAssetAddress = isAssetLocked ? lockedAssetAddress : formatSiteAddressShort(resolvedAssetSite);

  const defaultStatus = activityStatuses.find((item) => item.is_default);

  return (
    <form action={formAction}>
      <Dialog.Body>
        <Stack gap="md">
          {state.error && <Text tone="danger">{state.error}</Text>}

          <FormSection title="Type" description="What kind of melding is this?" icon={<Bell />}>
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

          <FormSection title="Client & asset" icon={<ClipboardList />}>
            <Stack gap="sm">
              <FormGrid columns={2}>
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
                      disabled={loadingContext}
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
                    <input type="hidden" name="assetId" value={lockedAssetId ?? ""} />
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
                    {state.fieldErrors?.assetId?.map((message) => (
                      <Text key={message} tone="danger">
                        {message}
                      </Text>
                    ))}
                  </Stack>
                )}
              </FormGrid>
              {assetRequired && !isAssetLocked && <Text tone="muted">Asset is required for Storing or Onderhoud activities.</Text>}

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
            icon={<Phone />}
          >
            <Stack gap="sm">
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

              <FormGrid columns={3}>
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
              </FormGrid>
            </Stack>
          </FormSection>

          <FormSection title="Description" icon={<FileText />}>
            <Stack gap="xs">
              <Label htmlFor="activity-description">Description</Label>
              <Textarea
                id="activity-description"
                name="description"
                defaultValue={activity?.description ?? ""}
                required
                rows={3}
              />
              {state.fieldErrors?.description?.map((message) => (
                <Text key={message} tone="danger">
                  {message}
                </Text>
              ))}
            </Stack>
          </FormSection>

          <FormSection title="Assignment & status" icon={<UserRound />}>
            <Stack gap="sm">
              <FormGrid columns={2}>
                <Stack gap="xs">
                  <Label htmlFor="activity-action-holder">Action holder</Label>
                  <Select
                    id="activity-action-holder"
                    value={selectedActionHolderId}
                    onChange={(event) => setSelectedActionHolderId(event.target.value)}
                    required
                    disabled={!canAssignOthers || loadingContext}
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
                    disabled={loadingContext}
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
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <SubmitButton mode={mode} disabled={loadingContext} />
      </Dialog.Footer>
    </form>
  );
}
