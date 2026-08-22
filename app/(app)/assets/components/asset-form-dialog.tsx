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

const initialState: AssetFormState = { ok: false };

export interface AssetFormDialogProps {
  mode: "create" | "edit";
  /** Required for `mode: "edit"`. */
  asset?: AssetRecord;
  /** Org's clients, for the client -> site cascading picker. Fetched by the
   * caller (list screen already needs it for the filter bar; the detail
   * page fetches it once for this dialog). */
  clients: ClientRecord[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Create/edit dialog, `useActionState` pattern (see
 * `app/(auth)/login/login-form.tsx`). `createAsset`/`updateAsset` (in
 * `../actions.ts`) take a parsed object, not `FormData`, so this wires
 * through the small adapters in `../asset-form-actions.ts`.
 *
 * The client picker here is a plain, un-submitted `<select>` used only to
 * drive which sites are offered — the real submitted field is `siteId`
 * (what `createAsset`/`updateAsset` actually need), fetched via
 * `listSites(clientId)` from `app/(app)/clients/actions.ts` whenever the
 * selected client changes.
 */
export function AssetFormDialog({ mode, asset, clients, open, onOpenChange }: AssetFormDialogProps) {
  const router = useRouter();
  const action = mode === "edit" && asset ? updateAssetFormAction.bind(null, asset.id) : createAssetFormAction;
  const [state, formAction] = useActionState(action, initialState);

  const [selectedClientId, setSelectedClientId] = useState(asset?.client_id ?? "");
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
              <Input
                id="asset-type"
                name="type"
                defaultValue={asset?.type}
                required
                maxLength={100}
                placeholder="e.g. HVAC unit, generator, pump"
              />
              {state.fieldErrors?.type && <Text tone="danger">{state.fieldErrors.type[0]}</Text>}
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
              <Select id="asset-status" name="status" defaultValue={asset?.status ?? "active"}>
                <option value="active">Active</option>
                <option value="decommissioned">Decommissioned</option>
              </Select>
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
