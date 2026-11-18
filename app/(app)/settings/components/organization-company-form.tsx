"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { WebHint } from "@yourorg/ui/web";
import { KeyValueCard, type EditSchema, type SaveResult } from "@yourorg/ui/web-client";
import { ClientLogoSlot } from "@/app/(app)/clients/components/client-logo-uploader";
import {
  updateOrganizationOwnClient,
  type OrganizationOwnClientSettings,
  type OwnClientOption,
} from "../company-actions";
import { firstFieldErrors, SettingsFormPage, useSettingsEdit } from "./settings-form-page";

export interface OrganizationCompanyFormProps {
  initial: OrganizationOwnClientSettings;
  /** `listClientsForOwnClientSelect()`'s result — every client in the org,
   * for the "own client" select (and the live preview of the picked one). */
  clients: OwnClientOption[];
  /** `can(actor, "settings", "update")` — owner-only, matching
   * `updateOrganizationOwnClient`'s own gate. Without it the page has no Edit
   * button, only the read view. */
  canWrite: boolean;
  /** `can(actor, "clients", "update")` — whether the logo of the own client may
   * be replaced from here (the upload action checks it too). */
  canEditLogo: boolean;
}

type CompanyDraft = {
  ownClientId: string;
};

/**
 * Org-level "own Client" picker (issue #120) on the web design system (issue
 * #222): one "Company" card — the select, plus the picked client's name, KvK,
 * VAT and IBAN as grey derived values that follow the selection live (they are
 * edited on the client's own page, so there is no editable copy here). The logo
 * sits in the header like on the client page; in edit mode it can be uploaded,
 * replaced or removed (it persists immediately, independent of Save).
 */
export function OrganizationCompanyForm({ initial, clients, canWrite, canEditLogo }: OrganizationCompanyFormProps) {
  const record = useMemo<CompanyDraft>(() => ({ ownClientId: initial.ownClientId ?? "" }), [initial.ownClientId]);

  const schema = useMemo<EditSchema<CompanyDraft>>(
    () => ({
      ownClientId: {
        label: "Own client",
        format: (value) => clients.find((client) => client.id === value)?.name ?? "",
      },
    }),
    [clients],
  );

  const edit = useSettingsEdit<CompanyDraft>({
    record,
    schema,
    canEdit: canWrite,
    idPrefix: "company",
    firstFieldKey: "ownClientId",
    onSave: async (draft): Promise<SaveResult<CompanyDraft>> => {
      const result = await updateOrganizationOwnClient({ ownClientId: draft.ownClientId || null });
      if (result.error || !result.data) {
        return {
          ok: false,
          error: result.error ?? "Could not save the organization's own client",
          fieldErrors: firstFieldErrors<"ownClientId">(result.fieldErrors),
        };
      }
      return { ok: true };
    },
  });

  // Local echo of the logo so an upload shows at once.
  const savedClient = initial.ownClient;
  const [logoUrl, setLogoUrl] = useState<string | null>(savedClient?.logoUrl ?? null);
  useEffect(() => setLogoUrl(savedClient?.logoUrl ?? null), [savedClient?.logoUrl, savedClient?.id]);

  const shownId = edit.isEditing ? edit.draft.ownClientId : edit.record.ownClientId;
  const shown: OwnClientOption | null =
    clients.find((client) => client.id === shownId) ?? (savedClient && savedClient.id === shownId ? savedClient : null);
  const options = clients.map((client) => ({ value: client.id, label: client.name }));
  if (savedClient && !options.some((option) => option.value === savedClient.id)) {
    options.push({ value: savedClient.id, label: savedClient.name });
  }
  const dash = "";

  const logo = savedClient ? (
    <ClientLogoSlot
      clientId={savedClient.id}
      clientName={savedClient.name}
      logoUrl={logoUrl}
      onLogoChange={setLogoUrl}
      editable={edit.isEditing && canEditLogo}
    />
  ) : undefined;

  return (
    <SettingsFormPage
      navKey="company"
      edit={edit}
      logo={logo}
      readOnlyNote="Only the organization owner can change this selection."
    >
      <KeyValueCard
        title="Company"
        edit={edit}
        fields={[
          {
            key: "ownClientId",
            label: "Own client",
            kind: "select",
            read: shown ? <Link href={`/clients/${shown.id}`}>{shown.name}</Link> : dash,
            options,
            emptyLabel: "Not set",
          },
          { key: "kvk", label: "KvK", kind: "derived", mono: true, read: shown?.kvkNumber ?? dash },
          { key: "vat", label: "VAT", kind: "derived", mono: true, read: shown?.vatNumber ?? dash },
          { key: "iban", label: "IBAN", kind: "derived", mono: true, read: shown?.iban ?? dash, note: "Edit these details on the client's own page" },
        ]}
      />
      <WebHint>
        Pick which of your own clients represents this organization. Its name, KvK, VAT, IBAN and logo are the details a
        future Invoicing module will use as the &lsquo;from&rsquo; party.{" "}
        {shown ? (
          <>
            Edit them on <Link href={`/clients/${shown.id}`}>{shown.name}</Link>&rsquo;s own page.
          </>
        ) : (
          "Pick a client to preview its business details here."
        )}
      </WebHint>
    </SettingsFormPage>
  );
}
