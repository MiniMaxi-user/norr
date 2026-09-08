"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Badge,
  Breadcrumbs,
  Button,
  DetailColumns,
  RecordHeroBand,
  RelationCard,
  Stack,
  StatStrip,
  Text,
  type BreadcrumbItem,
  type StatStripItem,
} from "@yourorg/ui";
import { Building2, CalendarDays } from "@yourorg/ui/icons";
import { updateContract, type ContractAssetRecord, type ContractArticleGroupRuleRecord, type ContractArticleRuleRecord, type ContractLineItemRecord, type ContractRecord } from "../actions";
import type { ClientRecord } from "@/app/(app)/clients/actions";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import type { ArticleGroupRecord } from "@/app/(app)/articles/groups-actions";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { formatDate } from "@/lib/format/date";
import { formatCurrency } from "@/lib/format/currency";
import { usePageHeader } from "@/components/shell/page-header-context";
import { draftFromContract, draftToInput, type ContractDraft } from "./contract-draft";
import { ContractTermsSection } from "./contract-terms-section";
import { ContractDatesSection } from "./contract-dates-section";
import { ContractNotesSection } from "./contract-notes-section";
import { ContractLineItemsSection } from "./contract-line-items-section";
import { ContractArticleCoverageSection } from "./contract-article-coverage-section";
import { ContractAssetsPanel } from "../[id]/contract-assets-panel";
import { DeleteContractDialog } from "./delete-contract-dialog";
import { ContractClientDialog } from "./contract-client-dialog";

export interface ContractScreenProps {
  /** Built by the server `page.tsx` and pushed into the Topbar via
   * `usePageHeader` — never rendered inline, same pattern
   * `AssetScreen`/`WorkOrderScreen` already use. */
  breadcrumbItems: BreadcrumbItem[];

  contract: ContractRecord;
  client: ClientRecord | null;
  /** Org's clients, for the Client relation card's re-pick dialog. */
  clients: ClientRecord[];

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
 * The `/contracts/[id]` detail/edit screen — a dark hero band with a
 * `StatStrip` (Contract value/Term remaining/Line items/Covered assets) as
 * its flat bottom edge, then a wide left work column (Line items/Article
 * coverage/Covered assets) beside a narrow right rail (Client/Terms/Dates/
 * Notes) via `DetailColumns ratio="rail"`.
 *
 * There is no `/contracts/new` create form anymore — `CreateContractButton`
 * (`create-contract-button.tsx`) creates a bare contract (name "New
 * contract", today's start date) immediately and navigates straight here;
 * every field is then edited inline on this screen exactly like any other
 * existing contract. `ContractDetailsSection` doesn't exist: Name edits via
 * the hero title input (same pattern as work orders), Type lives in
 * `ContractTermsSection`, and Client lives in the rail's own `RelationCard`
 * — its pencil opens `ContractClientDialog` (`./contract-client-dialog.tsx`,
 * a small re-pick popup, mirroring `WorkOrderRelationsDialog`'s own
 * "RelationCard pencil -> Dialog" shape).
 *
 * Owns one flat `ContractDraft` (`./contract-draft.ts`) as the source of
 * truth for every editable field; every section reads from it and writes
 * back through `commitPatch` below, which persists immediately
 * (`updateContract`) — small, section-scoped, saved the instant that
 * section's own Save is clicked, no page-wide Save/Cancel.
 */
export function ContractScreen({
  breadcrumbItems,
  contract,
  client = null,
  clients,
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

  const [draft, setDraft] = useState<ContractDraft>(() => draftFromContract(contract));

  const [clientDialogOpen, setClientDialogOpen] = useState(false);
  const [termsEditing, setTermsEditing] = useState(false);
  const [datesEditing, setDatesEditing] = useState(false);
  const [notesEditing, setNotesEditing] = useState(false);

  const [deleting, setDeleting] = useState(false);

  /** Every section's own "Save" ultimately calls this — persists immediately
   * (`updateContract`) and refreshes the server-rendered data
   * (`router.refresh()`). */
  async function commitPatch(patch: Partial<ContractDraft>): Promise<{ ok: boolean; error?: string }> {
    const result = await updateContract(contract.id, draftToInput(patch));
    if (!result.data) return { ok: false, error: result.error };
    setDraft((prev) => ({ ...prev, ...patch }));
    router.refresh();
    return { ok: true };
  }

  function handleNameChange(value: string) {
    setDraft((prev) => ({ ...prev, name: value }));
  }

  function handleNameBlur(value: string) {
    const trimmed = value.trim();
    if (trimmed && trimmed !== contract.name) {
      void commitPatch({ name: trimmed });
    }
  }

  // The Client relation card (in the rail below) sources its display from
  // `client` (the server-resolved prop) when it matches the draft's current
  // `clientId`, falling back to a lookup in `clients` — same "committed vs.
  // just-picked-locally" resolution `WorkOrderRelationCards` uses.
  const resolvedClient = draft.clientId
    ? client?.id === draft.clientId
      ? client
      : (clients.find((candidate) => candidate.id === draft.clientId) ?? null)
    : null;
  const clientFacts = resolvedClient
    ? [resolvedClient.kvk_number ? `KvK ${resolvedClient.kvk_number}` : null, resolvedClient.vat_number]
        .filter(Boolean)
        .join(" · ")
    : "";
  const clientExpanded = resolvedClient ? (
    <Stack gap="xs">
      <div className="ui-relation-card-expand-row">
        <Text tone="muted">KvK</Text>
        <Text>{resolvedClient.kvk_number || "—"}</Text>
      </div>
      <div className="ui-relation-card-expand-row">
        <Text tone="muted">VAT</Text>
        <Text>{resolvedClient.vat_number || "—"}</Text>
      </div>
      <div className="ui-relation-card-expand-row">
        <Text tone="muted">IBAN</Text>
        <Text>{resolvedClient.iban || "—"}</Text>
      </div>
      {resolvedClient.notes && (
        <div className="ui-relation-card-expand-row">
          <Text tone="muted">Notes</Text>
          <Text>{resolvedClient.notes}</Text>
        </div>
      )}
    </Stack>
  ) : undefined;

  // Badges → client → term, in that order (docs/designinstructieskanweg's
  // "Contract detail 1b" spec, section 1) — badges fold into the meta row's
  // FIRST item, wrapped in `ui-record-hero-band-meta-badges`, exactly the
  // placement `work-order-hero.tsx` uses for its own status/priority pair.
  const meta = [
    <span className="ui-record-hero-band-meta-badges" key="badges">
      <Badge color={contract.contract_type?.color} variant="muted">
        {contract.contract_type?.label ?? "—"}
      </Badge>
      {contract.sla_tier && (
        <Badge color={contract.sla_tier.color} variant="muted">
          {contract.sla_tier.label}
        </Badge>
      )}
    </span>,
  ];
  if (resolvedClient) {
    meta.push(
      <>
        <Building2 /> <Link href={`/clients/${resolvedClient.id}`}>{resolvedClient.name}</Link>
      </>,
    );
  }
  meta.push(
    <>
      <CalendarDays /> {formatDate(contract.start_date, { month: "long" })} –{" "}
      {contract.end_date ? formatDate(contract.end_date, { month: "long" }) : "Open-ended"}
    </>,
  );

  // StatStrip — Contract value / Term remaining / Line items / Covered
  // assets, computed from data this screen already holds.
  const lineItemsTotal = lineItems.reduce((sum, row) => sum + row.quantity * row.unit_price, 0);
  const coveredSiteCount = new Set(
    contractAssets.map((row) => row.asset?.site_id).filter((id): id is string => Boolean(id)),
  ).size;

  const startMs = new Date(`${contract.start_date}T00:00:00`).getTime();
  const endMs = contract.end_date ? new Date(`${contract.end_date}T00:00:00`).getTime() : null;
  const nowMs = Date.now();
  const daysRemaining = endMs !== null ? Math.max(0, Math.ceil((endMs - nowMs) / 86_400_000)) : null;
  const termProgress =
    endMs !== null && endMs > startMs
      ? Math.min(100, Math.max(0, ((nowMs - startMs) / (endMs - startMs)) * 100))
      : undefined;

  const stats: StatStripItem[] = [
    {
      label: "Contract value",
      value: formatCurrency(contract.value),
      hint: [contract.billing_terms?.label, contract.billing_period?.label].filter(Boolean).join(" · ") || undefined,
    },
    {
      label: "Term remaining",
      value: daysRemaining === null ? "Open-ended" : `${daysRemaining} ${daysRemaining === 1 ? "day" : "days"}`,
      progress: termProgress,
    },
    {
      label: "Line items",
      value: lineItems.length,
      hint: lineItems.length > 0 ? formatCurrency(lineItemsTotal) : undefined,
    },
    {
      label: "Covered assets",
      value: contractAssets.length,
      hint: contractAssets.length > 0 ? `${coveredSiteCount} ${coveredSiteCount === 1 ? "site" : "sites"}` : undefined,
    },
  ];

  const heroActions = canDelete && (
    <Button type="button" variant="danger" onClick={() => setDeleting(true)}>
      Delete
    </Button>
  );

  return (
    <Stack gap="lg">
      <RecordHeroBand
        title={
          readOnly ? (
            <h1 className="ui-record-hero-band-title">{draft.name || "—"}</h1>
          ) : (
            <input
              className="ui-record-hero-band-title-input"
              value={draft.name}
              placeholder="Untitled contract — click to name it"
              aria-label="Contract name"
              onChange={(event) => handleNameChange(event.target.value)}
              onBlur={(event) => handleNameBlur(event.target.value)}
            />
          )
        }
        meta={meta}
        actions={heroActions}
        stats={<StatStrip items={stats} />}
      />

      <DetailColumns
        ratio="rail"
        left={
          <Stack gap="lg">
            <ContractLineItemsSection
              contractId={contract.id}
              lineItems={lineItems}
              articles={articles}
              canCreate={canCreate}
              canUpdate={canUpdate}
              canDelete={canDelete}
            />
            <ContractArticleCoverageSection
              contractId={contract.id}
              articleGroups={articleGroups}
              articles={articles}
              groupRules={groupRules}
              articleRules={articleRules}
              canCreate={canCreate}
              canDelete={canDelete}
            />
            <ContractAssetsPanel
              contractId={contract.id}
              contractAssets={contractAssets}
              clientAssets={clientAssets}
              siteLabelById={siteLabelById}
              canLink={canCreate}
              canUnlink={canDelete}
            />
          </Stack>
        }
        right={
          <Stack gap="lg">
            <RelationCard
              icon={Building2}
              label="Client"
              loading={false}
              title={resolvedClient ? <Link href={`/clients/${resolvedClient.id}`}>{resolvedClient.name}</Link> : undefined}
              subtitle={clientFacts || undefined}
              emptyText="No client selected yet"
              onEdit={readOnly ? undefined : () => setClientDialogOpen(true)}
              expandedContent={clientExpanded}
            />
            <ContractTermsSection
              draft={draft}
              contract={contract}
              contractTypes={contractTypes}
              slaTiers={slaTiers}
              billingTerms={billingTerms}
              billingPeriods={billingPeriods}
              editing={termsEditing}
              onEditToggle={setTermsEditing}
              readOnly={readOnly}
              onSave={commitPatch}
            />
            <ContractDatesSection
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
          </Stack>
        }
      />

      {clientDialogOpen && (
        <ContractClientDialog
          open
          onOpenChange={setClientDialogOpen}
          clientId={draft.clientId}
          clients={clients}
          onSave={(clientId) => commitPatch({ clientId })}
        />
      )}

      {deleting && <DeleteContractDialog contract={contract} open onOpenChange={setDeleting} redirectOnDelete />}
    </Stack>
  );
}
