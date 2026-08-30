"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Checkbox,
  Combobox,
  Dialog,
  FormField,
  FormGrid,
  FormSection,
  FormSelectField,
  Heading,
  Inline,
  Input,
  Label,
  Stack,
  Text,
  useEscapeToClose,
} from "@yourorg/ui";
import { Boxes, Camera, CreditCard, FileText, Settings } from "@yourorg/ui/icons";
import { createArticle, updateArticle, type ArticleComponentLineRecord, type ArticleRecord } from "../actions";
import { listArticleComponents } from "../components-actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { FlattenedArticleGroup } from "../group-tree";
import { ArticleComponentsEditor } from "./article-components-editor";

interface ArticleFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
  /** Set when this submit was the save that first persists `is_composite`
   * — either the article's very first `createArticle` call with the
   * checkbox already checked, or (issue #98) an EDIT-mode save that flips an
   * existing article's `is_composite` from `false` to `true` — signals the
   * effect below to keep the panel open instead of closing it, so the BOM
   * editor (which only ever renders once `is_composite` is really persisted,
   * see `isCompositePersisted` below) becomes usable in the same session
   * instead of forcing a close-then-reopen round trip. */
  keepOpen?: boolean;
}

const initialState: ArticleFormState = {};

export interface ArticleFormPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  /** Required for `mode: "edit"`. */
  article?: ArticleRecord;
  /** The org's whole flattened Article Group tree — for the Group/Subgroup
   * `Combobox` pair below. Fetched once by `articles-screen.tsx` and passed
   * down, per this issue's own instruction (unlike `AssetFormDialog`'s
   * self-fetch-on-open pattern). */
  groups: FlattenedArticleGroup[];
  units: ReferenceListItemRecord[];
  manufacturers: ReferenceListItemRecord[];
  vatRates: ReferenceListItemRecord[];
}

/** This group's own record from `groups`, or `undefined` if `id` is
 * unset/no longer exists (e.g. the group was deleted after this article was
 * assigned to it). */
function findGroup(groups: FlattenedArticleGroup[], id: string | null | undefined): FlattenedArticleGroup | undefined {
  return id ? groups.find((group) => group.id === id) : undefined;
}

/** Walks a group's `parentId` chain up to its depth-0 (top-level) ancestor —
 * `""` if `id` doesn't resolve to a real group. Depth-0 groups are their own
 * top ancestor. */
function topAncestorId(groups: FlattenedArticleGroup[], id: string | null | undefined): string {
  let current = findGroup(groups, id);
  while (current && current.depth > 0 && current.parentId) {
    current = findGroup(groups, current.parentId);
  }
  return current?.id ?? "";
}

/** Whether `group` sits anywhere underneath `ancestorId` (any depth, not
 * just a direct child) — used for the depth-2+ Subgroup fallback below. */
function isDescendantOf(groups: FlattenedArticleGroup[], group: FlattenedArticleGroup, ancestorId: string): boolean {
  let current: FlattenedArticleGroup | undefined = group;
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true;
    current = findGroup(groups, current.parentId);
  }
  return false;
}

/**
 * Slide-in create/edit panel for a single article (issue #92, "Artikel
 * database") — ONE shared component for both modes, `Dialog size="panel-lg"`
 * (widened for issue #98 — see that issue for why this one panel gets its
 * own wider `Dialog` size instead of every panel in the app), mirroring
 * `EditClientPanel`'s shape exactly per this issue's own instruction.
 *
 * **Composite/BOM-editing sequencing** (issue #92's original "ordering
 * note", tightened by issue #98's bug fix below):
 * `addArticleComponent`/`removeArticleComponent` need a real
 * `parent_article_id` whose `is_composite` is ALREADY persisted `true` — the
 * `validate_article_component` DB trigger enforces this and rejects
 * anything else with a generic-looking `23514` error. `backingArticle`
 * (below) tracks the most recently PERSISTED article row — the `article`
 * prop in edit mode until the first successful save, then whatever
 * `createArticle`/`updateArticle` last returned — so `isCompositePersisted`
 * always reflects the database, never just the locally-checked
 * `isCompositeChecked` state. Concretely:
 *  - The "Composite article" checkbox is togglable immediately, in both
 *    modes, but the BOM editor only ever renders once
 *    `isCompositePersisted` is true; until then a "save first" message
 *    shows instead (issue #98's bug: this used to only check "does a
 *    backing article exist", which was already true for every EDIT of an
 *    existing non-composite article, so checking the box rendered the BOM
 *    editor against a `parent_article_id` whose `is_composite` was still
 *    `false` in the DB — exactly the reported trigger rejection).
 *  - The save that FIRST flips `is_composite` to `true` (a brand-new
 *    composite article's first `createArticle`, or an existing article's
 *    first `updateArticle` after checking the box) does NOT close the panel
 *    — it keeps it open with a success banner and the now-usable BOM editor,
 *    footer button relabeled "Close", so components can be added in one
 *    uninterrupted flow instead of a save-then-reopen round trip. Every
 *    other save (composite already persisted, or never checked at all)
 *    closes the panel as normal.
 */
export function ArticleFormPanel({ open, onOpenChange, mode, article, groups, units, manufacturers, vatRates }: ArticleFormPanelProps) {
  const isEdit = mode === "edit" && Boolean(article);
  const router = useRouter();
  useEscapeToClose(open, onOpenChange);

  // The most recently PERSISTED article row — `article` (or `null` for a
  // brand-new create) until the first successful save, then whatever
  // `createArticle`/`updateArticle` last returned. See this component's own
  // doc comment on why this (not `isCompositeChecked`) is what gates the BOM
  // editor.
  const [savedArticle, setSavedArticle] = useState<ArticleRecord | null>(article ?? null);
  const [imageUrl, setImageUrl] = useState(article?.image_url ?? "");
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const [isCompositeChecked, setIsCompositeChecked] = useState(article?.is_composite ?? false);
  const [components, setComponents] = useState<ArticleComponentLineRecord[]>([]);
  const [loadingComponents, setLoadingComponents] = useState(false);
  // Group/Subgroup cascade (issue #98) — `topGroupId` is the depth-0
  // ancestor, `subGroupId` the depth-1 (or deeper, see `subgroupOptions`
  // below) descendant actually assigned to the article. The single
  // `groupId` submitted to the server is derived from these two in `action`
  // below, never stored as its own state.
  const [topGroupId, setTopGroupId] = useState(() => topAncestorId(groups, article?.group_id));
  const [subGroupId, setSubGroupId] = useState(() => {
    const node = findGroup(groups, article?.group_id);
    return node && node.depth > 0 ? node.id : "";
  });

  // Tracks whether THIS open session has already had its "composite
  // unlocked" save (see `keepOpen` above) — drives the success banner/footer
  // button label for the rest of the session, replacing the old
  // `createdArticle`-truthiness check now that the same "stay open" moment
  // can happen in edit mode too, not just on a brand-new article.
  const [bomUnlockedThisSession, setBomUnlockedThisSession] = useState(false);

  // Reset every piece of this panel's own local state whenever it opens —
  // required because `CreateArticleButton` keeps ONE persistent
  // `ArticleFormPanel` instance alive across opens (only `open` toggles), so
  // without this a previous session's `savedArticle`/typed values would
  // otherwise leak into the next "New article" open. `ArticlesTable`'s own
  // edit panel doesn't strictly need this (a fresh instance mounts per row
  // click there), but resetting unconditionally on open is simpler than
  // maintaining two different lifecycles.
  useEffect(() => {
    if (!open) return;
    setSavedArticle(article ?? null);
    setImageUrl(article?.image_url ?? "");
    setImageLoadFailed(false);
    setIsCompositeChecked(article?.is_composite ?? false);
    setTopGroupId(topAncestorId(groups, article?.group_id));
    const node = findGroup(groups, article?.group_id);
    setSubGroupId(node && node.depth > 0 ? node.id : "");
    setBomUnlockedThisSession(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The article's own existing BOM lines aren't part of `ArticleRecord`
  // (`listArticles`/the table row doesn't embed them) — fetched separately
  // here, once per open, only in edit mode.
  useEffect(() => {
    if (!open || !isEdit || !article) {
      setComponents([]);
      return;
    }
    let cancelled = false;
    setLoadingComponents(true);
    listArticleComponents(article.id)
      .then((result) => {
        if (!cancelled) setComponents(result.data?.components ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoadingComponents(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const backingArticle = savedArticle;
  const hasBackingRecord = Boolean(backingArticle);
  // The real gate for the BOM editor — see this component's own doc comment.
  const isCompositePersisted = backingArticle?.is_composite === true;

  // Group/Subgroup option lists, derived from `groups` + the current
  // cascade selection.
  const topLevelGroups = groups.filter((group) => group.depth === 0);
  const directSubgroups = groups.filter((group) => group.depth === 1 && group.parentId === topGroupId);
  // Depth-2+ fallback (issue #98's own acceptance criteria only asks for a
  // 2-level Group/Subgroup split "where possible"): if the currently
  // selected subgroup isn't among `topGroupId`'s direct (depth-1) children,
  // it must be a deeper legacy assignment (a group tree can be unlimited
  // depth) — rather than silently losing/reassigning it, widen the Subgroup
  // picker to every descendant of the selected top group (any depth),
  // labeled with its full breadcrumb `path` for disambiguation, so the
  // existing value stays visible and selectable. Picking a different top
  // group (or a different subgroup) always clears back to the normal
  // direct-children-only list.
  const subgroupIsDeepFallback = Boolean(subGroupId) && !directSubgroups.some((group) => group.id === subGroupId);
  const deepDescendants = subgroupIsDeepFallback
    ? groups.filter((group) => group.depth > 0 && isDescendantOf(groups, group, topGroupId))
    : [];
  const subgroupOptions = (subgroupIsDeepFallback ? deepDescendants : directSubgroups).map((group) => ({
    value: group.id,
    label: subgroupIsDeepFallback ? group.path : group.name,
  }));

  function handleTopGroupChange(value: string) {
    setTopGroupId(value);
    setSubGroupId("");
  }

  async function action(_prevState: ArticleFormState, formData: FormData): Promise<ArticleFormState> {
    const raw = Object.fromEntries(formData.entries());
    // A `<Checkbox>` only appears in `FormData` at all when checked, so
    // `Object.fromEntries` alone would omit an unchecked box entirely rather
    // than encode it as `false` — same fix `site-form-dialog.tsx` applies for
    // its own boolean fields. `groupId` is likewise overridden here rather
    // than read from `FormData` — the Group/Subgroup `Combobox`es below are
    // deliberately unnamed (see their own comments), so the single
    // submitted value is whichever of the two cascade levels is more
    // specific.
    const input = {
      ...raw,
      isComposite: formData.get("isComposite") === "on",
      isActive: formData.get("isActive") === "on",
      groupId: subGroupId || topGroupId || "",
    };
    const wasCompositeUnlockedByThisSave = isCompositeChecked && !isCompositePersisted;
    const result = backingArticle ? await updateArticle(backingArticle.id, input) : await createArticle(input);
    if (result.error || !result.data) {
      return { error: result.error ?? "Something went wrong.", fieldErrors: result.fieldErrors };
    }
    setSavedArticle(result.data.article);
    if (!backingArticle || wasCompositeUnlockedByThisSave) {
      return { success: true, keepOpen: true };
    }
    return { success: true };
  }

  const [state, formAction] = useActionState(action, initialState);

  useEffect(() => {
    if (!state.success) return;
    if (state.keepOpen) {
      // Stay open (see this component's own doc comment) — still refresh the
      // Server Component data underneath (the list/table) in the background.
      setBomUnlockedThisSession(true);
      router.refresh();
      return;
    }
    onOpenChange(false);
    router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const defaultUnit = units.find((item) => item.is_default);
  const defaultVatRate = vatRates.find((item) => item.is_default);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="panel-lg">
      <Dialog.Header>
        <Heading level={3}>{isEdit ? `Edit ${article?.article_number ?? "article"}` : "New article"}</Heading>
      </Dialog.Header>
      <form action={formAction}>
        <Dialog.Body>
          <Stack gap="lg">
            {state.error && <Text tone="danger">{state.error}</Text>}
            {bomUnlockedThisSession &&
              (isEdit ? (
                <Text tone="success">
                  Composite article saved — you can now add bill-of-materials components below, or close this panel.
                </Text>
              ) : (
                <Text tone="success">
                  Article {savedArticle?.article_number} created — you can now add bill-of-materials components below,
                  or close this panel.
                </Text>
              ))}

            <FormSection title="Article" icon={<Boxes />}>
              <FormGrid columns={4}>
                <FormField
                  label="Article number"
                  name="articleNumber"
                  defaultValue={article?.article_number}
                  required
                  maxLength={100}
                  errors={state.fieldErrors?.articleNumber}
                />
                <FormField
                  label="MPN (manufacturer part number)"
                  name="mpn"
                  defaultValue={article?.mpn}
                  maxLength={100}
                  errors={state.fieldErrors?.mpn}
                />
                <FormField label="EAN" name="ean" defaultValue={article?.ean} maxLength={64} errors={state.fieldErrors?.ean} />
                <FormField label="GTIN" name="gtin" defaultValue={article?.gtin} maxLength={64} errors={state.fieldErrors?.gtin} />
              </FormGrid>

              <FormField
                label="Description"
                name="description"
                defaultValue={article?.description ?? ""}
                required
                maxLength={2000}
                errors={state.fieldErrors?.description}
              />
            </FormSection>

            <FormSection title="Media" icon={<Camera />}>
              <Stack gap="xs">
                <Label htmlFor="article-image-url">Image URL</Label>
                <Input
                  id="article-image-url"
                  name="imageUrl"
                  value={imageUrl}
                  onChange={(event) => {
                    setImageUrl(event.target.value);
                    setImageLoadFailed(false);
                  }}
                  maxLength={2000}
                  placeholder="https://…"
                />
                {state.fieldErrors?.imageUrl?.map((message) => (
                  <Text key={message} tone="danger">
                    {message}
                  </Text>
                ))}
                {imageUrl.trim() &&
                  (imageLoadFailed ? (
                    <Text tone="muted">Couldn&rsquo;t load an image from this URL.</Text>
                  ) : (
                    // A live preview of an arbitrary, tenant-typed URL isn't a
                    // good fit for `next/image`'s remote-pattern allowlist.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imageUrl.trim()}
                      alt="Article preview"
                      onError={() => setImageLoadFailed(true)}
                      style={{ maxWidth: "8rem", maxHeight: "8rem", objectFit: "contain", borderRadius: "0.5rem" }}
                    />
                  ))}
              </Stack>
            </FormSection>

            <FormSection title="Classification" icon={<Settings />}>
              <FormGrid columns={4}>
                <Stack gap="xs">
                  <Label htmlFor="article-group">Group</Label>
                  <Combobox
                    id="article-group"
                    options={topLevelGroups.map((group) => ({ value: group.id, label: group.name }))}
                    value={topGroupId}
                    onChange={handleTopGroupChange}
                    placeholder="Search groups…"
                    clearable
                    emptyMessage="No groups configured."
                  />
                  {state.fieldErrors?.groupId?.map((message) => (
                    <Text key={message} tone="danger">
                      {message}
                    </Text>
                  ))}
                </Stack>
                <Stack gap="xs">
                  <Label htmlFor="article-subgroup">Subgroup</Label>
                  <Combobox
                    id="article-subgroup"
                    options={subgroupOptions}
                    value={subGroupId}
                    onChange={setSubGroupId}
                    placeholder={topGroupId ? "Search subgroups…" : "Select a group first…"}
                    disabled={!topGroupId}
                    clearable
                    emptyMessage="No subgroups under this group."
                  />
                </Stack>
                <FormSelectField
                  label="Manufacturer"
                  name="manufacturerItemId"
                  defaultValue={article?.manufacturer_item_id ?? ""}
                  errors={state.fieldErrors?.manufacturerItemId}
                >
                  <option value="">No manufacturer</option>
                  {manufacturers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </FormSelectField>
                <FormSelectField label="Unit" name="unitItemId" defaultValue={article?.unit_item_id ?? ""} errors={state.fieldErrors?.unitItemId}>
                  <option value="">{defaultUnit ? `Use default (${defaultUnit.label})` : "Use organization default"}</option>
                  {units.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </FormSelectField>
              </FormGrid>
            </FormSection>

            <FormSection title="Pricing & VAT" icon={<CreditCard />}>
              <FormGrid columns={3}>
                <FormField
                  label="Purchase price"
                  name="purchasePrice"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={article?.purchase_price ?? undefined}
                  errors={state.fieldErrors?.purchasePrice}
                  prefix="€"
                />
                <FormField
                  label="Sale price"
                  name="salePrice"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={article?.sale_price ?? undefined}
                  errors={state.fieldErrors?.salePrice}
                  prefix="€"
                />
                <FormSelectField
                  label="VAT rate"
                  name="vatRateItemId"
                  defaultValue={article?.vat_rate_item_id ?? ""}
                  errors={state.fieldErrors?.vatRateItemId}
                >
                  <option value="">
                    {defaultVatRate ? `Use default (${defaultVatRate.label})` : "Use organization default"}
                  </option>
                  {vatRates.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </FormSelectField>
              </FormGrid>
            </FormSection>

            <FormSection title="Status & composite" icon={<FileText />}>
              <Stack gap="md">
                <Inline gap="sm" align="center">
                  <Checkbox id="article-is-active" name="isActive" defaultChecked={article ? article.is_active : true} />
                  <Label htmlFor="article-is-active">Active</Label>
                </Inline>

                <Inline gap="sm" align="center">
                  <Checkbox
                    id="article-is-composite"
                    name="isComposite"
                    checked={isCompositeChecked}
                    onChange={(event) => setIsCompositeChecked(event.target.checked)}
                  />
                  <Label htmlFor="article-is-composite">Composite article (has a bill of materials)</Label>
                  {isCompositeChecked && <Badge variant="accent">Composite</Badge>}
                </Inline>

                {isCompositeChecked && (
                  <Stack gap="sm">
                    <Heading level={4}>Bill of materials</Heading>
                    {!isCompositePersisted ? (
                      <Text tone="muted">
                        {hasBackingRecord ? "Save your changes first" : "Save this article first"} to start adding
                        components.
                      </Text>
                    ) : loadingComponents ? (
                      <Text tone="muted">Loading components…</Text>
                    ) : (
                      <ArticleComponentsEditor parentArticleId={backingArticle!.id} initialComponents={components} />
                    )}
                  </Stack>
                )}
              </Stack>
            </FormSection>
          </Stack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {bomUnlockedThisSession ? "Close" : "Cancel"}
          </Button>
          <SubmitButton hasBackingRecord={hasBackingRecord} />
        </Dialog.Footer>
      </form>
    </Dialog>
  );
}

function SubmitButton({ hasBackingRecord }: { hasBackingRecord: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? "Saving…" : hasBackingRecord ? "Save changes" : "Add article"}
    </Button>
  );
}
