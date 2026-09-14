"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, BackLink, Badge, Button, Card, Heading, Inline, Stack, Text } from "@yourorg/ui";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { TeamMemberRecord } from "@/lib/team/actions";
import { roleLabel } from "../components/role-label";
import { DefaultServiceAreaSection } from "./default-service-area-section";
import { FullNameSection } from "./full-name-section";
import { RateOverridesSection } from "./rate-overrides-section";
import { ServiceAreasSection } from "./service-areas-section";

export interface TeamMemberDetailProps {
  member: TeamMemberRecord;
  /** `listArticlesForSelect()`'s result, fetched once by `page.tsx` — only
   * actually consumed by `RateOverridesSection`, which only renders for an
   * `engineer` row (fetched unconditionally either way, same "ready the
   * moment it's needed" convention `team-board.tsx` already follows). */
  articles: ArticleSelectOption[];
  /** `listReferenceItems("region")`'s result, fetched once by `page.tsx` —
   * feeds both `DefaultServiceAreaSection` and `ServiceAreasSection`. */
  regions: ReferenceListItemRecord[];
  /** `can(actor, "settings", "update")`, owner-only per the `settings` RBAC
   * row — a non-owner sees every section read-only (no Edit pencil), same
   * `readOnly` convention `WarehouseScreen`/`ContractScreen` already use. */
  canWrite: boolean;
  currentUserId: string;
}

/**
 * A single team member's detail page (issue #192, plus a follow-up that
 * removed `EditTeamMemberDialog` entirely) — header (avatar, name, email,
 * role) plus four independently-editable config sections: Name (the last
 * field that still lived in the now-removed dialog), Rate overrides (issue
 * #93, engineer-only), Default Service Area, and Service Areas (issue #192,
 * new — the ADDITIONAL work regions a membership carries via
 * `membership_work_regions`, independent of the single default above). Each
 * section saves itself immediately via its own server action call, same
 * "immediate section-scoped save, no page-wide Save/Cancel" convention
 * `ClientDetailsTab`'s sections already establish — this page just owns a
 * thin local echo of `member` so a save can patch state without a full
 * `router.refresh()`.
 *
 * Deliberately NOT the `Tabs`-driven relational-detail-page shape
 * `client-detail.tsx` uses — a team member has no child/parent record
 * relationships of its own (only flat config fields), so a plain
 * single-column `Stack` of sections is the right weight here per
 * docs/ARCHITECTURE.md's "Relational detail pages" standard (that standard
 * is about surfacing REAL relationships, not a mandate to always use
 * `Tabs`). A single `BackLink` back to the Team list is enough too — this
 * page sits exactly one level deep (Team -> this member), not the two-plus
 * levels that would warrant a full `Breadcrumbs` trail.
 */
export function TeamMemberDetail({ member: initialMember, articles, regions, canWrite, currentUserId }: TeamMemberDetailProps) {
  const router = useRouter();
  const [member, setMember] = useState(initialMember);
  const isEngineer = member.role === "engineer";
  const isSelf = member.userId === currentUserId;
  const readOnly = !canWrite;

  function handleViewWarehouse() {
    if (!member.warehouseId) return;
    router.push(`/inventory/${member.warehouseId}`);
  }

  return (
    <Stack gap="lg">
      <BackLink href="/settings/team">Back to Team</BackLink>

      <Card>
        <Inline gap="md" align="center" justify="between">
          <Inline gap="md" align="center">
            <Avatar name={member.fullName || member.email} size="lg" photoUrl={member.avatarUrl} />
            <Stack gap="xs">
              <Inline gap="sm" align="center">
                <Heading level={1}>{member.fullName || member.email}</Heading>
                {isSelf && <Badge variant="muted">You</Badge>}
              </Inline>
              <Inline gap="sm" align="center">
                <Text tone="muted">{member.email}</Text>
                <Badge variant="muted">{roleLabel(member.role)}</Badge>
              </Inline>
            </Stack>
          </Inline>

          {isEngineer &&
            (member.warehouseId ? (
              <Button type="button" variant="outline" size="sm" onClick={handleViewWarehouse}>
                View warehouse
              </Button>
            ) : (
              <Text tone="muted">Warehouse is being created…</Text>
            ))}
        </Inline>
      </Card>

      <FullNameSection
        userId={member.userId}
        fullName={member.fullName}
        readOnly={readOnly}
        onSaved={(fullName) => setMember((prev) => ({ ...prev, fullName }))}
      />

      {isEngineer && (
        <RateOverridesSection
          userId={member.userId}
          rateSettings={member.rateSettings}
          articles={articles}
          readOnly={readOnly}
          onSaved={(rateSettings) => setMember((prev) => ({ ...prev, rateSettings }))}
        />
      )}

      <DefaultServiceAreaSection
        userId={member.userId}
        regionId={member.regionId}
        regions={regions}
        readOnly={readOnly}
        onSaved={(regionId) => setMember((prev) => ({ ...prev, regionId }))}
      />

      <ServiceAreasSection
        userId={member.userId}
        regionIds={member.workRegionIds}
        regions={regions}
        readOnly={readOnly}
        onSaved={(workRegionIds) => setMember((prev) => ({ ...prev, workRegionIds }))}
      />
    </Stack>
  );
}
