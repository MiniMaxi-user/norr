"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useModuleEnabled } from "@/components/shell/module-features";
import { toast } from "@yourorg/ui";
import { WebButton, WebCard, WebCardPair, WebCardStack, WebLinkButton } from "@yourorg/ui/web";
import {
  EditDiscardDialog,
  KeyValueCard,
  useEditMode,
  type KvEditBinder,
  type KvField,
} from "@yourorg/ui/web-client";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import { formatMoneyWeb } from "@/lib/format/web";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { TeamMemberRecord } from "@/lib/team/actions";
import { roleLabel } from "../components/role-label";
import {
  areaKey,
  articleOptionLabel,
  buildTeamMemberSchema,
  draftFromMember,
  saveTeamMemberEdits,
  type TeamMemberDraft,
} from "./team-member-draft";

export interface TeamMemberDetailProps {
  member: TeamMemberRecord;
  /** `listArticlesForSelect()`, fetched once by `page.tsx`; only used by the
   * engineer's rate override. */
  articles: ArticleSelectOption[];
  /** `listReferenceItems("region")`: the Default Service Area options and the
   * Service Area checkboxes. */
  regions: ReferenceListItemRecord[];
  /** `can(actor, "settings", "update")`, owner only: a non-owner sees every
   * card read-only (no Edit button). */
  canWrite: boolean;
  currentUserId: string;
}

/**
 * A single team member's page (issue #192; design system #222) as a small
 * record detail: a Details card (name, email, role, default Service Area), the
 * Service Areas card (one checkbox per `region` item) and, for an engineer,
 * the Rate overrides card (issue #93). ONE Edit button (in the Details card
 * head, because the settings frame owns the page header) switches every card
 * to inputs at once; Save / Cancel go through `useEditMode` (Esc, Ctrl/Cmd+S,
 * "N changed", discard confirmation) and persist through the existing team
 * actions, which keep all RBAC checks. Role changes, password reset and
 * removal stay on the Team list's row menu.
 */
export function TeamMemberDetail({ member, articles, regions, canWrite, currentUserId }: TeamMemberDetailProps) {
  const router = useRouter();
  // The warehouse page only exists with the Inventory module (#247).
  const inventoryEnabled = useModuleEnabled("inventory");
  const isEngineer = member.role === "engineer";
  const isSelf = member.userId === currentUserId;

  const record = useMemo(() => draftFromMember(member, regions), [member, regions]);
  const schema = useMemo(() => buildTeamMemberSchema({ regions, articles }), [regions, articles]);

  const edit = useEditMode<TeamMemberDraft>({
    record,
    schema,
    canEdit: canWrite,
    idPrefix: "team-member",
    firstFieldKey: "fullName",
    navigate: (href) => router.push(href),
    onSave: (draft, dirty) => saveTeamMemberEdits(member, regions, draft, dirty),
    onSaved: () => {
      toast({ title: "Saved", tone: "success", duration: 3000 });
      router.refresh();
    },
  });

  const saved = edit.record;
  const articleById = useMemo(() => new Map(articles.map((article) => [article.id, article] as const)), [articles]);
  const articleName = (id: string) => {
    const article = articleById.get(id);
    return article ? articleOptionLabel(article) : "";
  };
  const regionName = (id: string) => regions.find((region) => region.id === id)?.label ?? "";

  // Picking a rate article pre-fills its sale price (existing behaviour of
  // the shared rate section) — wrap the binder rather than special-casing the
  // card.
  const rateEdit = useMemo<KvEditBinder>(
    () => ({
      get isEditing() {
        return edit.isEditing;
      },
      getField: (key: string) => {
        const binding = edit.getField(key);
        const priceKey = key === "travelArticleId" ? "travelSalePrice" : key === "workArticleId" ? "workSalePrice" : null;
        if (!priceKey) return binding;
        return {
          ...binding,
          onChange: (value) => {
            binding.onChange(value);
            const sale = typeof value === "string" ? articleById.get(value)?.sale_price : null;
            edit.setValue(priceKey, sale !== null && sale !== undefined ? String(sale) : "");
          },
        };
      },
      countsFor: (keys) => edit.countsFor(keys),
    }),
    [articleById, edit],
  );

  const actions = (
    <>
      {!edit.isEditing && isEngineer && member.warehouseId && inventoryEnabled ? (
        <WebLinkButton size="sm" href={`/inventory/${member.warehouseId}`}>
          View warehouse
        </WebLinkButton>
      ) : null}
      {edit.isEditing ? (
        <>
          <WebButton size="sm" onClick={edit.requestCancel} disabled={edit.saving}>
            Cancel
          </WebButton>
          <WebButton size="sm" variant="save" loading={edit.saving} onClick={() => void edit.save()}>
            Save
          </WebButton>
        </>
      ) : edit.canEdit ? (
        <WebButton size="sm" onClick={edit.startEdit}>
          Edit
        </WebButton>
      ) : null}
    </>
  );

  const detailFields: KvField[] = [
    {
      key: "fullName",
      label: "Full name",
      read: saved.fullName ? String(saved.fullName) : null,
      placeholder: "e.g. Jan Peeters",
      autoComplete: "name",
    },
    { key: "email", label: "Email", kind: "derived", read: member.email, note: "The sign-in address cannot be changed here" },
    {
      key: "role",
      label: "Role",
      kind: "derived",
      read: roleLabel(member.role),
      note: "Change the role from the Team list",
    },
    {
      key: "regionId",
      label: "Default Service Area",
      kind: "select",
      read: saved.regionId ? regionName(String(saved.regionId)) : null,
      options: regions.map((region) => ({ value: region.id, label: region.label })),
      emptyLabel: "No default Service Area",
    },
  ];

  const assignedRegions = regions.filter((region) => Boolean(saved[areaKey(region.id)]));
  const areaFields: KvField[] = (edit.isEditing ? regions : assignedRegions).map((region) => ({
    key: areaKey(region.id),
    label: region.label,
    kind: "checkbox",
    checkboxLabel: "Can be scheduled in this area",
    read: "Assigned",
  }));

  const customRateOn = edit.isEditing ? Boolean(edit.draft.hasCustomRate) : Boolean(saved.hasCustomRate);
  const rateDisabledNote = "Turn on custom rate first";
  const articleOptions = articles.map((article) => ({ value: article.id, label: articleOptionLabel(article) }));
  const rateFields: KvField[] = [
    {
      key: "hasCustomRate",
      label: "Custom rate",
      kind: "checkbox",
      checkboxLabel: "Use a custom rate for this engineer",
      read: saved.hasCustomRate ? "On" : "Off",
    },
    {
      key: "travelArticleId",
      label: "Travel article",
      kind: "select",
      read: saved.travelArticleId ? articleName(String(saved.travelArticleId)) : null,
      options: articleOptions,
      emptyLabel: "Select an article…",
      disabled: !customRateOn,
      disabledNote: rateDisabledNote,
    },
    {
      key: "travelSalePrice",
      label: "Travel price",
      kind: "money",
      read: saved.travelSalePrice ? formatMoneyWeb(Number(saved.travelSalePrice)) : null,
      placeholder: "e.g. 85.00",
      disabled: !customRateOn,
      disabledNote: rateDisabledNote,
    },
    {
      key: "workArticleId",
      label: "Work article",
      kind: "select",
      read: saved.workArticleId ? articleName(String(saved.workArticleId)) : null,
      options: articleOptions,
      emptyLabel: "Select an article…",
      disabled: !customRateOn,
      disabledNote: rateDisabledNote,
    },
    {
      key: "workSalePrice",
      label: "Work price",
      kind: "money",
      read: saved.workSalePrice ? formatMoneyWeb(Number(saved.workSalePrice)) : null,
      placeholder: "e.g. 95.00",
      disabled: !customRateOn,
      disabledNote: rateDisabledNote,
    },
  ];
  // Read mode: only show the article/price rows when a custom rate is on.
  const visibleRateFields = edit.isEditing || saved.hasCustomRate ? rateFields : rateFields.slice(0, 1);

  const areasCard =
    areaFields.length > 0 ? (
      <KeyValueCard title="Service Areas" fields={areaFields} edit={edit} />
    ) : (
      <WebCard title="Service Areas">
        <p className="web-table-empty">
          {regions.length === 0
            ? "No Service Areas configured yet."
            : "No additional Service Areas assigned. Use Edit to add some."}
        </p>
      </WebCard>
    );

  return (
    <div className="web-tab-stack">
      <WebCardStack>
        <KeyValueCard
          title={member.fullName || member.email}
          meta={
            <>
              {roleLabel(member.role)}
              {isSelf ? " · you" : ""}
            </>
          }
          action={actions}
          fields={detailFields}
          edit={edit}
        />
        {isEngineer ? (
          <WebCardPair>
            {areasCard}
            <KeyValueCard title="Rate overrides" fields={visibleRateFields} edit={rateEdit} />
          </WebCardPair>
        ) : (
          areasCard
        )}
      </WebCardStack>
      <EditDiscardDialog confirm={edit.confirm} />
    </div>
  );
}
