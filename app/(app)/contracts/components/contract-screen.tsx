"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useModuleEnabled } from "@/components/shell/module-features";
import { toast } from "@yourorg/ui";
import { SidebarSection, WebDetailLayout, WebPage, type WebBadgeVariant } from "@yourorg/ui/web";
import {
  EditDiscardDialog,
  PageHeader,
  scrollMainToTop,
  useEditMode,
  webTabIds,
  type PageHeaderBadge,
  type PageHeaderTab,
  type WebMenuItem,
} from "@yourorg/ui/web-client";
import type { ClientRecord } from "@/app/(app)/clients/actions";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import type { ArticleGroupRecord } from "@/app/(app)/articles/groups-actions";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import type { ContractCounterOption, MissingBaselineReading } from "../actions";
import type { ContractQuoteRecord } from "@/app/(app)/quotes/contract-quote-actions";
import { setLastUsedView } from "@/lib/preferences/actions";
import type {
  ContractArticleGroupRuleRecord,
  ContractArticleRuleRecord,
  ContractAssetRecord,
  ContractLineItemRecord,
  ContractRecord,
} from "../actions";
import { CONTRACT_DETAIL_VIEW_KEY } from "./constants";
import { contractTitle } from "./contract-title";
import { draftFromContract, emptyDraft, todayIso, type ContractDraft } from "./contract-draft";
import { buildContractSchema, createContractFromDraft, saveContractEdits } from "./contract-form-schema";
import { CONTRACT_STATUS_LABEL, CONTRACT_STATUS_TONE, getContractStatus, pluralDays } from "./contract-status";
import type { ContractFinalBalanceSummary } from "../end-actions";
import { ContractFinalBalanceCard } from "./contract-final-balance-card";
import { ContractBaselineCard } from "./contract-baseline-card";
import { useContractStatusActions } from "./contract-status-actions";
import { getLivePanel } from "./contract-live-panel";
import { ContractOverviewCards, type ContractReferenceLists } from "./contract-overview-cards";
import { ContractRail } from "./contract-rail";
import { buildContractTimeline } from "./contract-timeline";
import { ContractLineItemsPanel } from "./contract-line-items-panel";
import { billingPeriodMonths } from "@/app/(app)/quotes/contract-quote-helpers";
import { describeSettlementSchedule } from "@/app/(app)/quotes/contract-balance";
import { ContractCoveragePanel } from "./contract-coverage-panel";
import { ContractAssetsPanel } from "./contract-assets-panel";
import { ContractQuotesPanel } from "./contract-quotes-panel";
import { DeleteContractDialog } from "./delete-contract-dialog";

export type ContractDetailTab = "overview" | "lineItems" | "coverage" | "assets" | "quotes";

export interface ContractScreenProps {
  mode: "create" | "edit";

  /** Required for `mode: "edit"`. */
  contract?: ContractRecord;
  /** The contract's client (edit) or the locked client (create). */
  client?: ClientRecord | null;
  /** Clients to choose from — create mode without a locked client. */
  clients?: ClientRecord[];
  lists: ContractReferenceLists;
  /** Never render an edit affordance RLS would reject. */
  readOnly?: boolean;
  lockedClientId?: string;
  cancelHref?: string;

  // ---- edit-mode-only ----
  canCreate?: boolean;
  canUpdate?: boolean;
  canDelete?: boolean;
  lineItems?: ContractLineItemRecord[];
  articles?: ArticleSelectOption[];
  /** Counters on the covered assets' models, for volume lines (#238). */
  counterOptions?: ContractCounterOption[];
  articleGroups?: ArticleGroupRecord[];
  groupRules?: ContractArticleGroupRuleRecord[];
  articleRules?: ContractArticleRuleRecord[];
  contractAssets?: ContractAssetRecord[];
  clientAssets?: AssetRecord[];
  siteLabelById?: Map<string, string | null>;
  /** Quotes generated for this contract; `null` = the caller cannot see the
   * Quotes module, so its tab does not render at all. */
  quotes?: ContractQuoteRecord[] | null;
  /** Draft contracts only: counters still lacking a baseline reading. */
  missingBaseline?: MissingBaselineReading[];
  /** Ended contracts only: read-only final balance summary (issue #271). */
  finalBalance?: ContractFinalBalanceSummary | null;
  defaultTab?: ContractDetailTab;
}

const ENDING_SOON_DAYS = 90;

/**
 * The single shared screen behind `/contracts/new` (`mode: "create"`) and
 * `/contracts/[id]` (`mode: "edit"`) on the web design system (issue #222),
 * built exactly like the Asset page:
 *
 *  - `PageHeader`: breadcrumb (`Contracts / CON…`), title (external reference,
 *    else the contract number), badges (status → warning → type → SLA tier →
 *    auto-renews, max 5), ONE Edit button (Overview only, omitted without
 *    update permission), the ··· menu (Delete) and tabs with counts. No navy
 *    primary: nothing on a contract is a status-bound one-off action — the
 *    one that exists ("Extend contract", when it is about to end) lives in the
 *    LivePanel;
 *  - centre: the active tab — Overview (ONE two-column Details card + Notes;
 *    no related-list previews) or a related list (Line items, Article
 *    coverage, Assets, Quotes), each a card + FilterBar + table;
 *  - rail: [LivePanel] · Term · Invoicing · Contents · TIMELINE.
 *
 * Editing is `useEditMode` through the existing `updateContract` /
 * `createContract` actions (RBAC and RLS untouched). `mode: "create"` is the
 * same page in new mode: Overview only, "After creating" rail, gold
 * "Create contract".
 */
export function ContractScreen({
  mode,
  contract,
  client = null,
  clients = [],
  lists,
  readOnly,
  lockedClientId,
  cancelHref,
  canCreate = false,
  canUpdate = false,
  canDelete = false,
  lineItems = [],
  articles = [],
  counterOptions = [],
  articleGroups = [],
  groupRules = [],
  articleRules = [],
  contractAssets = [],
  clientAssets = [],
  siteLabelById = new Map(),
  quotes = null,
  missingBaseline = [],
  finalBalance = null,
  defaultTab = "overview",
}: ContractScreenProps) {
  const router = useRouter();
  const metersEnabled = useModuleEnabled("meters");
  const isCreate = mode === "create";
  const [tab, setTab] = useState<ContractDetailTab>(defaultTab);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [, startTransition] = useTransition();
  const statusActions = useContractStatusActions({ contract: contract ?? ({} as ContractRecord), canUpdate: !isCreate && !readOnly && Boolean(contract) });

  // ---- Edit mode ------------------------------------------------------------
  const defaultTypeId = lists.contractTypes.find((item) => item.is_default)?.id;
  // New contracts start on Monthly (the list item with value "monthly", else
  // the list's default) for both billing terms and billing period.
  const monthlyOrDefault = (items: { id: string; value: string; is_default: boolean }[]) =>
    (items.find((item) => item.value === "monthly") ?? items.find((item) => item.is_default))?.id;
  const defaultBillingTermsId = monthlyOrDefault(lists.billingTerms);
  const defaultBillingPeriodId = monthlyOrDefault(lists.billingPeriods);
  const record = useMemo<ContractDraft>(
    () =>
      contract
        ? draftFromContract(contract)
        : emptyDraft({ lockedClientId, defaultTypeId, defaultBillingTermsId, defaultBillingPeriodId }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contract],
  );

  const schema = useMemo(
    () =>
      buildContractSchema({
        isNew: isCreate,
        labelFor: (key, id) => {
          switch (key) {
            case "clientId":
              return clients.find((item) => item.id === id)?.name ?? (client?.id === id ? client.name : "");
            case "typeId":
              return lists.contractTypes.find((item) => item.id === id)?.label ?? "";
            case "slaTierId":
              return lists.slaTiers.find((item) => item.id === id)?.label ?? "";
            case "billingTermsId":
              return lists.billingTerms.find((item) => item.id === id)?.label ?? "";
            case "billingPeriodId":
              return lists.billingPeriods.find((item) => item.id === id)?.label ?? "";
          }
        },
      }),
    [lists, clients, client, isCreate],
  );

  const createdIdRef = useRef<string | null>(null);
  const edit = useEditMode<ContractDraft>({
    record,
    schema,
    initialMode: isCreate ? "new" : "read",
    canEdit: !isCreate && !readOnly,
    idPrefix: "contract",
    firstFieldKey: isCreate && !lockedClientId ? "clientId" : "externalReference",
    navigate: (href) => router.push(href),
    onCancelNew: () => router.push(cancelHref ?? "/contracts"),
    onSave: async (draft, dirty) => {
      if (isCreate) {
        if (createdIdRef.current) {
          router.push(`/contracts/${createdIdRef.current}`);
          return { ok: true };
        }
        const { result, contractId } = await createContractFromDraft(draft);
        if (!result.ok || !contractId) return result;
        createdIdRef.current = contractId;
        toast({ title: "Contract created", tone: "success", duration: 3000 });
        router.push(`/contracts/${contractId}`);
        return { ok: true };
      }
      return saveContractEdits(contract!.id, draft, dirty);
    },
    onSaved: () => {
      if (isCreate) return;
      toast({ title: "Saved", tone: "success", duration: 3000 });
      router.refresh();
    },
  });
  const editing = edit.isEditing;

  // ---- Derived data ---------------------------------------------------------
  const saved = edit.record;
  const labelOf = (items: { id: string; label: string }[], id: string, fallback?: string | null) =>
    items.find((item) => item.id === id)?.label ?? fallback ?? "";
  const typeLabel = labelOf(lists.contractTypes, saved.typeId, contract?.contract_type?.label);
  const slaLabel = labelOf(lists.slaTiers, saved.slaTierId, saved.slaTierId === contract?.sla_tier_id ? contract?.sla_tier?.label : null);

  const status = useMemo(
    () => getContractStatus({ start_date: saved.startDate || "9999-12-31", end_date: saved.endDate || null }),
    [saved.startDate, saved.endDate],
  );

  const lineItemTotal = useMemo(() => lineItems.reduce((sum, row) => sum + row.quantity * row.unit_price, 0), [lineItems]);
  // Issue #274: removed links are history, only open ones count as coverage.
  const openContractAssets = useMemo(() => contractAssets.filter((row) => !row.removed_on), [contractAssets]);
  const coveredSiteCount = useMemo(
    () => new Set(openContractAssets.map((row) => row.asset?.site_id).filter((id): id is string => Boolean(id))).size,
    [openContractAssets],
  );

  const counterInfo = useMemo(
    () => ({
      hasCounterLines: metersEnabled && lineItems.some((row) => row.is_volume && row.volume_item_id),
      creditsUnderUse: metersEnabled && lineItems.some((row) => row.is_volume && row.volume_item_id && row.credit_under_use),
    }),
    [lineItems, metersEnabled],
  );

  const showQuotes = !isCreate && quotes !== null;
  const ruleCount = groupRules.length + articleRules.length;

  // ---- Tabs -----------------------------------------------------------------
  function selectTab(next: ContractDetailTab) {
    if (editing) return;
    setTab(next);
    scrollMainToTop();
    startTransition(() => {
      void setLastUsedView(CONTRACT_DETAIL_VIEW_KEY, next);
    });
  }

  const tabs = useMemo<PageHeaderTab[]>(
    () => [
      { id: "overview", label: "Overview" },
      ...(isCreate
        ? []
        : [
            { id: "lineItems", label: "Line items", count: lineItems.length },
            { id: "coverage", label: "Article coverage", count: ruleCount },
            { id: "assets", label: "Assets", count: openContractAssets.length },
            ...(showQuotes ? [{ id: "quotes", label: "Quotes", count: quotes?.length ?? 0 }] : []),
          ]),
    ],
    [isCreate, lineItems.length, ruleCount, openContractAssets.length, showQuotes, quotes?.length],
  );

  useEffect(() => {
    if (!tabs.some((entry) => entry.id === tab)) setTab("overview");
  }, [tabs, tab]);

  // ---- Live panel -----------------------------------------------------------
  const livePanel = useMemo(
    () =>
      contract
        ? getLivePanel(
            {
              contract: {
                ...contract,
                end_date: saved.endDate || null,
                start_date: saved.startDate || contract.start_date,
                auto_renew: saved.autoRenew,
              },
              canUpdate: !readOnly,
              canSeeQuotes: showQuotes,
              missingBaselineCount: missingBaseline.length,
              onActivate: statusActions.activate,
              onCancelEnding: statusActions.cancelEnding,
              onExtend: () => {
                selectTab("overview");
                edit.startEdit();
              },
              onShowQuotes: () => selectTab("quotes"),
            },
            null,
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      contract,
      saved.endDate,
      saved.startDate,
      saved.autoRenew,
      readOnly,
      showQuotes,
      edit.startEdit,
      missingBaseline.length,
      statusActions.activate,
      statusActions.cancelEnding,
    ],
  );

  // ---- Header ---------------------------------------------------------------
  const title = isCreate
    ? "New contract"
    : contractTitle({ contract_number: contract?.contract_number ?? "Contract", external_reference: saved.externalReference });

  const badges: PageHeaderBadge[] = [];
  if (!isCreate) {
    const storedStatus = contract?.status ?? "active";
    const statusVariant: WebBadgeVariant = CONTRACT_STATUS_TONE[storedStatus];
    badges.push({ label: CONTRACT_STATUS_LABEL[storedStatus], variant: statusVariant });
    if (storedStatus === "active" && status.phase === "active" && status.daysToEnd !== null && status.daysToEnd <= ENDING_SOON_DAYS && !saved.autoRenew) {
      badges.push({
        label: status.daysToEnd === 0 ? "Ends today" : `Ends in ${pluralDays(status.daysToEnd)}`,
        variant: "warning",
      });
    }
    if (typeLabel) {
      // Classification: always neutral on the dark header (DS PageHeader).
      badges.push({ label: typeLabel });
    }
    if (slaLabel) badges.push({ label: slaLabel });
    if (saved.autoRenew) badges.push({ label: "Auto-renews" });
  }

  const overflow: WebMenuItem[] = [...statusActions.overflow];
  if (canDelete && contract) {
    if (overflow.length > 0) overflow.push({ type: "separator", key: "sep-delete" });
    overflow.push({ key: "delete", label: "Delete contract", danger: true, onSelect: () => setDeleteOpen(true) });
  }

  const breadcrumb = isCreate
    ? lockedClientId && client
      ? [{ label: "Clients", href: "/clients" }, { label: client.name, href: `/clients/${client.id}` }, { label: "New contract" }]
      : [{ label: "Contracts", href: "/contracts" }, { label: "New contract" }]
    : [{ label: "Contracts", href: "/contracts" }, { label: contract?.contract_number ?? "Contract", mono: true }];

  const header = (
    <PageHeader
      breadcrumb={breadcrumb}
      title={title}
      badges={badges}
      mode={edit.mode}
      actions={{
        canEdit: !isCreate && !readOnly && tab === "overview",
        onEdit: edit.startEdit,
        overflow,
        onSave: () => void edit.save(),
        onCancel: edit.requestCancel,
        saving: edit.saving,
        saveLabel: isCreate ? "Create contract" : "Save",
      }}
      tabs={tabs}
      activeTab={tab}
      onTabChange={(id) => selectTab(id as ContractDetailTab)}
      tabsLabel="Contract sections"
      editStatus={edit.status}
    />
  );

  // ---- Timeline -------------------------------------------------------------
  const timeline = useMemo(
    () => (contract ? buildContractTimeline({ contract, lineItems, contractAssets, quotes }) : []),
    [contract, lineItems, contractAssets, quotes],
  );

  // ---- Rail -----------------------------------------------------------------
  const interval = contract?.billing_terms?.interval_months ?? null;
  const cadence = contract?.billing_terms
    ? interval
      ? interval === 1
        ? "Every month"
        : `Every ${interval} months`
      : "Non-recurring"
    : null;

  const settlement = useMemo(() => {
    if (!contract || contract.status !== "active" || !counterInfo.hasCounterLines) return null;
    const schedule = describeSettlementSchedule({
      startDate: contract.start_date,
      endDate: contract.end_date,
      timing: contract.invoicing_timing,
      intervalMonths: contract.billing_terms?.interval_months ?? null,
      frequency: contract.counter_settlement_frequency,
      settlementMonth: contract.counter_settlement_month,
      invoicedPeriodCount: contract.invoiced_period_count,
      lastSettledEnd: contract.last_settled_end ?? null,
      today: todayIso(),
    });
    return { nextSettlementDate: schedule.nextSettlementDate, currentWindow: schedule.currentWindow };
  }, [contract, counterInfo.hasCounterLines]);

  const rail =
    isCreate || !contract ? (
      <SidebarSection title="After creating">
        <p className="web-rail-empty">
          The contract opens on its own page. Add line items, article coverage rules and covered assets from the tabs
          there.
        </p>
      </SidebarSection>
    ) : (
      <ContractRail
        livePanel={livePanel}
        startDate={saved.startDate || contract.start_date}
        endDate={saved.endDate || null}
        autoRenew={saved.autoRenew}
        nextInvoiceDate={contract.next_invoice_date}
        cadence={cadence}
        invoicedPeriodCount={contract.invoiced_period_count}
        settlement={settlement}
        lineItemCount={lineItems.length}
        lineItemTotal={lineItemTotal}
        coveredAssetCount={openContractAssets.length}
        coveredSiteCount={coveredSiteCount}
        onShowLineItems={() => selectTab("lineItems")}
        onShowAssets={() => selectTab("assets")}
      />
    );

  const ids = webTabIds(tab);

  return (
    <WebPage>
      <WebDetailLayout
        header={header}
        rail={rail}
        timeline={{
          items: timeline,
          emptyText: isCreate ? "The timeline starts once this record is created." : "No activity yet",
        }}
        locked={editing && !isCreate}
        mainProps={{ role: "tabpanel", id: ids.panel, "aria-labelledby": ids.tab }}
      >
        {tab === "overview" && (
          <div className="web-tab-stack">
            {!isCreate && metersEnabled && contract?.status === "draft" ? <ContractBaselineCard missing={missingBaseline} /> : null}
            {!isCreate && contract?.status === "ended" && finalBalance ? (
              <ContractFinalBalanceCard summary={finalBalance} canSeeQuotes={showQuotes} />
            ) : null}
            <ContractOverviewCards
              edit={edit}
              contract={contract}
              client={client}
              clients={clients}
              lists={lists}
              lockedClientId={lockedClientId}
              isNew={isCreate}
              counterInfo={isCreate ? undefined : counterInfo}
            />
          </div>
        )}

        {tab === "lineItems" && contract && (
          <ContractLineItemsPanel
            contractId={contract.id}
            lineItems={lineItems}
            articles={articles}
            counterOptions={counterOptions}
            billing={{
              periodLabel: contract.billing_period?.label ?? null,
              periodMonths: billingPeriodMonths(contract.billing_period),
              termsLabel: contract.billing_terms?.label ?? null,
              termsMonths: contract.billing_terms?.interval_months ?? null,
            }}
            canCreate={canCreate}
            canUpdate={canUpdate}
            canDelete={canDelete}
          />
        )}

        {tab === "coverage" && contract && (
          <ContractCoveragePanel
            contractId={contract.id}
            articleGroups={articleGroups}
            articles={articles}
            groupRules={groupRules}
            articleRules={articleRules}
            canCreate={canCreate}
            canDelete={canDelete}
          />
        )}

        {tab === "assets" && contract && (
          <ContractAssetsPanel
            contractId={contract.id}
            contractStatus={contract.status}
            contractAssets={contractAssets}
            clientAssets={clientAssets}
            siteLabelById={siteLabelById}
            canLink={canCreate}
            canUnlink={canDelete}
          />
        )}

        {tab === "quotes" && quotes && <ContractQuotesPanel quotes={quotes} />}
      </WebDetailLayout>

      <EditDiscardDialog confirm={edit.confirm} />
      {!isCreate && contract ? statusActions.dialogs : null}

      {!isCreate && contract && deleteOpen && (
        <DeleteContractDialog contract={contract} open onOpenChange={setDeleteOpen} redirectOnDelete />
      )}
    </WebPage>
  );
}
