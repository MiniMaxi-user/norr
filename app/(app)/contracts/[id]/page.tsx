import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { preferencesStore } from "@/lib/preferences/cookie-store";
import {
  getContract,
  listContractAssets,
  listContractArticleGroupRules,
  listContractArticleRules,
  listContractLineItems,
  listContractCounterOptions,
} from "../actions";
import { getClient } from "@/app/(app)/clients/actions";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";
import { listAssets } from "@/app/(app)/assets/actions";
import { listArticleGroups } from "@/app/(app)/articles/groups-actions";
import { listArticlesForSelect } from "@/app/(app)/articles/actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { listQuotesForContract } from "@/app/(app)/quotes/contract-quote-actions";
import { ContractScreen, type ContractDetailTab } from "../components/contract-screen";
import { CONTRACT_DETAIL_VIEW_KEY } from "../components/constants";

export const metadata = { title: "Contract details" };

interface ContractDetailPageProps {
  params: Promise<{ id: string }>;
  /** `?tab=assets` etc. deep-links straight to a tab. */
  searchParams: Promise<{ tab?: string }>;
}

/** High enough for "every asset of this contract's client" in one request —
 * a contract detail page is a bounded, per-record view, same reasoning as
 * `ALL_CLIENT_ASSETS_LIMIT` in `app/(app)/clients/[id]/page.tsx`. */
const ALL_CLIENT_ASSETS_LIMIT = 500;

const TAB_IDS: ContractDetailTab[] = ["overview", "lineItems", "coverage", "assets", "quotes"];

/**
 * Contract detail page — renders the shared `ContractScreen` (web design
 * system, issue #222) in read mode, with one Edit button for a caller with
 * update rights. Same "fetch once, pass down" convention every other module's
 * detail page uses: every list below is fetched once here and handed to the
 * screen as props. `hasFeature()`/RBAC are resolved before anything renders;
 * the Quotes tab only exists for a caller who can see the Quotes module.
 */
export default async function ContractDetailPage({ params, searchParams }: ContractDetailPageProps) {
  const { id } = await params;
  const { tab: requestedTab } = await searchParams;

  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "contracts"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "contracts")) notFound();

  const contractResult = await getContract(id);
  if (!contractResult.data) notFound();
  const contract = contractResult.data.contract;

  // Quotes tab (issue #211) - only for callers who can see the Quotes module.
  const canSeeQuotes = (await hasFeature(session.organization, "quotes")) && canAccessModule(actor, "quotes");

  const [
    clientResult,
    contractAssetsResult,
    clientAssetsResult,
    lineItemsResult,
    counterOptionsResult,
    groupRulesResult,
    articleRulesResult,
    articleGroupsResult,
    articlesResult,
    contractTypesResult,
    slaTiersResult,
    billingTermsResult,
    billingPeriodsResult,
    quotesResult,
    lastUsedTab,
  ] = await Promise.all([
    getClient(contract.client_id),
    listContractAssets(contract.id),
    listAssets({ clientId: contract.client_id, limit: ALL_CLIENT_ASSETS_LIMIT }),
    listContractLineItems(contract.id),
    listContractCounterOptions(contract.id),
    listContractArticleGroupRules(contract.id),
    listContractArticleRules(contract.id),
    listArticleGroups(),
    listArticlesForSelect(),
    listReferenceItems("contract_type"),
    listReferenceItems("sla_tier"),
    listReferenceItems("billing_terms"),
    listReferenceItems("billing_period"),
    canSeeQuotes ? listQuotesForContract(contract.id) : Promise.resolve(null),
    preferencesStore.getLastUsedView(session.userId, CONTRACT_DETAIL_VIEW_KEY),
  ]);

  const client = clientResult.data?.client ?? null;
  const sites = clientResult.data?.sites ?? [];
  const siteLabelById = new Map(sites.map((site) => [site.id, formatSiteAddressShort(site)]));
  const quotes = canSeeQuotes ? (quotesResult?.data?.quotes ?? []) : null;

  // `?tab=` (explicit deep link) beats the last-used-view cookie; either falls
  // back to Overview when that tab does not exist for this caller.
  const available = (raw: string | null | undefined): ContractDetailTab | null => {
    if (!raw || !TAB_IDS.includes(raw as ContractDetailTab)) return null;
    if (raw === "quotes") return quotes ? "quotes" : null;
    return raw as ContractDetailTab;
  };

  return (
    <ContractScreen
      mode="edit"
      contract={contract}
      client={client}
      lists={{
        contractTypes: contractTypesResult.data?.items ?? [],
        slaTiers: slaTiersResult.data?.items ?? [],
        billingTerms: billingTermsResult.data?.items ?? [],
        billingPeriods: billingPeriodsResult.data?.items ?? [],
      }}
      readOnly={!can(actor, "contracts", "update")}
      canCreate={can(actor, "contracts", "create")}
      canUpdate={can(actor, "contracts", "update")}
      canDelete={can(actor, "contracts", "delete")}
      lineItems={lineItemsResult.data?.lineItems ?? []}
      counterOptions={counterOptionsResult.data?.counters ?? []}
      articles={articlesResult.data?.articles ?? []}
      articleGroups={articleGroupsResult.data?.groups ?? []}
      groupRules={groupRulesResult.data?.rules ?? []}
      articleRules={articleRulesResult.data?.rules ?? []}
      contractAssets={contractAssetsResult.data?.contractAssets ?? []}
      clientAssets={clientAssetsResult.data?.assets ?? []}
      siteLabelById={siteLabelById}
      quotes={quotes}
      defaultTab={available(requestedTab) ?? available(lastUsedTab) ?? "overview"}
    />
  );
}
