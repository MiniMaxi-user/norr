"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Breadcrumbs,
  Button,
  DetailColumns,
  Heading,
  Inline,
  Stack,
  Text,
  type BreadcrumbItem,
} from "@yourorg/ui";
import type { AccountManagerRecord } from "@/lib/account-managers/actions";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import { usePageHeader } from "@/components/shell/page-header-context";
import { createClient, updateClientRateSettings } from "../actions";
import { ClientBusinessDetailsSection } from "./client-business-details-section";
import { ClientNotesSection } from "./client-notes-section";
import { ClientPipelineSection } from "./client-pipeline-section";
import { ClientRateSection } from "./client-rate-section";
import { draftToClientInput, draftToRateInput, emptyDraft, type ClientDraft } from "./client-draft";

export interface ClientCreateScreenProps {
  breadcrumbItems: BreadcrumbItem[];
  accountManagers: AccountManagerRecord[];
  articles: ArticleSelectOption[];
  /** Server-computed `YYYY-MM-DD` "today" — the default "Client since" value,
   * same reasoning `new-client-panel.tsx` documented for using the server's
   * own date rather than the visitor's local browser date. */
  todayIso: string;
}

/**
 * `/clients/new` — replaces the old `NewClientPanel` slide-in dialog (deleted
 * in the same change) with a real page, per docs/ARCHITECTURE.md's "Popup vs.
 * full page": a top-level module's own record (Clients) gets a real page for
 * create, never a `Dialog`.
 *
 * Renders the SAME 4 section components the Details tab uses
 * (`client-business-details-section.tsx` etc.), just in `mode: "create"`:
 * every section starts (and stays) open/editing — no pencil, no toggle — and
 * each section's own "Save" only merges into local `draft` state (no network
 * call) until this screen's own "Save client" action fires, mirroring
 * `AssetScreen`'s identical create-mode shape exactly (see that file's own
 * doc comment).
 *
 * Deliberate scope decision (see the story): unlike the old `NewClientPanel`,
 * this does NOT also collect the client's first Site/address in the same
 * flow — a new client is created with just its Details-tab fields (Name
 * required, everything else optional); the user adds a Site afterward from
 * the client detail page's own Sites tab.
 */
export function ClientCreateScreen({ breadcrumbItems, accountManagers, articles, todayIso }: ClientCreateScreenProps) {
  const router = useRouter();
  const breadcrumbNode = useMemo(() => <Breadcrumbs items={breadcrumbItems} />, [breadcrumbItems]);
  usePageHeader(breadcrumbNode);

  const [draft, setDraft] = useState<ClientDraft>(() => emptyDraft(todayIso));
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdClientId, setCreatedClientId] = useState<string | null>(null);

  async function mergeDraft(patch: Partial<ClientDraft>): Promise<{ ok: boolean; error?: string }> {
    setDraft((prev) => ({ ...prev, ...patch }));
    return { ok: true };
  }

  async function mergeRateDraft(input: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
    setDraft((prev) => ({
      ...prev,
      hasCustomRate: Boolean(input.hasCustomRate),
      travelArticleId: typeof input.travelArticleId === "string" ? input.travelArticleId : "",
      workArticleId: typeof input.workArticleId === "string" ? input.workArticleId : "",
      travelSalePrice: typeof input.travelSalePrice === "string" ? input.travelSalePrice : "",
      workSalePrice: typeof input.workSalePrice === "string" ? input.workSalePrice : "",
    }));
    return { ok: true };
  }

  async function handleCreate() {
    if (!draft.name.trim()) {
      setCreateError("Name is required.");
      return;
    }
    setCreateError(null);
    setCreating(true);

    const clientResult = await createClient(draftToClientInput(draft));
    if (!clientResult.data) {
      setCreating(false);
      setCreateError(clientResult.error ?? "Could not create this client.");
      return;
    }

    const newClientId = clientResult.data.client.id;

    // Third sequential call (issue #93), only when the checkbox was checked —
    // mirrors `new-client-panel.tsx`'s old two-then-three-call sequence, minus
    // the `createSite` step this redo deliberately drops (see this
    // component's own doc comment).
    if (draft.hasCustomRate) {
      const rateResult = await updateClientRateSettings(newClientId, draftToRateInput(draft));
      if (!rateResult.data) {
        setCreating(false);
        setCreateError(rateResult.error ?? "The client was created, but its rate settings could not be saved.");
        setCreatedClientId(newClientId);
        return;
      }
    }

    setCreating(false);
    router.push(`/clients/${newClientId}`);
  }

  return (
    <Stack gap="lg">
      {createError && (
        <Stack gap="xs">
          <Text tone="danger">{createError}</Text>
          {createdClientId && (
            <Link href={`/clients/${createdClientId}`}>
              <Button type="button" variant="outline" size="sm">
                View the client that was created
              </Button>
            </Link>
          )}
        </Stack>
      )}

      <Inline justify="between" align="center">
        <Heading level={1}>New client</Heading>
        <Inline gap="sm">
          <Button type="button" variant="outline" onClick={() => router.push("/clients")} disabled={creating}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={handleCreate} disabled={creating}>
            {creating ? "Saving…" : "Save client"}
          </Button>
        </Inline>
      </Inline>

      <DetailColumns
        left={
          <Stack gap="lg">
            <ClientBusinessDetailsSection mode="create" draft={draft} editing onSave={mergeDraft} />
            <ClientPipelineSection
              mode="create"
              draft={draft}
              accountManagers={accountManagers}
              editing
              onSave={mergeDraft}
            />
          </Stack>
        }
        right={
          <Stack gap="lg">
            <ClientRateSection
              mode="create"
              idPrefix="new-client-rate"
              draft={draft}
              articles={articles}
              editing
              onSave={mergeRateDraft}
            />
            <ClientNotesSection mode="create" draft={draft} editing onSave={mergeDraft} />
          </Stack>
        }
      />
    </Stack>
  );
}
