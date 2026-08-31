import { SectionHeader, Stack, Text } from "@yourorg/ui";
import { Settings } from "@yourorg/ui/icons";
import { getCurrentSession } from "@/lib/auth/session";
import { can, type PermissionActor } from "@/lib/rbac/permissions";
import { listArticleGroups } from "@/app/(app)/articles/groups-actions";
import { getSettingsGroupIcon } from "../components/settings-nav-items";
import { ArticleGroupManager } from "../components/article-group-manager";

export const metadata = { title: "Article Groups" };

/**
 * Promoted out of the old Reference Lists tab board into its own top-level
 * leaf (issue #110, Settings admin shell stage 3) — same shape as
 * `../asset-models/page.tsx`. The `"settings"` feature/module gate already
 * ran in `app/(app)/settings/layout.tsx`.
 *
 * Article Groups are gated on the `articles` RBAC module, not `settings` —
 * `articles` is the one module where `administratie` also gets full CRUD
 * (not just `owner`), unlike every other leaf under Settings. Preserved from
 * the old board's `page.tsx` (see its `canWriteArticleGroups` comment,
 * pre-issue-#110): `canWriteArticleGroups` is deliberately NOT the generic
 * `settings`-based `canWrite` used elsewhere in this module.
 */
export default async function ArticleGroupsPage() {
  const session = await getCurrentSession();
  const actor: PermissionActor = { role: session?.role ?? null, isPlatformAdmin: session?.isPlatformAdmin ?? false };
  const canWriteArticleGroups = can(actor, "articles", "create");

  const result = await listArticleGroups();

  return (
    <Stack gap="lg">
      <SectionHeader icon={getSettingsGroupIcon("article_groups") ?? Settings} title="Article Groups" />
      <Text tone="muted">
        Hierarchical categories for your article catalog — group articles into nested categories for browsing and
        reporting.
      </Text>
      <ArticleGroupManager
        groups={result.data?.groups ?? []}
        loadError={result.error}
        canWrite={canWriteArticleGroups}
      />
    </Stack>
  );
}
