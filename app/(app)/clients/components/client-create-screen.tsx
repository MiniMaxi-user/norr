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
 * (`client-business-details-section.tsx` etc.), just in `mode: "create"`
 * with `hideActions` — every section starts (and stays) open/editing (no
 * pencil, no toggle), every field is directly controlled off this screen's
 * own shared `draft` and merges into it (no network call) on every change,
 * and only the ONE page-level "Save client" button below actually persists
 * anything (see `ClientBusinessDetailsSectionProps.hideActions`'s own doc
 * comment for why: this screen used to also render each section's own
 * Cancel/Save row on top of its own page-level pair — five Save-ish buttons
 * on one page).
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
            <ClientBusinessDetailsSection mode="create" draft={draft} editing onSave={mergeDraft} hideActions />
            <ClientPipelineSection
              mode="create"
              draft={draft}
              accountManagers={accountManagers}
              editing
              onSave={mergeDraft}
              hideActions
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
              hideActions
            />
            <ClientNotesSection mode="create" draft={draft} editing onSave={mergeDraft} hideActions />
          </Stack>
        }
      />
    </Stack>
  );
}
