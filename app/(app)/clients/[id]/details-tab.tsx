"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DetailColumns, Stack } from "@yourorg/ui";
import type { AccountManagerRecord } from "@/lib/account-managers/actions";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import { updateClient, updateClientRateSettings, type ClientRecord } from "../actions";
import { ClientBusinessDetailsSection } from "../components/client-business-details-section";
import { ClientNotesSection } from "../components/client-notes-section";
import { ClientPipelineSection } from "../components/client-pipeline-section";
import { ClientRateSection } from "../components/client-rate-section";
import { draftFromClient, draftToClientInput, type ClientDraft } from "../components/client-draft";

export interface ClientDetailsTabProps {
  client: ClientRecord;
  accountManagers: AccountManagerRecord[];
  articles: ArticleSelectOption[];
  canWrite: boolean;
}

/**
 * "Details" tab (Client Details tab redo) — the client's own fields, made
 * inline-editable via `EditableSection`, replacing the old `EditClientPanel`
 * slide-in entirely. `DetailColumns` layout matches the design handoff
 * screenshot: Business details + Pipeline on the left, Rate + Notes on the
 * right — this is a layout INSIDE the tab panel, separate from the page's own
 * outer `DetailLayout` rail (Company/Locations), which stays exactly as-is.
 *
 * Owns one flat `ClientDraft` (`../components/client-draft.ts`) as the local
 * echo of `client`'s own fields, mirroring `AssetScreen`'s `commitPatch`
 * convention exactly: each section's own Save calls straight through to
 * `updateClient`/`updateClientRateSettings` (immediate, section-scoped save,
 * no page-wide Save/Cancel), then `router.refresh()` re-fetches the server
 * data — `draft` itself is re-synced from the fresh `client` prop via the
 * effect below once that refresh resolves.
 */
export function ClientDetailsTab({ client, accountManagers, articles, canWrite }: ClientDetailsTabProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<ClientDraft>(() => draftFromClient(client));
  useEffect(() => {
    setDraft(draftFromClient(client));
  }, [client]);

  const [businessEditing, setBusinessEditing] = useState(false);
  const [pipelineEditing, setPipelineEditing] = useState(false);
  const [rateEditing, setRateEditing] = useState(false);
  const [notesEditing, setNotesEditing] = useState(false);

  async function commitClientPatch(patch: Partial<ClientDraft>): Promise<{ ok: boolean; error?: string }> {
    const result = await updateClient(client.id, draftToClientInput(patch));
    if (!result.data) return { ok: false, error: result.error };
    setDraft((prev) => ({ ...prev, ...patch }));
    router.refresh();
    return { ok: true };
  }

  async function commitRatePatch(input: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
    const result = await updateClientRateSettings(client.id, input);
    if (!result.data) return { ok: false, error: result.error };
    router.refresh();
    return { ok: true };
  }

  const readOnly = !canWrite;

  return (
    <DetailColumns
      left={
        <Stack gap="lg">
          <ClientBusinessDetailsSection
            mode="edit"
            draft={draft}
            editing={businessEditing}
            onEditToggle={setBusinessEditing}
            readOnly={readOnly}
            onSave={commitClientPatch}
          />
          <ClientPipelineSection
            mode="edit"
            draft={draft}
            accountManagers={accountManagers}
            editing={pipelineEditing}
            onEditToggle={setPipelineEditing}
            readOnly={readOnly}
            onSave={commitClientPatch}
          />
        </Stack>
      }
      right={
        <Stack gap="lg">
          <ClientRateSection
            mode="edit"
            idPrefix="client-rate-details"
            draft={draft}
            articles={articles}
            editing={rateEditing}
            onEditToggle={setRateEditing}
            readOnly={readOnly}
            onSave={commitRatePatch}
          />
          <ClientNotesSection
            mode="edit"
            draft={draft}
            editing={notesEditing}
            onEditToggle={setNotesEditing}
            readOnly={readOnly}
            onSave={commitClientPatch}
          />
        </Stack>
      }
    />
  );
}
