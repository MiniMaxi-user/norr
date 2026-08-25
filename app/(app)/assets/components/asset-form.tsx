"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Button, Card, CascadingSelect, Input, Label, Select, Stack, Text, Textarea } from "@yourorg/ui";
import type { AssetRecord } from "../actions";
import { createAssetFormAction, updateAssetFormAction, type AssetFormState } from "../asset-form-actions";
import { listSites, type ClientRecord, type SiteRecord } from "@/app/(app)/clients/actions";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";

const initialState: AssetFormState = { ok: false };

export interface AssetFormProps {
  mode: "create" | "edit";
  /** Required for `mode: "edit"`. */
  asset?: AssetRecord;
  /** Org's clients, for the client -> site cascading picker. Ignored (and
   * the picker hidden entirely) when `lockedClientId` is set. */
  clients: ClientRecord[];
  /**
   * Pre-scopes the site picker to a single client's sites and hides the
   * client selector entirely — used when this form is opened in a
   * client-scoped context (the Clients detail page's Assets tab, via
   * `/assets/new?clientId=...`), where the client is already implied and
   * re-picking it makes no sense.
   */
  lockedClientId?: string;
  /** Pre-selects (but doesn't lock) the site — e.g. `/assets/new?siteId=...`
   * from a specific site's context. The user can still change it to any
   * other site of the same (locked or picked) client. */
  initialSiteId?: string;
  /** This org's `asset_type` picklist values (`lib/reference-lists/actions.ts`
   * `listReferenceItems("asset_type")`), fetched by the caller — every entry
   * point that can render this form fetches it once and passes it down. */
  assetTypes: ReferenceListItemRecord[];
  /** This org's `asset_status` picklist values. */
  assetStatuses: ReferenceListItemRecord[];
  /** This org's `asset_subtype` picklist values — a *dependent* list
   * (`parent_list_key = "asset_type"`, each item's `parent_item_id` points at
   * the `asset_type` item it belongs under). Passed down unfiltered; the
   * Sub-type `<CascadingSelect>` below does its own filtering against the
   * currently selected Type. */
  assetSubtypes: ReferenceListItemRecord[];
  /** Where "Cancel" navigates to. */
  cancelHref: string;
}

/**
 * Create/edit form for an asset, rendered as a real page (`/assets/new`,
 * `/assets/[id]/edit`) rather than a `Dialog` — see docs/ARCHITECTURE.md
 * "Popup vs. full page — pick by weight, not habit". All fields (including
 * the Type -> Sub-type cascading select and the client -> site dependent
 * picker) are carried over unchanged from the old `asset-form-dialog.tsx`;
 * only the container changed, and success now navigates to the asset's
 * detail page instead of closing an overlay.
 *
 * Type/Status/Sub-type are tenant-configurable picklists (`reference_list_items`,
 * see docs/ARCHITECTURE.md "Tenant-configurable reference data" /
 * "Domain completeness") — never hardcoded options.
 */
export function AssetForm({
  mode,
  asset,
  clients,
  lockedClientId,
  initialSiteId,
  assetTypes,
  assetStatuses,
  assetSubtypes,
  cancelHref,
}: AssetFormProps) {
  const router = useRouter();
  const action = mode === "edit" && asset ? updateAssetFormAction.bind(null, asset.id) : createAssetFormAction;
  const [state, formAction] = useActionState(action, initialState);

  const [selectedClientId, setSelectedClientId] = useState(lockedClientId ?? asset?.client_id ?? "");
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [loadingSites, setLoadingSites] = useState(false);
  // Controlled (not just `defaultValue`, unlike most fields in this form)
  // because the Sub-type `<CascadingSelect>` below needs to know the
  // currently selected Type on every render to filter/disable itself — see
  // the "Domain completeness" cascading-select pattern in
  // `packages/ui/src/components/cascading-select.tsx`.
  const [selectedTypeId, setSelectedTypeId] = useState(asset?.type_id ?? "");

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
    if (state.ok && state.asset) {
      router.push(`/assets/${state.asset.id}`);
    }
    // Only re-run when the action result actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok, state.asset]);

  const defaultStatus = assetStatuses.find((item) => item.is_default);
  const defaultSiteId = asset?.site_id ?? initialSiteId ?? "";

  return (
    <Card>
      <form action={formAction}>
        <Stack gap="md">
          {state.error && <Text tone="danger">{state.error}</Text>}

          {!lockedClientId && (
            <Stack gap="sm">
              <Label htmlFor="asset-client">Client</Label>
              <Select
                id="asset-client"
                value={selectedClientId}
                onChange={(event) => setSelectedClientId(event.target.value)}
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
            </Stack>
          )}

          <Stack gap="sm">
            <Label htmlFor="asset-site">Site</Label>
            <Select
              id="asset-site"
              name="siteId"
              key={selectedClientId}
              defaultValue={defaultSiteId}
              required
              disabled={!selectedClientId || loadingSites}
            >
              <option value="" disabled>
                {loadingSites ? "Loading sites…" : "Select a site…"}
              </option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {formatSiteAddressShort(site) ?? "Unnamed site"}
                </option>
              ))}
            </Select>
            {state.fieldErrors?.siteId && <Text tone="danger">{state.fieldErrors.siteId[0]}</Text>}
            {selectedClientId && !loadingSites && sites.length === 0 && (
              <Text tone="muted">This client has no sites yet — add one from the Clients module first.</Text>
            )}
          </Stack>

          <Stack gap="sm">
            <Label htmlFor="asset-name">Name</Label>
            <Input id="asset-name" name="name" defaultValue={asset?.name} required maxLength={200} />
            {state.fieldErrors?.name && <Text tone="danger">{state.fieldErrors.name[0]}</Text>}
          </Stack>

          <Stack gap="sm">
            <Label htmlFor="asset-type">Type</Label>
            <Select
              id="asset-type"
              name="typeId"
              value={selectedTypeId}
              onChange={(event) => setSelectedTypeId(event.target.value)}
              required
            >
              <option value="" disabled>
                Select a type…
              </option>
              {assetTypes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
            {state.fieldErrors?.typeId && <Text tone="danger">{state.fieldErrors.typeId[0]}</Text>}
            {assetTypes.length === 0 && (
              <Text tone="muted">No asset types configured yet — add one from Settings first.</Text>
            )}
          </Stack>

          <Stack gap="sm">
            <Label htmlFor="asset-subtype">Sub-type</Label>
            {/* Remounted (via `key`) whenever the selected Type changes, so
                its uncontrolled `defaultValue` resets to whichever option
                matches the new Type (or the placeholder, if none does) —
                same trick the Site select above uses for its Client
                dependency, see the comment on `CascadingSelect`. */}
            <CascadingSelect
              id="asset-subtype"
              name="subtypeId"
              key={selectedTypeId}
              defaultValue={asset?.type_id === selectedTypeId ? asset?.subtype_id ?? "" : ""}
              parentValue={selectedTypeId}
              options={assetSubtypes.map((item) => ({
                id: item.id,
                label: item.label,
                parentId: item.parent_item_id ?? "",
              }))}
              placeholder="No sub-type"
              emptyParentPlaceholder="Select a type first…"
            />
            {state.fieldErrors?.subtypeId && <Text tone="danger">{state.fieldErrors.subtypeId[0]}</Text>}
          </Stack>

          <Stack gap="sm">
            <Label htmlFor="asset-manufacturer">Manufacturer</Label>
            <Input id="asset-manufacturer" name="manufacturer" defaultValue={asset?.manufacturer ?? ""} maxLength={200} />
          </Stack>

          <Stack gap="sm">
            <Label htmlFor="asset-model">Model</Label>
            <Input id="asset-model" name="model" defaultValue={asset?.model ?? ""} maxLength={200} />
          </Stack>

          <Stack gap="sm">
            <Label htmlFor="asset-serial">Serial number</Label>
            <Input id="asset-serial" name="serialNumber" defaultValue={asset?.serial_number ?? ""} maxLength={200} />
          </Stack>

          <Stack gap="sm">
            <Label htmlFor="asset-status">Status</Label>
            <Select id="asset-status" name="statusId" defaultValue={asset?.status_id ?? ""}>
              <option value="">{defaultStatus ? `Use default (${defaultStatus.label})` : "Use organization default"}</option>
              {assetStatuses.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
            {state.fieldErrors?.statusId && <Text tone="danger">{state.fieldErrors.statusId[0]}</Text>}
          </Stack>

          <Stack gap="sm">
            <Label htmlFor="asset-installed">Installed on</Label>
            <Input id="asset-installed" name="installedAt" type="date" defaultValue={asset?.installed_at ?? ""} />
            {state.fieldErrors?.installedAt && <Text tone="danger">{state.fieldErrors.installedAt[0]}</Text>}
          </Stack>

          <Stack gap="sm">
            <Label htmlFor="asset-warranty">Warranty until</Label>
            <Input id="asset-warranty" name="warrantyUntil" type="date" defaultValue={asset?.warranty_until ?? ""} />
            {state.fieldErrors?.warrantyUntil && <Text tone="danger">{state.fieldErrors.warrantyUntil[0]}</Text>}
          </Stack>

          <Stack gap="sm">
            <Label htmlFor="asset-notes">Notes</Label>
            <Textarea id="asset-notes" name="notes" defaultValue={asset?.notes ?? ""} rows={3} />
          </Stack>

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
      {pending ? "Saving…" : mode === "create" ? "Add asset" : "Save changes"}
    </Button>
  );
}
