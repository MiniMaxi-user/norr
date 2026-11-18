import type { DirtyField, EditSchema, SaveResult } from "@yourorg/ui/web-client";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import {
  updateTeamMemberProfile,
  updateTeamMemberRateSettings,
  updateTeamMemberRegion,
  updateTeamMemberWorkRegions,
  type TeamMemberRecord,
} from "@/lib/team/actions";

/**
 * The team member page's editable fields as one flat draft (`useEditMode`,
 * issue #222): Name, Default Service Area, the engineer's rate override and
 * one checkbox per Service Area (work region). Values are plain
 * strings/booleans, converted at the save boundary. A `Record` (not a fixed
 * object type) because the Service Area checkboxes are one key per
 * `region` reference item (`area:<id>`).
 */
export type TeamMemberDraft = Record<string, string | boolean>;

const AREA_PREFIX = "area:";
export const areaKey = (regionId: string) => `${AREA_PREFIX}${regionId}`;

const NAME_MAX = 200;

const PROFILE_KEYS = ["fullName"] as const;
const REGION_KEYS = ["regionId"] as const;
const RATE_KEYS = ["hasCustomRate", "travelArticleId", "workArticleId", "travelSalePrice", "workSalePrice"] as const;

export function draftFromMember(member: TeamMemberRecord, regions: ReferenceListItemRecord[]): TeamMemberDraft {
  const draft: TeamMemberDraft = {
    fullName: member.fullName ?? "",
    regionId: member.regionId ?? "",
    hasCustomRate: member.rateSettings.hasCustomRate,
    travelArticleId: member.rateSettings.travelArticleId ?? "",
    workArticleId: member.rateSettings.workArticleId ?? "",
    travelSalePrice: member.rateSettings.travelSalePrice != null ? String(member.rateSettings.travelSalePrice) : "",
    workSalePrice: member.rateSettings.workSalePrice != null ? String(member.rateSettings.workSalePrice) : "",
  };
  for (const region of regions) draft[areaKey(region.id)] = member.workRegionIds.includes(region.id);
  return draft;
}

function checkMoney(label: string, raw: string, example: string): string | null {
  const value = String(raw).trim();
  if (!value) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `Enter ${label.toLowerCase()} as a number, for example ${example}`;
  if (amount < 0) return `${label} cannot be negative. Enter zero or more`;
  return null;
}

export function articleOptionLabel(article: ArticleSelectOption) {
  return `${article.article_number} — ${article.description}`;
}

export function buildTeamMemberSchema(options: {
  regions: ReferenceListItemRecord[];
  articles: ArticleSelectOption[];
}): EditSchema<TeamMemberDraft> {
  const { regions, articles } = options;
  const regionLabel = (id: string) => regions.find((region) => region.id === id)?.label ?? "";
  const articleLabel = (id: string) => {
    const article = articles.find((candidate) => candidate.id === id);
    return article ? articleOptionLabel(article) : "";
  };
  const schema: EditSchema<TeamMemberDraft> = {
    fullName: {
      label: "Full name",
      required: true,
      validate: (value) => {
        const text = String(value).trim();
        if (!text) return "Enter a name for this teammate";
        if (text.length > NAME_MAX) return `Name is ${text.length} characters, the maximum is ${NAME_MAX}. Shorten it`;
        return null;
      },
    },
    regionId: {
      label: "Default Service Area",
      format: (value) => (value ? regionLabel(String(value)) : ""),
    },
    hasCustomRate: { label: "Custom rate", format: (value) => (value ? "on" : "off") },
    travelArticleId: {
      label: "Travel article",
      format: (value) => (value ? articleLabel(String(value)) : ""),
      validate: (value, draft) =>
        draft.hasCustomRate && !value ? "Choose a travel article, or turn off custom rate" : null,
    },
    travelSalePrice: {
      label: "Travel sale price",
      validate: (value, draft) => {
        if (!draft.hasCustomRate) return null;
        if (!String(value).trim()) return "Enter a travel sale price, for example 85.00";
        return checkMoney("Travel sale price", String(value), "85.00");
      },
    },
    workArticleId: {
      label: "Work article",
      format: (value) => (value ? articleLabel(String(value)) : ""),
      validate: (value, draft) => (draft.hasCustomRate && !value ? "Choose a work article, or turn off custom rate" : null),
    },
    workSalePrice: {
      label: "Work sale price",
      validate: (value, draft) => {
        if (!draft.hasCustomRate) return null;
        if (!String(value).trim()) return "Enter a work sale price, for example 95.00";
        return checkMoney("Work sale price", String(value), "95.00");
      },
    },
  };
  for (const region of regions) {
    schema[areaKey(region.id)] = { label: `Service Area ${region.label}`, format: (value) => (value ? "assigned" : "not assigned") };
  }
  return schema;
}

function firstFieldErrors(fieldErrors: Record<string, string[] | undefined> | undefined) {
  const mapped: Record<string, string> = {};
  for (const [key, messages] of Object.entries(fieldErrors ?? {})) {
    if (messages?.[0]) mapped[key] = messages[0];
  }
  return mapped;
}

/**
 * Persists an edited team member through the EXISTING server actions (RBAC,
 * zod and RLS stay there): only the groups whose fields changed are sent —
 * name, default Service Area, rate override (engineers) and the Service Area
 * set (full replace). The first failing action stops the save and its error
 * lands on the matching row.
 */
export async function saveTeamMemberEdits(
  member: TeamMemberRecord,
  regions: ReferenceListItemRecord[],
  draft: TeamMemberDraft,
  dirty: DirtyField<TeamMemberDraft>[],
): Promise<SaveResult<TeamMemberDraft>> {
  const dirtyKeys = new Set<string>(dirty.map((entry) => entry.key));
  const userId = member.userId;

  if (PROFILE_KEYS.some((key) => dirtyKeys.has(key))) {
    const result = await updateTeamMemberProfile(userId, { fullName: String(draft.fullName) });
    if (!result.data) return { ok: false, error: result.error, fieldErrors: firstFieldErrors(result.fieldErrors) };
  }

  if (REGION_KEYS.some((key) => dirtyKeys.has(key))) {
    const result = await updateTeamMemberRegion(userId, draft.regionId ? String(draft.regionId) : null);
    if (result.error) return { ok: false, error: result.error };
  }

  if (member.role === "engineer" && RATE_KEYS.some((key) => dirtyKeys.has(key))) {
    const result = await updateTeamMemberRateSettings(userId, {
      hasCustomRate: Boolean(draft.hasCustomRate),
      travelArticleId: draft.travelArticleId || undefined,
      workArticleId: draft.workArticleId || undefined,
      travelSalePrice: draft.travelSalePrice || undefined,
      workSalePrice: draft.workSalePrice || undefined,
    });
    if (!result.data) return { ok: false, error: result.error, fieldErrors: firstFieldErrors(result.fieldErrors) };
  }

  if (regions.some((region) => dirtyKeys.has(areaKey(region.id)))) {
    const ids = regions.filter((region) => Boolean(draft[areaKey(region.id)])).map((region) => region.id);
    const result = await updateTeamMemberWorkRegions(userId, ids);
    if (!result.data) return { ok: false, error: result.error ?? "Could not save Service Areas." };
  }

  return { ok: true };
}
