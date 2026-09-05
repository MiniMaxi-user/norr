import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import {
  getContract,
  listContractAssets,
  listContractArticleGroupRules,
  listContractArticleRules,
  listContractLineItems,
} from "../actions";
import { getClient, listClients } from "@/app/(app)/clients/actions";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";
import { listAssets } from "@/app/(app)/assets/actions";
import { listArticleGroups } from "@/app/(app)/articles/groups-actions";
import { listArticlesForSelect } from "@/app/(app)/articles/actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { ContractScreen } from "../components/contract-screen";

export const metadata = { title: "Contract details" };

interface ContractDetailPageProps {
  params: Promise<{ id: string }>;
}

/** High enough for "every asset of this contract's client" in one request —
 * a contract detail page is a bounded, per-record view, same reasoning as
 * `ALL_CLIENT_ASSETS_LIMIT` in `app/(app)/clients/[id]/page.tsx`/
 * `app/(app)/work-orders/components/work-order-form.tsx`. */
const ALL_CLIENT_ASSETS_LIMIT = 500;

/**
 * Contract detail/edit page — one unified screen (issue #122, superseding the
 * separate `/contracts/[id]/edit` route) rendered by `ContractScreen` with
 * `mode="edit"`: a `RecordHeroBand`, inline-editable Contract details/Terms/
 * Dates/Notes sections, and the contract's own sub-entities (Line items,
 * Article coverage, Linked assets — all edit-mode-only, nothing to manage
 * before the contract exists). Same "fetch once, pass down" convention every
 * other module's detail page uses — every list below is fetched once here
 * and handed to `ContractScreen` as props, never re-fetched client-side.
 */
export default async function ContractDetailPage({ params }: ContractDetailPageProps) {
  const { id } = await params;

  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "contracts"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "contracts")) notFound();

  const contractResult = await getContract(id);
  if (!contractResult.data) notFound();
  const contract = contractResult.data.contract;

  const [
    clientResult,
    clientsResult,
    contractAssetsResult,
    clientAssetsResult,
    lineItemsResult,
    groupRulesResult,
    articleRulesResult,
    articleGroupsResult,
    articlesResult,
    contractTypesResult,
    slaTiersResult,
    billingTermsResult,
    billingPeriodsResult,
  ] = await Promise.all([
    getClient(contract.client_id),
    listClients({ limit: 200 }),
    listContractAssets(contract.id),
    listAssets({ clientId: contract.client_id, limit: ALL_CLIENT_ASSETS_LIMIT }),
    listContractLineItems(contract.id),
    listContractArticleGroupRules(contract.id),
    listContractArticleRules(contract.id),
    listArticleGroups(),
    listArticlesForSelect(),
    listReferenceItems("contract_type"),
    listReferenceItems("sla_tier"),
    listReferenceItems("billing_terms"),
    listReferenceItems("billing_period"),
  ]);

  const client = clientResult.data?.client ?? null;
  const clients = clientsResult.data?.clients ?? [];
  const sites = clientResult.data?.sites ?? [];
  const siteLabelById = new Map(sites.map((site) => [site.id, formatSiteAddressShort(site)]));
  const contractAssets = contractAssetsResult.data?.contractAssets ?? [];
  const clientAssets = clientAssetsResult.data?.assets ?? [];
  const lineItems = lineItemsResult.data?.lineItems ?? [];
  const groupRules = groupRulesResult.data?.rules ?? [];
  const articleRules = articleRulesResult.data?.rules ?? [];
  const articleGroups = articleGroupsResult.data?.groups ?? [];
  const articles = articlesResult.data?.articles ?? [];
  const contractTypes = contractTypesResult.data?.items ?? [];
  const slaTiers = slaTiersResult.data?.items ?? [];
  const billingTerms = billingTermsResult.data?.items ?? [];
  const billingPeriods = billingPeriodsResult.data?.items ?? [];

  const canCreate = can(actor, "contracts", "create");
  const canUpdate = can(actor, "contracts", "update");
  const canDelete = can(actor, "contracts", "delete");

  const breadcrumbItems = [{ label: "Contracts", href: "/contracts" }, { label: contract.name }];

  return (
    <ContractScreen
      mode="edit"
      breadcrumbItems={breadcrumbItems}
      contract={contract}
      client={client}
      clients={clients}
      cancelHref="/contracts"
      contractTypes={contractTypes}
      slaTiers={slaTiers}
      billingTerms={billingTerms}
      billingPeriods={billingPeriods}
      readOnly={!canUpdate}
      canCreate={canCreate}
      canUpdate={canUpdate}
      canDelete={canDelete}
      lineItems={lineItems}
      articles={articles}
      articleGroups={articleGroups}
      groupRules={groupRules}
      articleRules={articleRules}
      contractAssets={contractAssets}
      clientAssets={clientAssets}
      siteLabelById={siteLabelById}
    />
  );
}
