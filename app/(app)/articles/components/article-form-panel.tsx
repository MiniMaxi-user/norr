"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Checkbox,
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
  Textarea,
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
  /** Set when this submit was the article's very first `createArticle` call
   * — signals the effect below to keep the panel open instead of closing it
   * (see this component's own doc comment on the create-mode BOM approach). */
  justCreated?: boolean;
}

const initialState: ArticleFormState = {};

export interface ArticleFormPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  /** Required for `mode: "edit"`. */
  article?: ArticleRecord;
  /** The org's whole flattened Article Group tree — for the Group `<Select>`
   * below, indented by depth. Fetched once by `articles-screen.tsx` and
   * passed down, per this issue's own instruction (unlike
   * `AssetFormDialog`'s self-fetch-on-open pattern). */
  groups: FlattenedArticleGroup[];
  units: ReferenceListItemRecord[];
  manufacturers: ReferenceListItemRecord[];
  vatRates: ReferenceListItemRecord[];
}

/**
 * Slide-in create/edit panel for a single article (issue #92, "Artikel
 * database") — ONE shared component for both modes, `Dialog size="panel"`,
 * mirroring `EditClientPanel`'s shape exactly per this issue's own
 * instruction.
 *
 * **Create-mode BOM-editing approach** (see the task's own "ordering note"):
 * `addArticleComponent`/`removeArticleComponent` need a real
 * `parent_article_id`, which doesn't exist yet while creating a brand-new
 * article. Rather than holding BOM lines in local-only state and persisting
 * them via a batch of follow-up calls after the initial save (option (a) in
 * the task), this panel takes option (b) — the same shape Work Orders
 * already use for Time Entries/Checklist (`work-order-screen.tsx`: those
 * panels are simply absent until the work order exists): the "Composite
 * article" checkbox is available immediately on create, but the actual BOM
 * editor only appears once a real article id exists. Concretely: the FIRST
 * successful `createArticle` submit does NOT close this panel (unlike every
 * other create/edit panel in this codebase) — it stores the freshly-created
 * article in `createdArticle` below and keeps the panel open, with a success
 * banner and the BOM editor now visible (if composite), footer button
 * relabeled "Close", and every subsequent submit going through `updateArticle`
 * against that same id. This was simpler and reads better than deferring the
 * BOM editor to a second page/route the way Work Orders does (this is a
 * `Dialog`, not a full page, so "stay open and let the record exist
 * underneath you" is the natural equivalent) — and it means a composite
 * article's components can be added in one uninterrupted flow instead of a
 * save-then-reopen round trip.
 */
export function ArticleFormPanel({ open, onOpenChange, mode, article, groups, units, manufacturers, vatRates }: ArticleFormPanelProps) {
  const isEdit = mode === "edit" && Boolean(article);
  const router = useRouter();
  useEscapeToClose(open, onOpenChange);

  const [createdArticle, setCreatedArticle] = useState<ArticleRecord | null>(null);
  const [imageUrl, setImageUrl] = useState(article?.image_url ?? "");
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const [isCompositeChecked, setIsCompositeChecked] = useState(article?.is_composite ?? false);
  const [components, setComponents] = useState<ArticleComponentLineRecord[]>([]);
  const [loadingComponents, setLoadingComponents] = useState(false);

  // Reset every piece of this panel's own local state whenever it opens —
  // required because `CreateArticleButton` keeps ONE persistent
  // `ArticleFormPanel` instance alive across opens (only `open` toggles), so
  // without this a previous session's `createdArticle`/typed values would
  // otherwise leak into the next "New article" open. `ArticlesTable`'s own
  // edit panel doesn't strictly need this (a fresh instance mounts per row
  // click there), but resetting unconditionally on open is simpler than
  // maintaining two different lifecycles.
  useEffect(() => {
    if (!open) return;
    setCreatedArticle(null);
    setImageUrl(article?.image_url ?? "");
    setImageLoadFailed(false);
    setIsCompositeChecked(article?.is_composite ?? false);
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

  const backingArticle = isEdit ? (article ?? null) : createdArticle;
  const hasBackingRecord = Boolean(backingArticle);

  async function action(_prevState: ArticleFormState, formData: FormData): Promise<ArticleFormState> {
    const raw = Object.fromEntries(formData.entries());
    // A `<Checkbox>` only appears in `FormData` at all when checked, so
    // `Object.fromEntries` alone would omit an unchecked box entirely rather
    // than encode it as `false` — same fix `site-form-dialog.tsx` applies for
    // its own boolean fields.
    const input = {
      ...raw,
      isComposite: formData.get("isComposite") === "on",
      isActive: formData.get("isActive") === "on",
    };
    const result = backingArticle ? await updateArticle(backingArticle.id, input) : await createArticle(input);
    if (result.error || !result.data) {
      return { error: result.error ?? "Something went wrong.", fieldErrors: result.fieldErrors };
    }
    if (!backingArticle) {
      setCreatedArticle(result.data.article);
      return { success: true, justCreated: true };
    }
    return { success: true };
  }

  const [state, formAction] = useActionState(action, initialState);

  useEffect(() => {
    if (!state.success) return;
    if (state.justCreated) {
      // Stay open (see this component's own doc comment) — still refresh the
      // Server Component data underneath (the list/table) in the background.
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
    <Dialog open={open} onOpenChange={onOpenChange} size="panel">
      <Dialog.Header>
        <Heading level={3}>{isEdit ? `Edit ${article?.article_number ?? "article"}` : "New article"}</Heading>
      </Dialog.Header>
      <form action={formAction}>
        <Dialog.Body>
          <Stack gap="lg">
            {state.error && <Text tone="danger">{state.error}</Text>}
            {createdArticle && (
              <Text tone="success">
                Article {createdArticle.article_number} created — you can now add bill-of-materials components below,
                or close this panel.
              </Text>
            )}

            <FormSection title="Article" icon={<Boxes />}>
              <FormGrid columns={2}>
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
              </FormGrid>

              <Stack gap="xs">
                <Label htmlFor="article-description">Description *</Label>
                <Textarea
                  id="article-description"
                  name="description"
                  defaultValue={article?.description ?? ""}
                  required
                  maxLength={2000}
                  rows={3}
                />
                {state.fieldErrors?.description?.map((message) => (
                  <Text key={message} tone="danger">
                    {message}
                  </Text>
                ))}
              </Stack>

              <FormGrid columns={2}>
                <FormField label="EAN" name="ean" defaultValue={article?.ean} maxLength={64} errors={state.fieldErrors?.ean} />
                <FormField label="GTIN" name="gtin" defaultValue={article?.gtin} maxLength={64} errors={state.fieldErrors?.gtin} />
              </FormGrid>
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
                    // eslint-disable-next-line @next/next/no-img-element -- a
                    // live preview of an arbitrary, tenant-typed URL isn't a
                    // good fit for `next/image`'s remote-pattern allowlist.
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
              <FormGrid columns={3}>
                <FormSelectField label="Group" name="groupId" defaultValue={article?.group_id ?? ""} errors={state.fieldErrors?.groupId}>
                  <option value="">No group</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {"— ".repeat(group.depth)}
                      {group.name}
                    </option>
                  ))}
                </FormSelectField>
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
                />
                <FormField
                  label="Sale price"
                  name="salePrice"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={article?.sale_price ?? undefined}
                  errors={state.fieldErrors?.salePrice}
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
                    {!hasBackingRecord ? (
                      <Text tone="muted">Save this article first to start adding components.</Text>
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
            {createdArticle ? "Close" : "Cancel"}
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
