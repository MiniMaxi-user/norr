"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Badge,
  Breadcrumbs,
  Button,
  DetailColumns,
  Dialog,
  Label,
  RecordHeroBand,
  RelationCard,
  Select,
  Stack,
  StatStrip,
  Text,
  type BreadcrumbItem,
  type StatStripItem,
} from "@yourorg/ui";
import { Building2, CalendarDays } from "@yourorg/ui/icons";
import { createContract, updateContract, type ContractAssetRecord, type ContractArticleGroupRuleRecord, type ContractArticleRuleRecord, type ContractLineItemRecord, type ContractRecord } from "../actions";
import type { ClientRecord } from "@/app/(app)/clients/actions";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import type { ArticleGroupRecord } from "@/app/(app)/articles/groups-actions";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { formatDate } from "@/lib/format/date";
import { formatCurrency } from "@/lib/format/currency";
import { usePageHeader } from "@/components/shell/page-header-context";
import { draftFromContract, draftToInput, emptyDraft, type ContractDraft } from "./contract-draft";
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
  /** Org's clients, for the Client relation card's re-pick dialog. Ignored
   * (and the dialog's picker hidden entirely) when `lockedClientId` is set. */
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
 * Layout "1b" (docs/designinstructieskanweg/"Contract detail 1b -
 * implementatie.md"): a dark hero band with a `StatStrip` (Contract value/
 * Term remaining/Line items/Covered assets) as its flat bottom edge, then a
 * wide left work column (Line items/Article coverage/Covered assets) beside
 * a narrow right rail (Client/Terms/Dates/Notes) via `DetailColumns
 * ratio="rail"`. `ContractDetailsSection` (Name/Client/Type) is gone
 * entirely: Name edits via the hero title input (same pattern as work
 * orders), Type moved into `ContractTermsSection`, and Client now lives in
 * the rail's own `RelationCard` — its pencil opens `ContractClientDialog`
 * below (a small re-pick popup, mirroring `WorkOrderRelationsDialog`'s own
 * "RelationCard pencil -> Dialog" shape) rather than a whole details form,
 * since Client is the only field that still needs a picker once Name/Type
 * moved out.
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
 * to manage before the contract exists) — the left work column renders empty
 * in `mode: "create"`; the stat strip is omitted entirely there too (nothing
 * to compute yet).
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

  const [clientDialogOpen, setClientDialogOpen] = useState(false);
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

  function handleNameChange(value: string) {
    setDraft((prev) => ({ ...prev, name: value }));
  }

  function handleNameBlur(value: string) {
    const trimmed = value.trim();
    if (mode === "edit" && contract && trimmed && trimmed !== contract.name) {
      void commitPatch({ name: trimmed });
    }
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

  // The Client relation card (in the rail below) sources its display from
  // `client` (the server-resolved prop) when it matches the draft's current
  // `clientId`, falling back to a lookup in `clients` — same "committed vs.
  // just-picked-locally" resolution `WorkOrderRelationCards` uses, needed
  // because `mode: "create"` has no `router.refresh()` to re-fetch `client`
  // after a local-only draft merge.
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
    </span>,
  ];
  if (resolvedClient) {
    meta.push(
      <>
        <Building2 /> <Link href={`/clients/${resolvedClient.id}`}>{resolvedClient.name}</Link>
      </>,
    );
  }
  if (mode === "edit" && contract) {
    meta.push(
      <>
        <CalendarDays /> {formatDate(contract.start_date, { month: "long" })} –{" "}
        {contract.end_date ? formatDate(contract.end_date, { month: "long" }) : "Open-ended"}
      </>,
    );
  }

  // StatStrip — Contract value / Term remaining / Line items / Covered
  // assets, computed from data this screen already holds. Edit-mode-only:
  // nothing to compute before the contract (and its line items/assets)
  // exist.
  let stats: StatStripItem[] = [];
  if (mode === "edit" && contract) {
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

    stats = [
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
  }

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
        title={
          readOnly ? (
            <h1 className="ui-record-hero-band-title">{draft.name || (mode === "create" ? "New contract" : "—")}</h1>
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
        stats={mode === "edit" && contract ? <StatStrip items={stats} /> : undefined}
      />

      <DetailColumns
        ratio="rail"
        left={
          mode === "edit" && contract ? (
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
          ) : null
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
              onEdit={readOnly || lockedClientId ? undefined : () => setClientDialogOpen(true)}
              expandedContent={clientExpanded}
            />
            <ContractTermsSection
              mode={mode}
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

      {mode === "edit" && contract && deleting && (
        <DeleteContractDialog contract={contract} open onOpenChange={setDeleting} redirectOnDelete />
      )}
    </Stack>
  );
}

/**
 * Small re-pick popup behind the Client `RelationCard`'s pencil — the
 * `ContractDetailsSection` this screen used to route that pencil to is gone
 * (Name/Type moved elsewhere), but `/contracts/new` is still reachable with
 * no `lockedClientId` at all (the Contracts module's own "New contract"
 * toolbar button, `create-contract-button.tsx`, `contracts-screen.tsx`), so
 * a client picker still has to exist somewhere. Mirrors
 * `WorkOrderRelationsDialog`'s own "RelationCard pencil -> Dialog" shape
 * (`app/(app)/work-orders/components/work-order-relations-dialog.tsx`), and
 * `ContractLineItemDialog`'s Dialog.Header/Body/Footer shape
 * (`./contract-line-items-section.tsx`), rather than inventing a new one.
 */
function ContractClientDialog({
  open,
  onOpenChange,
  clientId,
  clients,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clients: ClientRecord[];
  onSave: (clientId: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [selected, setSelected] = useState(clientId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!selected) {
      setError("Select a client.");
      return;
    }
    setError(null);
    setSaving(true);
    const result = await onSave(selected);
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
        <Text>Change client</Text>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}
          <Stack gap="xs">
            <Label htmlFor="contract-client-select">Client</Label>
            <Select
              id="contract-client-select"
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              required
            >
              <option value="" disabled>
                Select a client…
              </option>
              {clients.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </Select>
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
