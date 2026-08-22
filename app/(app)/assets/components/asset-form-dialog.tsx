"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Button,
  Dialog,
  Heading,
  IconButton,
  Input,
  Label,
  Select,
  Stack,
  Text,
  Textarea,
} from "@yourorg/ui";
import type { AssetRecord } from "../actions";
import { createAssetFormAction, updateAssetFormAction, type AssetFormState } from "../asset-form-actions";
import { listSites, type ClientRecord, type SiteRecord } from "@/app/(app)/clients/actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";

const initialState: AssetFormState = { ok: false };

export interface AssetFormDialogProps {
  mode: "create" | "edit";
  /** Required for `mode: "edit"`. */
  asset?: AssetRecord;
  /** Org's clients, for the client -> site cascading picker. Ignored (and
   * the picker hidden entirely) when `lockedClientId` is set. */
  clients: ClientRecord[];
  /**
   * Pre-scopes the site picker to a single client's sites and hides the
   * client selector entirely — used when this dialog is opened from a
   * client-scoped context (the Clients detail page's Assets tab), where the
   * client is already implied by the page and re-picking it makes no sense.
   */
  lockedClientId?: string;
  /** This org's `asset_type` picklist values (`lib/reference-lists/actions.ts`
   * `listReferenceItems("asset_type")`), fetched by the caller — every entry
   * point that can open this dialog fetches it once and passes it down
   * rather than this dialog re-fetching per-open. */
  assetTypes: ReferenceListItemRecord[];
  /** This org's `asset_status` picklist values. */
  assetStatuses: ReferenceListItemRecord[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Create/edit dialog, `useActionState` pattern (see
 * `app/(auth)/login/login-form.tsx`). `createAsset`/`updateAsset` (in
 * `../actions.ts`) take a parsed object, not `FormData`, so this wires
 * through the small adapters in `../asset-form-actions.ts`.
 *
 * Type/Status are tenant-configurable picklists (`reference_list_items`, see
 * docs/ARCHITECTURE.md "Tenant-configurable reference data") — both
 * `<Select>`s below are populated from `assetTypes`/`assetStatuses`, never
 * hardcoded options, and submit the picklist item's `id` (`typeId`/
 * `statusId`), not its label/value.
 *
 * The client picker here (when not `lockedClientId`-scoped) is a plain,
 * un-submitted `<select>` used only to drive which sites are offered — the
 * real submitted field is `siteId` (what `createAsset`/`updateAsset`
 * actually need), fetched via `listSites(clientId)` from
 * `app/(app)/clients/actions.ts` whenever the selected client changes.
 */
export function AssetFormDialog({
  mode,
  asset,
  clients,
  lockedClientId,
  assetTypes,
  assetStatuses,
  open,
  onOpenChange,
}: AssetFormDialogProps) {
  const router = useRouter();
  const action = mode === "edit" && asset ? updateAssetFormAction.bind(null, asset.id) : createAssetFormAction;
  const [state, formAction] = useActionState(action, initialState);

  const [selectedClientId, setSelectedClientId] = useState(
    lockedClientId ?? asset?.client_id ?? "",
  );
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [loadingSites, setLoadingSites] = useState(false);

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
    if (state.ok) {
      onOpenChange(false);
      router.refresh();
    }
    // Only re-run when the action result actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok]);

  const defaultStatus = assetStatuses.find((item) => item.is_default);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg">
      <form action={formAction}>
        <Dialog.Header>
          <Stack gap="xs">
            <Heading level={3}>{mode === "create" ? "Add asset" : "Edit asset"}</Heading>
          </Stack>
          <IconButton aria-label="Close dialog" variant="ghost" onClick={() => onOpenChange(false)}>
            ×
          </IconButton>
        </Dialog.Header>

        <Dialog.Body>
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
                defaultValue={asset?.site_id ?? ""}
                required
                disabled={!selectedClientId || loadingSites}
              >
                <option value="" disabled>
                  {loadingSites ? "Loading sites…" : "Select a site…"}
                </option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </Select>
              {state.fieldErrors?.siteId && <Text tone="danger">{state.fieldErrors.siteId[0]}</Text>}
              {selectedClientId && !loadingSites && sites.length === 0 && (
                <Text tone="muted">
                  This client has no sites yet — add one from the Clients module first.
                </Text>
              )}
            </Stack>

            <Stack gap="sm">
              <Label htmlFor="asset-name">Name</Label>
              <Input id="asset-name" name="name" defaultValue={asset?.name} required maxLength={200} />
              {state.fieldErrors?.name && <Text tone="danger">{state.fieldErrors.name[0]}</Text>}
            </Stack>

            <Stack gap="sm">
              <Label htmlFor="asset-type">Type</Label>
              <Select id="asset-type" name="typeId" defaultValue={asset?.type_id ?? ""} required>
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
                <Text tone="muted">
                  No asset types configured yet — add one from Settings first.
                </Text>
              )}
            </Stack>

            <Stack gap="sm">
              <Label htmlFor="asset-manufacturer">Manufacturer</Label>
              <Input
                id="asset-manufacturer"
                name="manufacturer"
                defaultValue={asset?.manufacturer ?? ""}
                maxLength={200}
              />
            </Stack>

            <Stack gap="sm">
              <Label htmlFor="asset-model">Model</Label>
              <Input id="asset-model" name="model" defaultValue={asset?.model ?? ""} maxLength={200} />
            </Stack>

            <Stack gap="sm">
              <Label htmlFor="asset-serial">Serial number</Label>
              <Input
                id="asset-serial"
                name="serialNumber"
                defaultValue={asset?.serial_number ?? ""}
                maxLength={200}
              />
            </Stack>

            <Stack gap="sm">
              <Label htmlFor="asset-status">Status</Label>
              <Select id="asset-status" name="statusId" defaultValue={asset?.status_id ?? ""}>
                <option value="">
                  {defaultStatus ? `Use default (${defaultStatus.label})` : "Use organization default"}
                </option>
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
              <Input
                id="asset-installed"
                name="installedAt"
                type="date"
                defaultValue={asset?.installed_at ?? ""}
              />
              {state.fieldErrors?.installedAt && (
                <Text tone="danger">{state.fieldErrors.installedAt[0]}</Text>
              )}
            </Stack>

            <Stack gap="sm">
              <Label htmlFor="asset-warranty">Warranty until</Label>
              <Input
                id="asset-warranty"
                name="warrantyUntil"
                type="date"
                defaultValue={asset?.warranty_until ?? ""}
              />
              {state.fieldErrors?.warrantyUntil && (
                <Text tone="danger">{state.fieldErrors.warrantyUntil[0]}</Text>
              )}
            </Stack>

            <Stack gap="sm">
              <Label htmlFor="asset-notes">Notes</Label>
              <Textarea id="asset-notes" name="notes" defaultValue={asset?.notes ?? ""} rows={3} />
            </Stack>
          </Stack>
        </Dialog.Body>

        <Dialog.Footer>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <SubmitButton mode={mode} />
        </Dialog.Footer>
      </form>
    </Dialog>
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
