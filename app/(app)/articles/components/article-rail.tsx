"use client";

import Link from "next/link";
import { MediaTile } from "@yourorg/ui";
import { Camera } from "@yourorg/ui/icons";
import { SidebarNotice, SidebarRows, SidebarSection } from "@yourorg/ui/web";
import { formatNumberWeb } from "@/lib/format/web";
import type { ArticleParentRecord } from "../components-actions";
import { formatPriceWeb } from "./article-format";

const MAX_PARENT_LINKS = 3;

export interface ArticleRailProps {
  articleNumber: string;
  /** The saved photo URL (`""` = none: the Photo section is not rendered). */
  imageUrl: string;
  /** Saved prices and VAT percentage (`null` = not set). */
  pricing: { purchase: number | null; sale: number | null; vatPercent: number | null };
  /** Composite articles this article is a component of. */
  parents: ArticleParentRecord[];
  /** Components below this article, all levels. */
  componentCount: number;
  isComposite: boolean;
  /** Opens the Bill of materials tab (omitted when the tab does not exist). */
  onShowBom?: () => void;
}

/**
 * Right rail of the Article page (design system, issue #222): Photo (the picture
 * behind the Photo URL), Pricing (what the Details card does not show: margin
 * and the sale price incl. VAT) and Structure (only when the article is a
 * composite or part of one: the composites it is used in as links, and the
 * component count, with a link to the Bill of materials tab) — above the
 * always-last TIMELINE (added by `WebDetailLayout`). Read-only. No LivePanel:
 * the page holds no stock, deadline or running data to act on.
 */
export function ArticleRail({
  articleNumber,
  imageUrl,
  pricing,
  parents,
  componentCount,
  isComposite,
  onShowBom,
}: ArticleRailProps) {
  const { purchase, sale, vatPercent } = pricing;
  const margin = sale !== null && purchase !== null ? sale - purchase : null;
  const marginPercent = margin !== null && sale !== null && sale > 0 ? (margin / sale) * 100 : null;
  const saleInclVat = sale !== null && vatPercent !== null ? sale * (1 + vatPercent / 100) : null;
  const showPricing = margin !== null || saleInclVat !== null;
  const showStructure = isComposite || parents.length > 0;

  const shownParents = parents.slice(0, MAX_PARENT_LINKS);
  const extraParents = parents.length - shownParents.length;

  return (
    <>
      {imageUrl ? (
        <SidebarSection title="Photo">
          <MediaTile size="xl" imageUrl={imageUrl} alt={`${articleNumber} photo`} fallback={<Camera />} />
        </SidebarSection>
      ) : null}

      {showPricing ? (
        <SidebarSection title="Pricing">
          <SidebarRows
            rows={[
              {
                label: "Margin",
                value:
                  margin === null
                    ? "—"
                    : `${formatPriceWeb(margin)}${marginPercent !== null ? ` · ${formatNumberWeb(Math.round(marginPercent * 10) / 10)}%` : ""}`,
              },
              { label: "Sale incl. VAT", value: formatPriceWeb(saleInclVat) },
            ]}
          />
          {margin !== null && margin < 0 ? <SidebarNotice>The sale price is below the purchase price.</SidebarNotice> : null}
        </SidebarSection>
      ) : null}

      {showStructure ? (
        <SidebarSection title="Structure" link={onShowBom ? { label: "Bill of materials", onClick: onShowBom } : undefined}>
          <SidebarRows
            rows={[
              {
                label: "Part of",
                value:
                  parents.length > 0 ? (
                    <>
                      {shownParents.map((parent, index) => (
                        <span key={parent.id}>
                          {index > 0 ? ", " : ""}
                          {parent.parent_article ? (
                            <Link href={`/articles/${parent.parent_article.id}`}>{parent.parent_article.article_number}</Link>
                          ) : (
                            "Unknown article"
                          )}
                        </span>
                      ))}
                      {extraParents > 0 ? ` +${extraParents} more` : ""}
                    </>
                  ) : (
                    "None"
                  ),
              },
              ...(isComposite
                ? [
                    {
                      label: "Components",
                      value:
                        componentCount > 0
                          ? `${componentCount} ${componentCount === 1 ? "component" : "components"}`
                          : "None",
                    },
                  ]
                : []),
            ]}
          />
        </SidebarSection>
      ) : null}
    </>
  );
}
