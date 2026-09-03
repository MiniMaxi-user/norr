-- Decouple quote_line_items.description from the article number (schema
-- prerequisite for api-backend-engineer's concurrent fix to
-- app/(app)/quotes/schema.ts / actions.ts / quote-line-items-panel.tsx and
-- the invoice PDF).
--
-- Today, `articleOptionLabel(article)`
-- (app/(app)/quotes/actions.ts) produces a combined
-- "${article.article_number} — ${article.description}" string, and
-- `quote-line-items-panel.tsx` writes that COMBINED string straight into
-- `quote_line_items.description` when a user picks an article for a line
-- item. So an article-sourced line item's `description` today is a squashed
-- "number + name" string, not a clean description -- and the existing
-- `quote_line_items.article_id` FK
-- (`20260830100000_work_order_articles_and_quote_traceability.sql`) isn't a
-- good enough source for a clean invoice display on its own: (a) it's
-- `on delete set null`, so the join disappears entirely if the source
-- article is later deleted, and (b) even while present, `description` still
-- holds the old combined text, not a re-derivable clean value.
--
-- `quote_line_items.article_number text null` is a real, independently-
-- stored, historically-frozen column -- same "snapshot the value at write
-- time, don't always re-derive it live from a mutable FK" reasoning this
-- schema already applies to `quote_line_items.purchase_price` (frozen at
-- write time from `articles.purchase_price`, never re-read live). Free text,
-- no format/length constraint, mirroring `articles.article_number`'s own
-- plain `text` typing (no length cap either). Nullable: a manually-typed
-- line item (no linked article) may have no article number at all, or the
-- user may still choose to type one by hand -- this is a free-editable
-- field going forward, not derived-only. Populating/editing it on new
-- writes, and displaying it on the invoice PDF, is
-- `api-backend-engineer`'s concurrent follow-up (schema.ts/actions.ts/
-- quote-line-items-panel.tsx), out of scope here.
--
-- Small additive column on an existing, already-RLS'd table -- no new
-- table, no RLS policy change, no tenant-isolation boundary change (same
-- unchanged owner/planner-write, everyone-else-read boundary
-- `20260824090000_quotes_core.sql` established). Per db-schema-architect's
-- own "small edit" working style this gets a direct migration, not a new
-- pgTAP test file / qa-reviewer handoff -- confirmed the existing
-- `supabase/tests/database/quotes_rls.test.sql` doesn't assert an
-- exhaustive/fixed quote_line_items column list anywhere that this would
-- need updating (its INSERT statements only ever name the specific columns
-- each scenario cares about).
--
-- Column-grant re-issue: quote_line_items' INSERT/UPDATE column grants have
-- been extended three times since the table was created
-- (`20260824090000_quotes_core.sql`'s original grant, plus `article_id` from
-- `20260830100000_work_order_articles_and_quote_traceability.sql` and
-- `discount_percent`/`engineer_user_id` from
-- `20260830120000_quote_line_items_discount_and_engineer.sql`) -- re-issuing
-- the full accumulated list here (plus `article_number`), same "re-issue the
-- full current grant list" convention used repeatedly this session (e.g.
-- `20260825160000_clients_represents_organization.sql`). Same actors as
-- today (owner/planner, per quote_line_items' existing RLS policies) --
-- nothing more or less.
--
-- Backfill: for every existing row where `article_id is not null`,
-- backfill `article_number` from that linked article's own CURRENT
-- `articles.article_number` -- the one source that's always unambiguously
-- correct regardless of what free text happens to be sitting in
-- `description` today. Deliberately does NOT attempt to parse/strip the
-- article number back out of existing `description` text -- too fragile
-- (hand-typed lines don't reliably follow the "NUMBER — NAME" format, and
-- even auto-filled ones could have been hand-edited afterward) --
-- `description` is left completely untouched by this migration; the
-- application layer only affects `description` content going forward, on
-- new writes/edits.

alter table public.quote_line_items
  add column article_number text;

comment on column public.quote_line_items.article_number is
  'Free-text article number, decoupled from description (issue: description used to be a hand-combined "ArticleNumber — Name" string when populated from an article -- see this migration''s header). Nullable: a manually-typed line item may have no article number, or the user may still type one by hand -- this is a free-editable field, not derived-only. No format/length constraint, mirroring articles.article_number''s own plain text typing. Snapshotted at write time (same "freeze at write time, never re-read live from the mutable article_id FK" reasoning as quote_line_items.purchase_price) rather than always re-derived live from article_id, since article_id is on delete set null and would otherwise silently lose this value if the source article is later deleted. Backfilled once, for pre-existing rows with article_id is not null, from that article''s article_number at migration time (20260903130000_quote_line_items_article_number.sql) -- populated/edited going forward by the application layer (app/(app)/quotes), not by any trigger.';

-- Backfill existing rows: only where article_id is currently set, from that
-- article's own current article_number. Rows with no article_id (manual
-- lines) are left null, per the migration header.
update public.quote_line_items qli
set article_number = a.article_number
from public.articles a
where qli.article_id = a.id
  and qli.article_id is not null;

-- Re-issue the full current INSERT/UPDATE column grant lists for
-- quote_line_items, adding article_number (see migration header for the
-- reconstructed prior state).
grant insert (
  id, quote_id, asset_id, description, quantity, unit_price, sort_order,
  article_id, discount_percent, engineer_user_id, article_number
) on public.quote_line_items to authenticated;

grant update (
  asset_id, description, quantity, unit_price, sort_order,
  article_id, discount_percent, engineer_user_id, article_number
) on public.quote_line_items to authenticated;
