"use client";

import { useMemo, useState } from "react";
import { Button, Combobox, Dialog, FormGrid, Label, Select, Stack, Text } from "@yourorg/ui";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import type { ClientRecord } from "@/app/(app)/clients/actions";
import type { ContactRecord } from "@/app/(app)/clients/contacts-actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { ActivityDraft } from "./activity-draft";

export interface ActivityRelationsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: ActivityDraft;
  clients: ClientRecord[];
  /** Only used to resolve `draft.typeId`'s stable `value` slug, to keep
   * enforcing the type-dependent asset/contact requiredness hints below —
   * Type itself is no longer editable from this dialog, see the doc comment
   * further down. */
  activityTypes: ReferenceListItemRecord[];
  /** Pre-scopes (and hides the picker for) a single client — `mode: "create"`
   * only, never set in edit mode. */
  lockedClientId?: string;
  /** Pre-scopes (and hides the picker for) a single asset, which also implies
   * (and further hides) the client — `mode: "create"` only. */
  lockedAssetId?: string;
  clientScoped: {
    assets: AssetRecord[];
    contacts: ContactRecord[];
    loadingAssets: boolean;
    loadingContacts: boolean;
  };
  /** Re-fetches `clientScoped` for the newly-picked client — see
   * `ActivityScreen`'s own `scopingClientId` state. */
  onClientChange: (clientId: string) => void;
  onSave: (
    patch: Pick<ActivityDraft, "clientId" | "assetId" | "contactPersonId" | "contactName" | "contactPhone" | "contactEmail">,
  ) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * Small popup behind every Client/Asset/Contact-person `RelationCard`'s own
 * Edit button — NARROWED by the issue #118 redesign to only these three
 * relations. Type used to live in this same dialog but now has its own
 * always-visible "Type" section (`ActivityTypeSection`, an `IconTileSelect`
 * that saves immediately on tile click, no dialog) — and the Name/Phone/
 * Email contact override fields now live in their own always-visible
 * "Contact person" section (`ActivityContactSection`), directly inline. This
 * dialog still reads `draft.typeId` (via `activityTypes`) to keep showing
 * the "Asset is required for…" hint and mark the Asset field required, even
 * though Type isn't editable here anymore — `validate_activity_relations`
 * enforces that constraint regardless of which section last touched these
 * fields, so the hint has to stay accurate here too.
 */
export function ActivityRelationsDialog({
  open,
  onOpenChange,
  draft,
  clients,
  activityTypes,
  lockedClientId,
  lockedAssetId,
  clientScoped,
  onClientChange,
  onSave,
}: ActivityRelationsDialogProps) {
  const isAssetLocked = Boolean(lockedAssetId);
  const isClientLocked = Boolean(lockedClientId) || isAssetLocked;

  const [clientId, setClientId] = useState(draft.clientId);
  const [assetId, setAssetId] = useState(draft.assetId);
  const [contactPersonId, setContactPersonId] = useState(draft.contactPersonId);
  const [contactName, setContactName] = useState(draft.contactName);
  const [contactPhone, setContactPhone] = useState(draft.contactPhone);
  const [contactEmail, setContactEmail] = useState(draft.contactEmail);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedType = activityTypes.find((item) => item.id === draft.typeId);
  const typeValue = selectedType?.value;
  const assetRequired = typeValue === "storing" || typeValue === "onderhoud";
  const contactRequired = typeValue === "bel_activiteit";

  const assetOptions = useMemo(
    () => clientScoped.assets.map((asset) => ({ value: asset.id, label: asset.name })),
    [clientScoped.assets],
  );
  const contactOptions = useMemo(
    () => clientScoped.contacts.map((contact) => ({ value: contact.id, label: contact.name })),
    [clientScoped.contacts],
  );

  function handleClientChange(nextClientId: string) {
    setClientId(nextClientId);
    setAssetId("");
    setContactPersonId("");
    onClientChange(nextClientId);
  }

  function handleContactChange(nextContactId: string) {
    setContactPersonId(nextContactId);
    if (!nextContactId) return;
    const contact = clientScoped.contacts.find((candidate) => candidate.id === nextContactId);
    if (!contact) return;
    // One-time copy into the override fields — never synced back to
    // `contacts` afterward, each field stays independently editable from
    // `ActivityContactSection` from here on, same as before.
    setContactName(contact.name);
    setContactPhone(contact.phone ?? "");
    setContactEmail(contact.email ?? "");
  }

  async function handleSave() {
    if (!clientId && !assetId) {
      setError("Select a client or an asset.");
      return;
    }
    if (assetRequired && !assetId) {
      setError("An asset is required for Storing or Onderhoud activities.");
      return;
    }
    if (contactRequired && !contactPersonId && !(contactName && contactPhone)) {
      setError("A contact person, or both a name and phone number, is required for Bel activiteit.");
      return;
    }
    setError(null);
    setSaving(true);
    const result = await onSave({ clientId, assetId, contactPersonId, contactName, contactPhone, contactEmail });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save.");
      return;
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Text>Client, asset &amp; contact</Text>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}

          <FormGrid columns={2}>
            {isClientLocked ? (
              <Stack gap="xs">
                <Label>Client</Label>
                <Text>{clients.find((candidate) => candidate.id === clientId)?.name ?? "—"}</Text>
              </Stack>
            ) : (
              <Stack gap="xs">
                <Label htmlFor="activity-relations-client">Client</Label>
                <Select
                  id="activity-relations-client"
                  value={clientId}
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
              </Stack>
            )}

            {isAssetLocked ? (
              <Stack gap="xs">
                <Label>Asset</Label>
                <Text>{clientScoped.assets.find((candidate) => candidate.id === assetId)?.name ?? "—"}</Text>
              </Stack>
            ) : (
              <Stack gap="xs">
                <Label htmlFor="activity-relations-asset">Asset{assetRequired ? " *" : ""}</Label>
                <Combobox
                  id="activity-relations-asset"
                  options={assetOptions}
                  value={assetId}
                  onChange={setAssetId}
                  placeholder={!clientId ? "Select a client first…" : "Search assets…"}
                  disabled={!clientId || clientScoped.loadingAssets}
                  required={assetRequired}
                  clearable
                  emptyMessage="No assets for this client."
                />
              </Stack>
            )}
          </FormGrid>
          {assetRequired && !isAssetLocked && <Text tone="muted">Asset is required for Storing or Onderhoud activities.</Text>}

          <Stack gap="xs">
            <Label htmlFor="activity-relations-contact-person">Contact person</Label>
            <Combobox
              id="activity-relations-contact-person"
              options={contactOptions}
              value={contactPersonId}
              onChange={handleContactChange}
              placeholder={!clientId ? "Select a client first…" : "Search contacts…"}
              disabled={!clientId || clientScoped.loadingContacts}
              clearable
              emptyMessage="No contacts for this client."
            />
            <Text tone="muted">
              {contactRequired
                ? "A contact person, or a name and phone number, is required for Bel activiteit."
                : "Who to contact about this melding, if anyone. Name/phone/email can be fine-tuned in the Contact person section below."}
            </Text>
          </Stack>
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
