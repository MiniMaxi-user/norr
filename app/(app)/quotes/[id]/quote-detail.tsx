"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Breadcrumbs,
  Card,
  IconButton,
  Input,
  Inline,
  KeyValueList,
  RecordHeroBand,
  SectionHeader,
  Stack,
  Text,
  Textarea,
  type KeyValueListItem,
} from "@yourorg/ui";
import { CalendarDays, FileText, Pencil } from "@yourorg/ui/icons";
import { usePageHeader } from "@/components/shell/page-header-context";
import { updateQuote, type QuoteRecord, type QuoteLineItemRecord } from "../actions";
import type { ClientRecord, SiteRecord } from "@/app/(app)/clients/actions";
import type { WorkOrderRecord } from "@/app/(app)/work-orders/actions";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import type { OrgMemberRecord } from "@/lib/members/actions";
import { formatDate } from "@/lib/format/date";
import { QuoteDetailActions } from "./quote-detail-actions";
import { QuoteRelationCards } from "./quote-relation-cards";
import { QuoteRelationsDialog } from "./quote-relations-dialog";
import { QuoteLineItemsPanel } from "./quote-line-items-panel";

export interface QuoteDetailProps {
  quote: QuoteRecord;
  client: ClientRecord | null;
  site: SiteRecord | null;
  /** This org's clients — the relations dialog's Client `<Select>` source
   * (same list `quote-form.tsx` already uses). */
  clients: ClientRecord[];
  /** Set only when `quote.work_order_id` is set — see `page.tsx`'s own doc
   * comment for how/why this is resolved. */
  sourceWorkOrder: WorkOrderRecord | null;
  lineItems: QuoteLineItemRecord[];
  /** Assets belonging to the quote's own client — resolves each line item's
   * optional `asset_id` inline (issue #95 criterion 16: no navigation to
   * `/assets/[id]`) and is the picker source in `QuoteLineItemsPanel`. */
  clientAssets: AssetRecord[];
  /** `listArticlesForSelect()`'s result — the line item article
   * search-picker's option source (issue #95). */
  articles: ArticleSelectOption[];
  /** This org's members — resolves a line item's `engineer_user_id` to a
   * display name and is the engineer picker's option source (issue #95). */
  members: OrgMemberRecord[];
  canEdit: boolean;
  canDelete: boolean;
  canCreateLineItems: boolean;
  canEditLineItems: boolean;
  canDeleteLineItems: boolean;
}

/**
 * Quote detail — moved onto Pattern A (`docs/ARCHITECTURE.md` "Two
 * detail-page header patterns"): a full-bleed `RecordHeroBand` (inline-
 * editable title, status badge, "Valid until …" meta), Client/Site
 * `RelationCard`s (+ an optional "Source" card when this quote traces back
 * to a work order, issue #109), a flat `SectionHeader`-led "Details" section
 * for the click-to-edit Valid-until field, an always-rendered editable Notes
 * `Card`, and `QuoteLineItemsPanel` as the dominant element — same shape
 * `app/(app)/work-orders/components/work-order-hero.tsx`/`work-order-
 * screen.tsx` establish, scaled down (no assignee block, no `StatStrip` —
 * Quotes doesn't have Work Orders' Hours/Material/Checklist KPI content).
 * Quotes previously used Pattern B (`DetailHero`/`DetailLayout`) — see that
 * doc section's own note that this was a deliberate, temporary choice
 * ("a future story could still move Quotes to Pattern A ... until then treat
 * it as intentional"). This is that story.
 *
 * No Asset/Contract `RelationCard` here — deliberate, not an oversight:
 * `quotes` has no top-level `asset_id`/`contract_id` column (only per-line
 * `quote_line_items.asset_id`, already rendered inline in the table below),
 * see `quote-relation-cards.tsx`'s own doc comment for the full reasoning.
 *
 * Every inline-editable affordance here (title input, the relation cards'
 * Edit button, the Details/Notes edit pencils) is gated on `canEdit` and
 * simply doesn't render for a caller without it — same "hide, don't just
 * disable" convention as `WorkOrderHero`/`AssetDetail`.
 *
 * `/quotes/[id]/edit` is gone (deleted alongside this redesign, same
 * precedent as Work Orders' own `/work-orders/[id]/edit` removal, issue
 * #89) — every field that page used to own is inline-editable here instead.
 * `/quotes/new` and `quote-form.tsx` (its shared form component) are
 * untouched; `quote-form.tsx`'s `mode: "edit"` branch is simply unused now.
 *
 * No "convert to Work Order/Contract" action here — deliberately out of
 * scope for this pass (see `app/(app)/quotes/actions.ts`'s module comment):
 * the backend conversion logic doesn't exist yet.
 */
export function QuoteDetail({
  quote,
  client,
  site,
  clients,
  sourceWorkOrder,
  lineItems,
  clientAssets,
  articles,
  members,
  canEdit,
  canDelete,
  canCreateLineItems,
  canEditLineItems,
  canDeleteLineItems,
}: QuoteDetailProps) {
  const router = useRouter();

  // Local "current displayed value" state for every inline-editable scalar
  // field, updated optimistically the moment its own save succeeds — same
  // shape `WorkOrderScreen`'s own `draft` object serves, just as separate
  // `useState`s rather than one merged draft (Quotes has far fewer editable
  // header fields than a work order, so a single flat draft object would be
  // overkill here).
  const [title, setTitle] = useState(quote.name);
  const [validUntil, setValidUntil] = useState(quote.valid_until);
  const [notes, setNotes] = useState(quote.notes);
  const [relationsOpen, setRelationsOpen] = useState(false);
  // Shared error surface for every inline-edit handler below — each one
  // updates its own field's state optimistically, then reverts to the
  // pre-edit value and populates this if the save actually failed (a
  // permission race, a validation rejection, ...), instead of leaving the
  // UI silently out of sync with what's actually stored.
  const [saveError, setSaveError] = useState<string | null>(null);

  const breadcrumbItems = useMemo(() => [{ label: "Quotes", href: "/quotes" }, { label: title }], [title]);
  // The element itself (not just `breadcrumbItems`) must be memoized — see
  // the "MUST be referentially stable" warning on `usePageHeader`'s doc
  // comment, and `client-detail.tsx`'s identical pattern.
  const breadcrumbNode = useMemo(() => <Breadcrumbs items={breadcrumbItems} />, [breadcrumbItems]);
  usePageHeader(breadcrumbNode);

  function handleTitleChange(value: string) {
    setTitle(value);
  }

  function handleTitleBlur(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      setTitle(quote.name);
      return;
    }
    if (canEdit && trimmed !== quote.name) {
      const previous = title;
      setTitle(trimmed);
      setSaveError(null);
      void updateQuote(quote.id, { name: trimmed }).then((result) => {
        if (!result.data) {
          setTitle(previous);
          setSaveError(result.error ?? "Could not save the quote name.");
          return;
        }
        router.refresh();
      });
    }
  }

  async function handleValidUntilSave(next: string) {
    const previous = validUntil;
    setValidUntil(next);
    setSaveError(null);
    const result = await updateQuote(quote.id, { validUntil: next });
    if (!result.data) {
      setValidUntil(previous);
      setSaveError(result.error ?? "Could not save Valid until.");
      return;
    }
    router.refresh();
  }

  async function handleNotesSave(next: string) {
    const previous = notes;
    setNotes(next);
    setSaveError(null);
    const result = await updateQuote(quote.id, { notes: next });
    if (!result.data) {
      setNotes(previous);
      setSaveError(result.error ?? "Could not save notes.");
      return;
    }
    router.refresh();
  }

  async function handleRelationsSave(patch: {
    clientId: string;
    siteId: string | null;
  }): Promise<{ ok: boolean; error?: string }> {
    const result = await updateQuote(quote.id, { clientId: patch.clientId, siteId: patch.siteId ?? "" });
    if (!result.data) return { ok: false, error: result.error };
    router.refresh();
    return { ok: true };
  }

  const meta = validUntil
    ? [
        <>
          <CalendarDays /> Valid until {formatDate(validUntil, { month: "long" })}
        </>,
      ]
    : [];

  const detailsItems: KeyValueListItem[] = [
    {
      key: "valid-until",
      label: "Valid until",
      value: <ValidUntilRow value={validUntil} canEdit={canEdit} onSave={handleValidUntilSave} />,
    },
  ];

  return (
    <Stack gap="lg">
      <RecordHeroBand
        title={
          canEdit ? (
            <input
              className="ui-record-hero-band-title-input"
              value={title}
              aria-label="Quote name"
              onChange={(event) => handleTitleChange(event.target.value)}
              onBlur={(event) => handleTitleBlur(event.target.value)}
            />
          ) : (
            <h1 className="ui-record-hero-band-title">{title}</h1>
          )
        }
        badges={
          <Badge color={quote.quote_status?.color} variant="muted">
            {quote.quote_status?.label ?? "—"}
          </Badge>
        }
        meta={meta}
        actions={<QuoteDetailActions quote={quote} canDelete={canDelete} />}
      />

      {saveError && <Text tone="danger">{saveError}</Text>}

      <QuoteRelationCards
        client={client}
        site={site}
        sourceWorkOrder={sourceWorkOrder}
        readOnly={!canEdit}
        onEdit={() => setRelationsOpen(true)}
      />

      <Stack gap="sm">
        <SectionHeader icon={CalendarDays} title="Details" />
        <KeyValueList items={detailsItems} />
      </Stack>

      <Card>
        <Stack gap="sm">
          <SectionHeader icon={FileText} title="Notes" />
          <NotesField value={notes} canEdit={canEdit} onSave={handleNotesSave} />
        </Stack>
      </Card>

      <QuoteLineItemsPanel
        quoteId={quote.id}
        lineItems={lineItems}
        clientAssets={clientAssets}
        articles={articles}
        members={members}
        canCreate={canCreateLineItems}
        canEdit={canEditLineItems}
        canDelete={canDeleteLineItems}
      />

      {relationsOpen && (
        <QuoteRelationsDialog
          open
          onOpenChange={setRelationsOpen}
          clientId={client?.id ?? quote.client_id}
          siteId={quote.site_id}
          clients={clients}
          onSave={handleRelationsSave}
        />
      )}
    </Stack>
  );
}

/**
 * "Valid until" — the click-to-edit shape used throughout this page: plain
 * text + a small edit-pencil `IconButton` that swaps in a real `<input
 * type="date">`, saving on blur (matching this app's general "click to edit,
 * save on blur" convention — no existing "inline swap a KeyValueList value
 * for an input" precedent to reuse; the closest relatives,
 * `WorkOrderAssignmentSection`/`WorkOrderHours`, both use a small `Dialog`
 * instead — this is a deliberately smaller/simpler shape for a single
 * scalar field). Omits the pencil entirely for a caller without `canEdit`,
 * same "hide, don't just disable" convention as everywhere else on this
 * page.
 */
function ValidUntilRow({
  value,
  canEdit,
  onSave,
}: {
  value: string | null;
  canEdit: boolean;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  if (editing) {
    return (
      <Input
        type="date"
        autoFocus
        aria-label="Valid until"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft !== (value ?? "")) onSave(draft);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setDraft(value ?? "");
            setEditing(false);
          } else if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
    );
  }

  return (
    <Inline gap="xs" align="center">
      <Text>{formatDate(value, { month: "long" })}</Text>
      {canEdit && (
        <IconButton
          variant="ghost"
          aria-label="Edit valid until"
          onClick={() => {
            setDraft(value ?? "");
            setEditing(true);
          }}
        >
          <Pencil />
        </IconButton>
      )}
    </Inline>
  );
}

/**
 * Notes — same click-to-edit shape as `ValidUntilRow` above, a `Textarea`
 * instead of a date input. Always rendered now (no longer omitted when
 * empty, per this page's own doc comment: it's an input, not just a display
 * of existing content) — a caller without `canEdit` sees plain text/"No
 * notes yet." with no pencil at all.
 */
function NotesField({
  value,
  canEdit,
  onSave,
}: {
  value: string | null;
  canEdit: boolean;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  if (editing) {
    return (
      <Textarea
        autoFocus
        aria-label="Notes"
        rows={4}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft !== (value ?? "")) onSave(draft);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setDraft(value ?? "");
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <Inline gap="xs" align="start">
      <Text tone={value ? undefined : "muted"}>{value || "No notes yet."}</Text>
      {canEdit && (
        <IconButton
          variant="ghost"
          aria-label="Edit notes"
          onClick={() => {
            setDraft(value ?? "");
            setEditing(true);
          }}
        >
          <Pencil />
        </IconButton>
      )}
    </Inline>
  );
}
