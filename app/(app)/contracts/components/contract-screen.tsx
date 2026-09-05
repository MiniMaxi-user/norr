"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Breadcrumbs,
  Button,
  DetailColumns,
  Inline,
  RecordHeroBand,
  Stack,
  Text,
  type BreadcrumbItem,
} from "@yourorg/ui";
import { CalendarDays } from "@yourorg/ui/icons";
import { createContract, updateContract, type ContractAssetRecord, type ContractArticleGroupRuleRecord, type ContractArticleRuleRecord, type ContractLineItemRecord, type ContractRecord } from "../actions";
import type { ClientRecord } from "@/app/(app)/clients/actions";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import type { ArticleGroupRecord } from "@/app/(app)/articles/groups-actions";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { formatDate, formatDateTime } from "@/lib/format/date";
import { usePageHeader } from "@/components/shell/page-header-context";
import { draftFromContract, draftToInput, emptyDraft, type ContractDraft } from "./contract-draft";
import { ContractDetailsSection } from "./contract-details-section";
import { ContractTermsSection } from "./contract-terms-section";
import { ContractDatesSection } from "./contract-dates-section";
import { ContractNotesSection } from "./contract-notes-section";
import { ContractLineItemsSection } from "./contract-line-items-section";
import { ContractArticleCoverageSection } from "./contract-article-coverage-section";
import { ContractAssetsPanel } from "../[id]/contract-assets-panel";
import { DeleteContractDialog } from "./delete-contract-dialog";

export interface ContractScreenProps {
  mode: "create" | "edit";
  /** Built by the server `page.tsx` and pushed into the Topbar via
   * `usePageHeader` — never rendered inline, same pattern
   * `AssetScreen`/`WorkOrderScreen` already use. */
  breadcrumbItems: BreadcrumbItem[];

  /** Required for `mode: "edit"`. */
  contract?: ContractRecord;
  client?: ClientRecord | null;
  /** Org's clients, for the Contract details section's picker. Ignored (and
   * the picker hidden entirely) when `lockedClientId` is set. */
  clients: ClientRecord[];
  lockedClientId?: string;
  cancelHref: string;

  contractTypes: ReferenceListItemRecord[];
  slaTiers: ReferenceListItemRecord[];
  billingTerms: ReferenceListItemRecord[];
  billingPeriods: ReferenceListItemRecord[];

  /** Never render an edit affordance RLS would reject — a viewer with plain
   * `read` gets a fully read-only render (no pencils anywhere), same
   * convention `AssetScreen`'s own `readOnly` prop documents. */
  readOnly?: boolean;
  canCreate?: boolean;
  canUpdate?: boolean;
  canDelete?: boolean;

  // ---- edit-mode-only sub-entities ----
  lineItems?: ContractLineItemRecord[];
  articles?: ArticleSelectOption[];
  articleGroups?: ArticleGroupRecord[];
  groupRules?: ContractArticleGroupRuleRecord[];
  articleRules?: ContractArticleRuleRecord[];
  contractAssets?: ContractAssetRecord[];
  clientAssets?: AssetRecord[];
  siteLabelById?: Map<string, string | null>;
}

/**
 * The single shared screen behind `/contracts/new` (`mode: "create"`) and
 * `/contracts/[id]` (`mode: "edit"`) — one real screen, not two/three, per
 * issue #122 ("I think this can become just 1 page"), mirroring
 * `AssetScreen`'s "one screen, not three" shape (`app/(app)/assets/
 * components/asset-screen.tsx`).
 *
 * Owns one flat `ContractDraft` (`./contract-draft.ts`) as the source of
 * truth for every editable field; every section reads from it and writes
 * back through `commitPatch` below — in `mode: "edit"` that's an immediate
 * `updateContract` call (small, section-scoped, saved the instant that
 * section's own Save is clicked — no page-wide Save/Cancel), in
 * `mode: "create"` it's a local-only merge until the hero's own "Save
 * contract" action fires `createContract` with the whole accumulated draft
 * and navigates to the new record.
 *
 * Line items/Article coverage/Linked assets are all edit-mode-only (nothing
 * to manage before the contract exists), same "hide until the record exists"
 * convention `ActivityScreen`'s own Notes/Linked-work-orders/Historie
 * sections use.
 */
export function ContractScreen({
  mode,
  breadcrumbItems,
  contract,
  client = null,
  clients,
  lockedClientId,
  cancelHref,
  contractTypes,
  slaTiers,
  billingTerms,
  billingPeriods,
  readOnly,
  canCreate = false,
  canUpdate = false,
  canDelete = false,
  lineItems = [],
  articles = [],
  articleGroups = [],
  groupRules = [],
  articleRules = [],
  contractAssets = [],
  clientAssets = [],
  siteLabelById = new Map(),
}: ContractScreenProps) {
  const router = useRouter();

  const breadcrumbNode = useMemo(() => <Breadcrumbs items={breadcrumbItems} />, [breadcrumbItems]);
  usePageHeader(breadcrumbNode);

  const [draft, setDraft] = useState<ContractDraft>(() =>
    contract ? draftFromContract(contract) : emptyDraft({ lockedClientId }),
  );

  const [detailsEditing, setDetailsEditing] = useState(mode === "create");
  const [termsEditing, setTermsEditing] = useState(mode === "create");
  const [datesEditing, setDatesEditing] = useState(mode === "create");
  const [notesEditing, setNotesEditing] = useState(false);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  /** Every section's own "Save" ultimately calls this. `mode: "edit"`
   * persists immediately (`updateContract`) and refreshes the server-rendered
   * data (`router.refresh()`); `mode: "create"` only ever merges into local
   * draft state — see this component's own module doc comment. */
  async function commitPatch(patch: Partial<ContractDraft>): Promise<{ ok: boolean; error?: string }> {
    if (mode === "edit" && contract) {
      const result = await updateContract(contract.id, draftToInput(patch));
      if (!result.data) return { ok: false, error: result.error };
      setDraft((prev) => ({ ...prev, ...patch }));
      router.refresh();
      return { ok: true };
    }
    setDraft((prev) => ({ ...prev, ...patch }));
    return { ok: true };
  }

  async function handleCreate() {
    if (!lockedClientId && !draft.clientId) {
      setCreateError("Select a client.");
      return;
    }
    if (!draft.name.trim()) {
      setCreateError("Name is required.");
      return;
    }
    if (!draft.startDate) {
      setCreateError("Start date is required.");
      return;
    }
    setCreateError(null);
    setCreating(true);
    const result = await createContract(draftToInput(draft));
    setCreating(false);
    if (!result.data) {
      setCreateError(result.error ?? "Could not create this contract.");
      return;
    }
    router.push(`/contracts/${result.data.contract.id}`);
  }

  const meta =
    mode === "edit" && contract?.start_date && contract?.end_date
      ? [
          <span key="dates">
            <CalendarDays /> {formatDate(contract.start_date, { month: "long" })} –{" "}
            {formatDate(contract.end_date, { month: "long" })}
          </span>,
        ]
      : [];

  const heroActions =
    mode === "edit" && contract ? (
      canDelete && (
        <Button type="button" variant="danger" onClick={() => setDeleting(true)}>
          Delete
        </Button>
      )
    ) : (
      <>
        <Button type="button" variant="outline" onClick={() => router.push(cancelHref)} disabled={creating}>
          Cancel
        </Button>
        <Button type="button" variant="primary" onClick={handleCreate} disabled={creating}>
          {creating ? "Saving…" : "Save contract"}
        </Button>
      </>
    );

  return (
    <Stack gap="lg">
      {createError && <Text tone="danger">{createError}</Text>}

      <RecordHeroBand
        title={<h1 className="ui-record-hero-band-title">{mode === "create" ? "New contract" : (contract?.name ?? "—")}</h1>}
        badges={
          <>
            {mode === "create" ? (
              <Badge variant="accent">New</Badge>
            ) : (
              <Badge color={contract?.contract_type?.color} variant="muted">
                {contract?.contract_type?.label ?? "—"}
              </Badge>
            )}
            {mode === "edit" && contract?.sla_tier && (
              <Badge color={contract.sla_tier.color} variant="muted">
                {contract.sla_tier.label}
              </Badge>
            )}
          </>
        }
        meta={meta}
        actions={heroActions}
      />

      <DetailColumns
        left={
          <Stack gap="lg">
            <ContractDetailsSection
              mode={mode}
              draft={draft}
              contract={contract}
              client={client}
              clients={clients}
              lockedClientId={lockedClientId}
              contractTypes={contractTypes}
              editing={detailsEditing}
              onEditToggle={setDetailsEditing}
              readOnly={readOnly}
              onSave={commitPatch}
            />
            <ContractTermsSection
              mode={mode}
              draft={draft}
              contract={contract}
              slaTiers={slaTiers}
              billingTerms={billingTerms}
              billingPeriods={billingPeriods}
              editing={termsEditing}
              onEditToggle={setTermsEditing}
              readOnly={readOnly}
              onSave={commitPatch}
            />
          </Stack>
        }
        right={
          <Stack gap="lg">
            <ContractDatesSection
              mode={mode}
              draft={draft}
              contract={contract}
              editing={datesEditing}
              onEditToggle={setDatesEditing}
              readOnly={readOnly}
              onSave={commitPatch}
            />
            <ContractNotesSection
              draft={draft}
              editing={notesEditing}
              onEditToggle={setNotesEditing}
              readOnly={readOnly}
              onSave={commitPatch}
            />
            {mode === "edit" && contract && (
              <Inline justify="between" gap="sm">
                <Text tone="muted">Created {formatDateTime(contract.created_at, { month: "long" })}</Text>
                <Text tone="muted">Last modified {formatDateTime(contract.updated_at, { month: "long" })}</Text>
              </Inline>
            )}
          </Stack>
        }
      />

      {mode === "edit" && contract && (
        <DetailColumns
          left={
            <ContractLineItemsSection
              contractId={contract.id}
              lineItems={lineItems}
              articles={articles}
              canCreate={canCreate}
              canUpdate={canUpdate}
              canDelete={canDelete}
            />
          }
          right={
            <ContractArticleCoverageSection
              contractId={contract.id}
              articleGroups={articleGroups}
              articles={articles}
              groupRules={groupRules}
              articleRules={articleRules}
              canCreate={canCreate}
              canDelete={canDelete}
            />
          }
        />
      )}

      {mode === "edit" && contract && (
        <ContractAssetsPanel
          contractId={contract.id}
          contractAssets={contractAssets}
          clientAssets={clientAssets}
          siteLabelById={siteLabelById}
          canLink={canCreate}
          canUnlink={canDelete}
        />
      )}

      {mode === "edit" && contract && deleting && (
        <DeleteContractDialog contract={contract} open onOpenChange={setDeleting} redirectOnDelete />
      )}
    </Stack>
  );
}
