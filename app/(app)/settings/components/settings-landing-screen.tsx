import { countReferenceListItemsByKey } from "@/lib/reference-lists/actions";
import { listAssetModels } from "@/lib/asset-models/actions";
import { listArticleGroups } from "@/app/(app)/articles/groups-actions";
import { listChecklistTemplates } from "@/lib/checklist-templates/actions";
import { listTeamMembers } from "@/lib/team/actions";
import { listAccountManagers } from "@/lib/account-managers/actions";
import { SETTINGS_NAV_GROUPS } from "./settings-nav-items";
import { SettingsLandingView } from "./settings-landing-view";

/**
 * Data-fetching heart of the Settings landing page (design handoff "Settings
 * landing redesign", option 2a) — rendered inside a `Suspense` boundary by
 * `app/(app)/settings/page.tsx` so the shell paints immediately (same
 * "Server Component resolves the gate, a Screen component streams in the
 * data" shape `app/(app)/work-orders/page.tsx`'s `WorkOrdersScreen` uses).
 *
 * Resolves ONE aggregate query per settings-group data source (6 sources
 * covering all 21 `SettingsNavItem`s), in parallel — not one query per item:
 *  - 14 reference-list-backed items: `countReferenceListItemsByKey` (one
 *    query for all 14 at once — see that function's own doc comment).
 *  - `asset_models` / `article_groups` / `checklist_templates` / `team` /
 *    `account_managers`: each already has its own "list everything" action
 *    that's a single query; `.length` on the result is this source's count.
 *
 * Every count arrives together before anything renders (this whole screen
 * is the one thing behind the page's `Suspense` boundary), so
 * `SettingsLandingView` never needs a per-pill loading state — counts are
 * simply absent from the `counts` map (no pill rendered) until this
 * `Promise.all` resolves, never a misleading `0`.
 */
export async function SettingsLandingScreen() {
  const [referenceCountsResult, assetModelsResult, articleGroupsResult, checklistTemplatesResult, teamResult, accountManagersResult] =
    await Promise.all([
      countReferenceListItemsByKey(),
      listAssetModels(),
      listArticleGroups(),
      listChecklistTemplates(),
      listTeamMembers(),
      listAccountManagers(),
    ]);

  const counts: Record<string, number> = { ...(referenceCountsResult.data?.counts ?? {}) };
  if (assetModelsResult.data) counts.asset_models = assetModelsResult.data.models.length;
  if (articleGroupsResult.data) counts.article_groups = articleGroupsResult.data.groups.length;
  if (checklistTemplatesResult.data) counts.checklist_templates = checklistTemplatesResult.data.templates.length;
  // Active members only — the safe default for what "Team" means here (see
  // this story's own brief); pending invites aren't part of this count.
  if (teamResult.data) counts.team = teamResult.data.members.length;
  if (accountManagersResult.data) counts.account_managers = accountManagersResult.data.accountManagers.length;

  const totalItems = SETTINGS_NAV_GROUPS.flatMap((group) => group.items).length;
  const totalGroups = SETTINGS_NAV_GROUPS.length;

  return <SettingsLandingView counts={counts} totalItems={totalItems} totalGroups={totalGroups} />;
}
