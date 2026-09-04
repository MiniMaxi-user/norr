import Link from "next/link";
import { Badge, RowCard, SectionHeader, Stack, Text } from "@yourorg/ui";
import { Clock } from "@yourorg/ui/icons";
import { formatDate } from "@/lib/format/date";

export interface RecentAssetActivityItem {
  key: string;
  kind: "activity" | "workorder";
  href: string;
  title: string;
  /** Plain `YYYY-MM-DD`/ISO date string — whichever the source record uses
   * (`reported_at` for an Activity, `scheduled_at ?? created_at` for a Work
   * Order), formatted the same either way. */
  date: string | null;
}

export interface AssetRecentActivitiesProps {
  items: RecentAssetActivityItem[];
  /** Omitted entirely when there is truly nowhere for it to go — `/assets/[id]`
   * itself has no tabs today, so "View all" links into the CLIENT's own
   * filtered lists instead (same deep-link-to-a-filtered-parent-view pattern
   * `WorkOrderRelationCards`'s Site card already uses for Sites' own missing
   * detail route) whenever a client id is known; there is genuinely no
   * destination in create mode (no asset, no guaranteed client yet either). */
  viewAllHref?: string;
}

/**
 * "Recent activities" (asset new/edit design handoff v3) — a merged,
 * date-sorted feed of this asset's own Activities and Work Orders, same
 * `RowCard` (badge + `.ui-row-main` title link + trailing fact) shape
 * `ActivityLinkedWorkOrders` already establishes for a comparable list. No
 * other merged-feed precedent exists elsewhere in the codebase (`Timeline` is
 * a day-by-resource scheduling grid, unrelated) — kept deliberately simple:
 * the caller (`[id]/page.tsx`) fetches both lists server-side, merges, sorts
 * by date and takes the top handful; this component only renders the result.
 */
export function AssetRecentActivities({ items, viewAllHref }: AssetRecentActivitiesProps) {
  return (
    <Stack gap="sm">
      <SectionHeader
        icon={Clock}
        title="Recent activities"
        actions={viewAllHref ? <Link href={viewAllHref}>View all</Link> : undefined}
      />
      {items.length === 0 ? (
        <Text tone="muted">Nothing logged against this asset yet.</Text>
      ) : (
        <Stack gap="xs">
          {items.map((item) => (
            <RowCard key={item.key}>
              <Badge variant={item.kind === "workorder" ? "success" : "muted"}>
                {item.kind === "workorder" ? "Workorder" : "Activity"}
              </Badge>
              <Link href={item.href} className="ui-row-main ui-row-title">
                {item.title}
              </Link>
              <Text tone="muted">{formatDate(item.date)}</Text>
            </RowCard>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
