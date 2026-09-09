-- Contracts: "Volume" line items + purchase_price snapshot on
-- contract_line_items (issue #129, "Als gebruiker wil ik aantallen op een
-- contract kunnen beheren"). Purely additive to contract_line_items
-- (20260905100000_contracts_billing_period_line_items_and_article_rules.sql)
-- — no other table touched, no RLS policy change (the owner-or-finance
-- write boundary on this table is unchanged, only its column-level grants
-- are widened to cover the two new columns).
--
-- Design notes (read before extending):
--
-- 1. **`purchase_price` — a deliberate, scoped EXCEPTION to the "never
--    snapshot the cost side" convention, for THIS table only.**
--    `20260905100000_contracts_billing_period_line_items_and_article_rules.sql`
--    (design note 2) established "no purchase_price column, ever — purchase
--    price is always read live from articles.purchase_price at the
--    application layer" for `contract_line_items`, the same convention
--    `lib/rate-overrides` and `work_order_articles` still follow. Product
--    owner decision (issue #129): `contract_line_items` alone now reverses
--    that convention and gets a real, stored, user-overridable
--    `purchase_price` column, because this line item type needs to snapshot
--    cost AT CONTRACT-SIGNING TIME for margin tracking on `is_volume`-flagged
--    lines — a multi-year contract's margin on a pre-agreed usage bundle
--    should reflect the cost that was true when the deal was struck, not
--    whatever `articles.purchase_price` happens to be today. This is
--    SPECIFIC to `contract_line_items`: `quote_line_items`,
--    `work_order_articles`, and `rate_overrides` (client/engineer rate
--    overrides) are UNCHANGED and continue to read purchase price live from
--    `articles.purchase_price` — do not "fix" this column back to match
--    those three tables; that would undo an explicit, informed product
--    decision, not correct an oversight.
--    Column shape deliberately mirrors `unit_price` exactly
--    (`numeric(12,2) not null default 0`, no CHECK) for consistency between
--    the two sibling money columns on this table. Populated by the
--    application layer, not a DB trigger: picking an article default-fills
--    `purchase_price` from that article's own `purchase_price` at the
--    moment it's first chosen (same UX `unit_price`/`RateSettingsSection`'s
--    sale-price default-fill already uses), then freely editable — same
--    division of responsibility `unit_price` already has on this table.
--
-- 2. **`is_volume` — the "Volume" checkbox from issue #129.** Final chosen
--    term is "Volume" (NOT "Quota", the placeholder term the issue text
--    used) — use "Volume"/"Volume line item" consistently in any future
--    comment/label. `is_volume = true` on a row means this contract line
--    item represents a pre-agreed usage allowance/bundle (e.g. "10,000 cups
--    of coffee per year", "1000 B/W + 500 color prints") rather than a plain
--    sale-priced article line. Standalone boolean for now — deliberately NO
--    FK to any reference/lookup table: issue #131 ("Beheren 'Volume'", a
--    future tenant-configurable reference list for this same concept) is
--    NOT built yet. When #131 lands, expect it to add a nullable FK column
--    alongside (or instead of) this boolean, not to repurpose this column's
--    meaning. `is_volume` is also the basis for a future settlement/
--    invoicing story (out of scope here — this migration only adds the
--    flag).
--
-- 3. **Column-grant widening only — no RLS policy change.** This table's
--    write boundary (owner OR finance for INSERT/UPDATE/DELETE, any org
--    member for SELECT, `contract_line_items_insert_owner_or_finance`/
--    `contract_line_items_update_owner_or_finance`/
--    `contract_line_items_delete_owner_or_finance`/
--    `contract_line_items_select_member`) is untouched by this migration.
--    Both new columns are simply added to the existing INSERT/UPDATE
--    column-level grants (re-granted in full here, in this new migration —
--    the original `grant insert (...)`/`grant update (...)` statements in
--    the prior migration file are never edited).
--
-- ---------------------------------------------------------------------------
-- contract_line_items.purchase_price
-- ---------------------------------------------------------------------------
alter table public.contract_line_items
  add column purchase_price numeric(12, 2) not null default 0;

comment on column public.contract_line_items.purchase_price is
  'numeric(12,2) — a deliberate, SCOPED EXCEPTION to the "never snapshot the cost side" convention (lib/rate-overrides, work_order_articles, and quote_line_items all still read purchase price live from articles.purchase_price; they are unchanged). contract_line_items alone stores a real, stored, user-overridable purchase_price because this line item type needs to snapshot cost at CONTRACT-SIGNING TIME for margin tracking on is_volume-flagged lines (product-owner decision, issue #129) — a multi-year contract''s margin on a pre-agreed usage bundle should reflect the cost true when the deal was struck, not today''s live articles.purchase_price. Do not "fix" this back to match the other three tables. Mirrors unit_price''s own shape exactly (numeric(12,2) not null default 0). Populated by the application layer, not a DB trigger: picking an article default-fills purchase_price from that article''s own purchase_price at the moment it is first chosen (same UX as unit_price''s sale-price default-fill / RateSettingsSection), then freely editable.';

-- ---------------------------------------------------------------------------
-- contract_line_items.is_volume
-- ---------------------------------------------------------------------------
alter table public.contract_line_items
  add column is_volume boolean not null default false;

comment on column public.contract_line_items.is_volume is
  'The "Volume" checkbox (issue #129, "Als gebruiker wil ik aantallen op een contract kunnen beheren" — final chosen term is "Volume", not the issue text''s placeholder "Volume of Quota"). true means this line item represents a pre-agreed usage allowance/bundle (e.g. "10,000 cups of coffee per year", "1000 B/W + 500 color prints") rather than a plain sale-priced article line; false (default) is an ordinary line item. Standalone boolean for now, deliberately with NO FK — issue #131 ("Beheren ''Volume''", a future tenant-configurable reference list for this same concept) is NOT built yet; when it lands, expect a new nullable FK column alongside this one, not a repurposing of it. Also the basis for a future settlement/invoicing story, out of scope here.';

-- ---------------------------------------------------------------------------
-- Table-level comment: correct the now-false "Deliberately has NO
-- purchase_price column" claim from the prior migration (re-stated here in
-- full, not left contradicting the schema).
-- ---------------------------------------------------------------------------
comment on table public.contract_line_items is
  'Articles which should appear on the Quote generated from this contract (issue #122) — the invoicing basis for whatever gets billed under the contract. organization_id is denormalized from contracts.organization_id (via contract_id) by derive_contract_line_item_organization_id. unit_price is the overridable SALE price, read from the picked article''s sale_price at the application layer by default. purchase_price (added by 20260909100000_contract_line_items_volume_and_purchase_price.sql, issue #129) is a deliberate, table-specific EXCEPTION to this schema''s usual "never snapshot the cost side" convention — see that column''s own comment for the full reasoning; quote_line_items/work_order_articles/rate_overrides still read purchase price live from articles.purchase_price, unchanged. is_volume (same migration, issue #129) flags a line item as a pre-agreed usage allowance/bundle ("Volume") rather than a plain sale-priced line. Does NOT wire into any quote/invoice generation logic — a later story consumes this table.';

-- ---------------------------------------------------------------------------
-- Column-grant widening: re-issue the INSERT/UPDATE grants in full,
-- including the two new columns. (revoke-then-grant is not needed here —
-- these are ADDITIONAL columns on an already-locked-down table; the
-- pre-existing revoke all + grant select/delete from the prior migration
-- still stands untouched.)
-- ---------------------------------------------------------------------------
grant insert (
  id, contract_id, article_id, article_number, description, quantity,
  unit_price, purchase_price, is_volume, sort_order
) on public.contract_line_items to authenticated;

grant update (
  article_id, article_number, description, quantity, unit_price,
  purchase_price, is_volume, sort_order
) on public.contract_line_items to authenticated;
