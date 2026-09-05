-- Contracts module enhancement (issue #122): a second, independent
-- "billing_period" concept on `contracts`, a new `contract_line_items` table
-- (the articles a contract's own quotes should be pre-populated with), and
-- two new include/exclude rule tables against the Article Group tree and
-- individual articles. Purely additive to the Contracts data model — does
-- NOT wire into quote/invoice generation or the work-order-auto-draft-quote
-- trigger chain at all (confirmed with the product owner; a later story
-- consumes this data).
--
-- Read `20260823150000_contracts_core.sql` in full before touching this file
-- again — every pattern below is a direct extension of that migration's own
-- design.
--
-- Design notes (read before extending):
--
-- 1. **`billing_period_id` is a SIBLING of `billing_terms_id`, not a
--    repurposing of it.** `billing_terms_id` means "how often this contract
--    is actually invoiced" (Monthly/Quarterly/Annually/Per-visit/One-time).
--    `billing_period_id` means "how the contract's own VALUE accrues/
--    recurs" (e.g. a monthly recurring value that happens to get invoiced
--    annually, or vice versa) — a genuinely separate axis, confirmed by the
--    product owner. New flat, standalone reference list `billing_period`
--    (Monthly/Quarterly/Annually — a strict subset of `billing_terms`'
--    values, but its own list: no Per-visit/One-time concept applies to
--    "how the value recurs"). `contracts.billing_period_id` is nullable,
--    standalone (no dependent-list parent), and gets NO default-fill
--    treatment — `billing_terms_id` itself has none either (only `type_id`
--    is defaulted in `derive_contract_organization_id`, because it's the
--    only NOT NULL reference-list column on `contracts`), so this mirrors
--    that exactly for consistency between the two sibling fields.
--    `validate_contract_reference_items` gets a fourth, structurally
--    identical branch (standalone, no parent-item cross-check, exactly like
--    `billing_terms_id`'s own branch).
--
-- 2. **`contract_line_items`** — the articles a Quote generated from this
--    contract should be pre-populated with (the invoicing basis for
--    whatever gets billed under the contract). Deliberately simpler than
--    `quote_line_items`: no discount/engineer/auto-draft-sync machinery
--    (none of that applies to a contract, which is not itself an invoiced
--    document). Mirrors `quote_line_items`' article-based columns
--    (`20260824090000_quotes_core.sql`,
--    `20260830100000_work_order_articles_and_quote_traceability.sql`,
--    `20260903130000_quote_line_items_article_number.sql`):
--      - `article_id` is REQUIRED here (unlike `quote_line_items.asset_id`,
--        which is optional context) — an article is the entire point of a
--        contract line item.
--      - `article_number text` is a free-editable snapshot, same "decouple
--        display from the live, renumberable article" reasoning as
--        `quote_line_items.article_number`'s own doc comment. Nullable,
--        populated by the application layer at write time (not a trigger),
--        same division of responsibility `quote_line_items.article_number`
--        already established (that column is populated/edited by
--        `app/(app)/quotes`, not a DB trigger — this one will be populated/
--        edited by `app/(app)/contracts` the same way).
--      - `description text` is nullable here (unlike
--        `quote_line_items.description text not null`) — a contract line
--        item is always article-backed (`article_id not null`), so a
--        missing description can always fall back to the live article's own
--        `description` at the application layer; there is no manual/
--        free-text line item case on this table the way there is on
--        `quote_line_items` (whose `not null` reflects that manual lines
--        have no other source of a description at all).
--      - `unit_price numeric(12,2)` is the overridable SALE price only.
--        **No purchase_price column, ever** — purchase price is always read
--        live from `articles.purchase_price` at the application layer,
--        exactly the same "never snapshot the cost side" convention
--        `lib/rate-overrides` (client/engineer rate overrides) and
--        `work_order_articles` (design note 2,
--        `20260830100000_work_order_articles_and_quote_traceability.sql`)
--        already established. Picking an article default-fills `unit_price`
--        from that article's `sale_price` at the application layer (same UX
--        as `RateSettingsSection`) — no DB-level default-fill trigger.
--      - `organization_id` denormalized from the CONTRACT via `contract_id`
--        (`derive_contract_line_item_organization_id`, mirrors
--        `derive_contract_asset_organization_id`/
--        `derive_quote_line_item_organization_id` exactly).
--      - Cross-org validation: `article_id` must belong to the SAME
--        organization as the contract (`validate_contract_line_item_
--        relations`) — no client-scoping check (unlike `contract_assets`'
--        asset/client match), since articles are organization-scoped, not
--        client-scoped, same reasoning `work_order_articles`/
--        `quote_line_items.article_id`'s own org-only checks already use.
--
-- 3. **`contract_article_group_rules` / `contract_article_rules`** — per-
--    contract include/exclude marking against the existing `article_groups`
--    tree and individual `articles`, for "is this group/article covered by
--    the contract (excluded from being separately invoiced) or explicitly
--    NOT covered (bill it separately)". Consuming this at quote time is
--    future work, out of scope here — this migration only builds the data
--    model + read/write actions. Both tables are structurally identical
--    (natural-key-ish shape via a unique constraint, not a composite PK,
--    since each also needs its own surrogate `id` for the app layer to
--    address a single rule row directly, e.g. for delete-by-id):
--      - `is_excluded boolean not null default true` — `true` means this
--        group/article is EXCLUDED from separate invoicing (i.e. covered by
--        the contract); `false` means explicitly INCLUDED (NOT covered, so
--        bill it separately). A row's mere EXISTENCE means "this contract
--        has an explicit rule here" — direction is carried by the flag, not
--        by presence/absence alone. Defaults to `true` (the more common
--        "this is covered by the contract" case) purely as a sensible
--        column default; the application layer always sets this explicitly
--        on insert regardless.
--      - `unique (contract_id, article_group_id)` /
--        `unique (contract_id, article_id)` — at most one rule per group/
--        article per contract. A second rule for the same group/article is
--        an application-layer upsert (`set_contract_article_group_rule`/
--        `set_contract_article_rule` below use `upsert`, not `insert`), not
--        a raw `23505` the caller has to handle.
--      - Same `organization_id` denormalization (from the contract) and
--        cross-org validation shape as `contract_line_items` above:
--        `article_group_id`/`article_id` must belong to the contract's own
--        organization (no client-scoping — `article_groups`, like
--        `articles`, is organization-scoped, not client-scoped).
--      - UPDATE IS granted, but scoped to `is_excluded` ONLY — the one
--        mutable thing about a rule is its direction. `contract_id`/
--        `article_group_id`/`article_id` are insert-only (immutable pairing
--        after creation, same "delete + re-insert to change the pair"
--        stance as `contract_assets`/`quote_line_items.quote_id`).
--
-- 4. **RLS write boundary — same as `contracts`/`contract_assets` (design
--    note 4, `20260823150000_contracts_core.sql`): owner OR finance for
--    INSERT/UPDATE/DELETE; any org member for SELECT.** Applies identically
--    to all three new tables in this migration — "if you can manage the
--    contract, you can manage its line items and article rules".
--
-- Column-grant lockdown: all three new tables get the usual `revoke all`
-- treatment before explicit grants (this project's public schema grants ALL
-- to authenticated/anon by default on new tables). `id` is included in each
-- INSERT grant (this migration's own RLS test explicitly assigns
-- deterministic fixture ids on insert), same reasoning as every other new
-- table in this schema.

-- ---------------------------------------------------------------------------
-- 1. contracts.billing_period_id — see design note 1 above.
-- ---------------------------------------------------------------------------
alter table public.contracts
  add column billing_period_id uuid references public.reference_list_items (id);

comment on column public.contracts.billing_period_id is
  'FK into reference_list_items for this organization''s billing_period list (Monthly/Quarterly/Annually). Nullable, standalone (not a dependent list) — an independent SIBLING concept to billing_terms_id: billing_terms_id is "how often this contract is invoiced", billing_period_id is "how the contract''s own value accrues/recurs" (e.g. a monthly value invoiced annually, or an annual value invoiced monthly). No default-fill on insert, matching billing_terms_id''s own no-default-fill treatment (only type_id, the sole NOT NULL reference-list column on this table, gets one). Validated by validate_contract_reference_items.';

create index contracts_billing_period_id_idx on public.contracts (billing_period_id);

-- Extend (CREATE OR REPLACE, not a parallel trigger) validate_contract_reference_items
-- with the billing_period_id branch (structurally identical to the existing
-- billing_terms_id branch: standalone, no parent-item cross-check), and
-- widen the trigger's column list to include billing_period_id.
create or replace function public.validate_contract_reference_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type_org uuid;
  v_type_key text;
  v_sla_org uuid;
  v_sla_key text;
  v_sla_parent_item_id uuid;
  v_billing_org uuid;
  v_billing_key text;
  v_billing_period_org uuid;
  v_billing_period_key text;
begin
  if new.type_id is not null then
    select rl.organization_id, rl.list_key into v_type_org, v_type_key
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rli.id = new.type_id;

    if v_type_org is null then
      raise exception 'contracts.type_id % does not reference an existing reference_list_items row', new.type_id
        using errcode = '23503';
    elsif v_type_key <> 'contract_type' then
      raise exception 'contracts.type_id must reference an item from the contract_type reference list (got list_key=%)', v_type_key
        using errcode = '23514';
    elsif v_type_org <> new.organization_id then
      raise exception 'contracts.type_id must belong to the same organization as the contract'
        using errcode = '23514';
    end if;
  end if;

  if new.sla_tier_id is not null then
    select rl.organization_id, rl.list_key, rli.parent_item_id
    into v_sla_org, v_sla_key, v_sla_parent_item_id
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rli.id = new.sla_tier_id;

    if v_sla_org is null then
      raise exception 'contracts.sla_tier_id % does not reference an existing reference_list_items row', new.sla_tier_id
        using errcode = '23503';
    elsif v_sla_key <> 'sla_tier' then
      raise exception 'contracts.sla_tier_id must reference an item from the sla_tier reference list (got list_key=%)', v_sla_key
        using errcode = '23514';
    elsif v_sla_org <> new.organization_id then
      raise exception 'contracts.sla_tier_id must belong to the same organization as the contract'
        using errcode = '23514';
    elsif new.type_id is null or v_sla_parent_item_id is distinct from new.type_id then
      raise exception 'contracts.sla_tier_id must be a tier of the contract''s own type_id (the sla_tier item''s parent_item_id must equal contracts.type_id)'
        using errcode = '23514';
    end if;
  end if;

  if new.billing_terms_id is not null then
    select rl.organization_id, rl.list_key into v_billing_org, v_billing_key
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rli.id = new.billing_terms_id;

    if v_billing_org is null then
      raise exception 'contracts.billing_terms_id % does not reference an existing reference_list_items row', new.billing_terms_id
        using errcode = '23503';
    elsif v_billing_key <> 'billing_terms' then
      raise exception 'contracts.billing_terms_id must reference an item from the billing_terms reference list (got list_key=%)', v_billing_key
        using errcode = '23514';
    elsif v_billing_org <> new.organization_id then
      raise exception 'contracts.billing_terms_id must belong to the same organization as the contract'
        using errcode = '23514';
    end if;
  end if;

  if new.billing_period_id is not null then
    select rl.organization_id, rl.list_key into v_billing_period_org, v_billing_period_key
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rli.id = new.billing_period_id;

    if v_billing_period_org is null then
      raise exception 'contracts.billing_period_id % does not reference an existing reference_list_items row', new.billing_period_id
        using errcode = '23503';
    elsif v_billing_period_key <> 'billing_period' then
      raise exception 'contracts.billing_period_id must reference an item from the billing_period reference list (got list_key=%)', v_billing_period_key
        using errcode = '23514';
    elsif v_billing_period_org <> new.organization_id then
      raise exception 'contracts.billing_period_id must belong to the same organization as the contract'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_contract_reference_items() is
  'BEFORE INSERT/UPDATE OF type_id, sla_tier_id, billing_terms_id, billing_period_id trigger on public.contracts: rejects an item from the wrong list_key or a different organization''s reference list (all four columns alike), and additionally rejects an sla_tier_id whose parent_item_id does not match the contract''s own type_id — the cross-field dependency check that the generic reference_list_items-level trigger (validate_reference_list_item_parent) cannot express on its own. Extended in 20260905100000_contracts_billing_period_line_items_and_article_rules.sql with the billing_period_id branch (structurally identical to billing_terms_id''s: standalone, no parent-item cross-check). Runs after contracts_derive_organization_id (alphabetically later trigger name, same timing), so new.organization_id (and the default-filled type_id) are already final.';

drop trigger if exists contracts_validate_reference_items on public.contracts;

create trigger contracts_validate_reference_items
  before insert or update of type_id, sla_tier_id, billing_terms_id, billing_period_id on public.contracts
  for each row execute function public.validate_contract_reference_items();

grant insert (billing_period_id) on public.contracts to authenticated;
grant update (billing_period_id) on public.contracts to authenticated;

-- ---------------------------------------------------------------------------
-- 2. contract_line_items: the articles a Quote generated from this contract
--    should be pre-populated with (see design note 2 above). organization_id
--    is denormalized from the CONTRACT via contract_id.
-- ---------------------------------------------------------------------------
create table public.contract_line_items (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  article_id uuid not null references public.articles (id),
  article_number text,
  description text,
  quantity numeric(10, 2) not null default 1,
  unit_price numeric(12, 2) not null default 0,
  sort_order integer not null default 0,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.contract_line_items is
  'Articles which should appear on the Quote generated from this contract (issue #122) — the invoicing basis for whatever gets billed under the contract. organization_id is denormalized from contracts.organization_id (via contract_id) by derive_contract_line_item_organization_id. Deliberately has NO purchase_price column — purchase price is always read live from articles.purchase_price at the application layer (same convention as lib/rate-overrides and work_order_articles'' own missing price columns, see design note 2 in 20260905100000_contracts_billing_period_line_items_and_article_rules.sql). Does NOT wire into any quote/invoice generation logic — a later story consumes this table.';
comment on column public.contract_line_items.organization_id is
  'Denormalized from contracts.organization_id (via contract_id). Never client-writable — see derive_contract_line_item_organization_id trigger and the column-level grants below.';
comment on column public.contract_line_items.article_id is
  'The article this line item is based on. Required (unlike quote_line_items.asset_id, an article is the whole point of this row). Must belong to the same organization as the contract (validated by validate_contract_line_item_relations) — not client-scoped, since articles are organization-scoped, same reasoning as work_order_articles.article_id/quote_line_items.article_id.';
comment on column public.contract_line_items.article_number is
  'Free-text snapshot of the linked article''s article_number at the time it was added, decoupling display from the live (renumberable) article — same reasoning as quote_line_items.article_number''s own doc comment. Nullable; populated/edited by the application layer (app/(app)/contracts), not a DB trigger.';
comment on column public.contract_line_items.description is
  'Nullable — unlike quote_line_items.description (not null, since a manual/non-article line item there has no other description source), every contract_line_items row is article-backed (article_id not null), so a missing description can always fall back to the live article''s own description at the application layer.';
comment on column public.contract_line_items.quantity is
  'numeric(10,2), defaults to 1. Combined with unit_price at the application layer (never stored) for this line''s subtotal, same as quote_line_items.quantity.';
comment on column public.contract_line_items.unit_price is
  'numeric(12,2) — the overridable SALE price only (defaults to the picked article''s sale_price at the application layer, then freely editable — same UX as RateSettingsSection). Purchase price is deliberately NOT stored here or anywhere on this table; always read live from articles.purchase_price.';

create index contract_line_items_contract_id_idx on public.contract_line_items (contract_id);
create index contract_line_items_organization_id_idx on public.contract_line_items (organization_id);
create index contract_line_items_article_id_idx on public.contract_line_items (article_id);
create index contract_line_items_created_by_idx on public.contract_line_items (created_by);
create index contract_line_items_contract_sort_idx on public.contract_line_items (contract_id, sort_order);

alter table public.contract_line_items enable row level security;
alter table public.contract_line_items force row level security;

-- Derives organization_id from contract_id (blocking cross-organization
-- re-parenting), mirrors derive_contract_asset_organization_id /
-- derive_quote_line_item_organization_id exactly.
create or replace function public.derive_contract_line_item_organization_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select c.organization_id into v_org_id
  from public.contracts c
  where c.id = new.contract_id;

  if v_org_id is null then
    raise exception 'contract_line_items.contract_id % does not reference an existing contract', new.contract_id
      using errcode = '23503';
  end if;

  if tg_op = 'UPDATE' and old.organization_id is distinct from v_org_id then
    raise exception 'Cannot move a contract line item to a contract in a different organization'
      using errcode = '23514';
  end if;

  new.organization_id := v_org_id;
  return new;
end;
$$;

comment on function public.derive_contract_line_item_organization_id() is
  'BEFORE INSERT/UPDATE OF contract_id trigger on public.contract_line_items: sets organization_id from the referenced contract, and blocks cross-organization re-parenting. contract_id is excluded from the UPDATE column grant (immutable after creation, like quote_line_items.quote_id), so the UPDATE branch here is a defense-in-depth backstop.';

create trigger contract_line_items_derive_organization_id
  before insert or update of contract_id on public.contract_line_items
  for each row execute function public.derive_contract_line_item_organization_id();

-- Cross-field consistency: article_id must belong to the SAME organization as
-- the contract. SECURITY DEFINER so it can resolve the referenced article
-- regardless of the caller's own RLS visibility (mirrors
-- validate_work_order_article_relations' reasoning).
create or replace function public.validate_contract_line_item_relations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_article_org_id uuid;
begin
  select organization_id into v_article_org_id
  from public.articles
  where id = new.article_id;

  if v_article_org_id is null then
    raise exception 'contract_line_items.article_id % does not reference an existing article', new.article_id
      using errcode = '23503';
  elsif v_article_org_id <> new.organization_id then
    raise exception 'contract_line_items.article_id must belong to the same organization as the contract'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.validate_contract_line_item_relations() is
  'BEFORE INSERT/UPDATE OF contract_id, article_id trigger on public.contract_line_items: rejects an article_id from a different organization than the contract. contract_id is excluded from the UPDATE column grant, so the contract_id branch of this trigger''s WHEN clause is a defense-in-depth backstop. Runs after contract_line_items_derive_organization_id (alphabetically later trigger name, same timing), so new.organization_id is already final.';

create trigger contract_line_items_validate_relations
  before insert or update of contract_id, article_id on public.contract_line_items
  for each row execute function public.validate_contract_line_item_relations();

create trigger contract_line_items_set_created_by
  before insert on public.contract_line_items
  for each row execute function public.set_created_by();

create trigger contract_line_items_set_updated_at
  before update on public.contract_line_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS policies: contract_line_items — same owner-or-finance write boundary as
-- contracts itself (design note 4 above).
-- ---------------------------------------------------------------------------

create policy "contract_line_items_select_member"
on public.contract_line_items
for select
to authenticated
using (public.is_member_of_org(organization_id));

create policy "contract_line_items_insert_owner_or_finance"
on public.contract_line_items
for insert
to authenticated
with check (
  public.current_member_role(organization_id) in ('owner', 'finance')
);

create policy "contract_line_items_update_owner_or_finance"
on public.contract_line_items
for update
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'finance')
)
with check (
  public.current_member_role(organization_id) in ('owner', 'finance')
);

create policy "contract_line_items_delete_owner_or_finance"
on public.contract_line_items
for delete
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'finance')
);

revoke all on public.contract_line_items from authenticated;

grant select, delete on public.contract_line_items to authenticated;
-- organization_id intentionally excluded: derived by
-- derive_contract_line_item_organization_id. created_by intentionally
-- excluded: stamped by set_created_by. contract_id is accepted on INSERT
-- only (immutable thereafter, like quote_line_items.quote_id): no UPDATE
-- grant for it.
grant insert (
  id, contract_id, article_id, article_number, description, quantity,
  unit_price, sort_order
) on public.contract_line_items to authenticated;
grant update (
  article_id, article_number, description, quantity, unit_price, sort_order
) on public.contract_line_items to authenticated;

-- ---------------------------------------------------------------------------
-- 3a. contract_article_group_rules: per-contract include/exclude rule against
--    the article_groups tree (see design note 3 above).
-- ---------------------------------------------------------------------------
create table public.contract_article_group_rules (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  article_group_id uuid not null references public.article_groups (id) on delete cascade,
  is_excluded boolean not null default true,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (contract_id, article_group_id)
);

comment on table public.contract_article_group_rules is
  'Per-contract include/exclude rule against an article_groups tree node (issue #122). A row''s mere existence means "this contract has an explicit rule for this group"; is_excluded carries the direction: true = the group is EXCLUDED from separate invoicing (covered by the contract), false = explicitly INCLUDED (NOT covered, bill it separately). organization_id is denormalized from contracts.organization_id (via contract_id) by derive_contract_article_group_rule_organization_id. unique(contract_id, article_group_id): at most one rule per group per contract — a second rule for the same group is an application-layer upsert (see set_contract_article_group_rule in app/(app)/contracts/actions.ts), not a raw 23505 the caller has to handle. Consuming this data at quote-generation time is future work, out of scope here.';
comment on column public.contract_article_group_rules.organization_id is
  'Denormalized from contracts.organization_id (via contract_id). Never client-writable — see derive_contract_article_group_rule_organization_id trigger and the column-level grants below.';
comment on column public.contract_article_group_rules.article_group_id is
  'FK into article_groups (the org''s Article Group tree, 20260829100000_articles_core.sql). Must belong to the same organization as the contract (validated by validate_contract_article_group_rule_relations) — not client-scoped, article_groups is organization-scoped.';
comment on column public.contract_article_group_rules.is_excluded is
  'true = this group is EXCLUDED from separate invoicing (covered by the contract); false = explicitly INCLUDED (NOT covered, bill it separately). Defaults to true (the more common "covered by the contract" case) as a column default only — the application layer always sets this explicitly on write.';

create index contract_article_group_rules_contract_id_idx on public.contract_article_group_rules (contract_id);
create index contract_article_group_rules_organization_id_idx on public.contract_article_group_rules (organization_id);
create index contract_article_group_rules_article_group_id_idx on public.contract_article_group_rules (article_group_id);
create index contract_article_group_rules_created_by_idx on public.contract_article_group_rules (created_by);

alter table public.contract_article_group_rules enable row level security;
alter table public.contract_article_group_rules force row level security;

create or replace function public.derive_contract_article_group_rule_organization_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select c.organization_id into v_org_id
  from public.contracts c
  where c.id = new.contract_id;

  if v_org_id is null then
    raise exception 'contract_article_group_rules.contract_id % does not reference an existing contract', new.contract_id
      using errcode = '23503';
  end if;

  if tg_op = 'UPDATE' and old.organization_id is distinct from v_org_id then
    raise exception 'Cannot move a contract article group rule to a contract in a different organization'
      using errcode = '23514';
  end if;

  new.organization_id := v_org_id;
  return new;
end;
$$;

comment on function public.derive_contract_article_group_rule_organization_id() is
  'BEFORE INSERT/UPDATE OF contract_id trigger on public.contract_article_group_rules: sets organization_id from the referenced contract, and blocks cross-organization re-parenting. contract_id/article_group_id are excluded from the UPDATE column grant (immutable pairing after creation — delete + re-insert to change either side, like contract_assets), so the UPDATE branch here is a defense-in-depth backstop.';

create trigger contract_article_group_rules_derive_organization_id
  before insert or update of contract_id on public.contract_article_group_rules
  for each row execute function public.derive_contract_article_group_rule_organization_id();

create or replace function public.validate_contract_article_group_rule_relations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_org_id uuid;
begin
  select organization_id into v_group_org_id
  from public.article_groups
  where id = new.article_group_id;

  if v_group_org_id is null then
    raise exception 'contract_article_group_rules.article_group_id % does not reference an existing article group', new.article_group_id
      using errcode = '23503';
  elsif v_group_org_id <> new.organization_id then
    raise exception 'contract_article_group_rules.article_group_id must belong to the same organization as the contract'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.validate_contract_article_group_rule_relations() is
  'BEFORE INSERT/UPDATE OF contract_id, article_group_id trigger on public.contract_article_group_rules: rejects an article_group_id from a different organization than the contract. Runs after contract_article_group_rules_derive_organization_id (alphabetically later trigger name, same timing), so new.organization_id is already final.';

create trigger contract_article_group_rules_validate_relations
  before insert or update of contract_id, article_group_id on public.contract_article_group_rules
  for each row execute function public.validate_contract_article_group_rule_relations();

create trigger contract_article_group_rules_set_created_by
  before insert on public.contract_article_group_rules
  for each row execute function public.set_created_by();

create policy "contract_article_group_rules_select_member"
on public.contract_article_group_rules
for select
to authenticated
using (public.is_member_of_org(organization_id));

create policy "contract_article_group_rules_insert_owner_or_finance"
on public.contract_article_group_rules
for insert
to authenticated
with check (
  public.current_member_role(organization_id) in ('owner', 'finance')
);

create policy "contract_article_group_rules_update_owner_or_finance"
on public.contract_article_group_rules
for update
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'finance')
)
with check (
  public.current_member_role(organization_id) in ('owner', 'finance')
);

create policy "contract_article_group_rules_delete_owner_or_finance"
on public.contract_article_group_rules
for delete
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'finance')
);

revoke all on public.contract_article_group_rules from authenticated;

grant select, delete on public.contract_article_group_rules to authenticated;
-- organization_id intentionally excluded: derived by
-- derive_contract_article_group_rule_organization_id. created_by
-- intentionally excluded: stamped by set_created_by. contract_id/
-- article_group_id are insert-only (immutable pairing — delete + re-insert
-- to change either side, like contract_assets); only is_excluded is
-- meaningfully editable in place.
grant insert (
  id, contract_id, article_group_id, is_excluded
) on public.contract_article_group_rules to authenticated;
grant update (
  is_excluded
) on public.contract_article_group_rules to authenticated;

-- ---------------------------------------------------------------------------
-- 3b. contract_article_rules: identical shape to
--    contract_article_group_rules, just against individual articles instead
--    of article_groups (see design note 3 above).
-- ---------------------------------------------------------------------------
create table public.contract_article_rules (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  article_id uuid not null references public.articles (id) on delete cascade,
  is_excluded boolean not null default true,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (contract_id, article_id)
);

comment on table public.contract_article_rules is
  'Per-contract include/exclude rule against an individual article (issue #122) — the article-level sibling of contract_article_group_rules, identical shape/semantics (see that table''s own comment for the full is_excluded direction/upsert reasoning), just article_id instead of article_group_id. unique(contract_id, article_id): at most one rule per article per contract.';
comment on column public.contract_article_rules.organization_id is
  'Denormalized from contracts.organization_id (via contract_id). Never client-writable — see derive_contract_article_rule_organization_id trigger and the column-level grants below.';
comment on column public.contract_article_rules.article_id is
  'FK into articles. Must belong to the same organization as the contract (validated by validate_contract_article_rule_relations) — not client-scoped, articles is organization-scoped.';
comment on column public.contract_article_rules.is_excluded is
  'true = this article is EXCLUDED from separate invoicing (covered by the contract); false = explicitly INCLUDED (NOT covered, bill it separately). Same semantics as contract_article_group_rules.is_excluded.';

create index contract_article_rules_contract_id_idx on public.contract_article_rules (contract_id);
create index contract_article_rules_organization_id_idx on public.contract_article_rules (organization_id);
create index contract_article_rules_article_id_idx on public.contract_article_rules (article_id);
create index contract_article_rules_created_by_idx on public.contract_article_rules (created_by);

alter table public.contract_article_rules enable row level security;
alter table public.contract_article_rules force row level security;

create or replace function public.derive_contract_article_rule_organization_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select c.organization_id into v_org_id
  from public.contracts c
  where c.id = new.contract_id;

  if v_org_id is null then
    raise exception 'contract_article_rules.contract_id % does not reference an existing contract', new.contract_id
      using errcode = '23503';
  end if;

  if tg_op = 'UPDATE' and old.organization_id is distinct from v_org_id then
    raise exception 'Cannot move a contract article rule to a contract in a different organization'
      using errcode = '23514';
  end if;

  new.organization_id := v_org_id;
  return new;
end;
$$;

comment on function public.derive_contract_article_rule_organization_id() is
  'BEFORE INSERT/UPDATE OF contract_id trigger on public.contract_article_rules: sets organization_id from the referenced contract, and blocks cross-organization re-parenting. contract_id/article_id are excluded from the UPDATE column grant (immutable pairing after creation, like contract_article_group_rules), so the UPDATE branch here is a defense-in-depth backstop.';

create trigger contract_article_rules_derive_organization_id
  before insert or update of contract_id on public.contract_article_rules
  for each row execute function public.derive_contract_article_rule_organization_id();

create or replace function public.validate_contract_article_rule_relations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_article_org_id uuid;
begin
  select organization_id into v_article_org_id
  from public.articles
  where id = new.article_id;

  if v_article_org_id is null then
    raise exception 'contract_article_rules.article_id % does not reference an existing article', new.article_id
      using errcode = '23503';
  elsif v_article_org_id <> new.organization_id then
    raise exception 'contract_article_rules.article_id must belong to the same organization as the contract'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.validate_contract_article_rule_relations() is
  'BEFORE INSERT/UPDATE OF contract_id, article_id trigger on public.contract_article_rules: rejects an article_id from a different organization than the contract. Runs after contract_article_rules_derive_organization_id (alphabetically later trigger name, same timing), so new.organization_id is already final.';

create trigger contract_article_rules_validate_relations
  before insert or update of contract_id, article_id on public.contract_article_rules
  for each row execute function public.validate_contract_article_rule_relations();

create trigger contract_article_rules_set_created_by
  before insert on public.contract_article_rules
  for each row execute function public.set_created_by();

create policy "contract_article_rules_select_member"
on public.contract_article_rules
for select
to authenticated
using (public.is_member_of_org(organization_id));

create policy "contract_article_rules_insert_owner_or_finance"
on public.contract_article_rules
for insert
to authenticated
with check (
  public.current_member_role(organization_id) in ('owner', 'finance')
);

create policy "contract_article_rules_update_owner_or_finance"
on public.contract_article_rules
for update
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'finance')
)
with check (
  public.current_member_role(organization_id) in ('owner', 'finance')
);

create policy "contract_article_rules_delete_owner_or_finance"
on public.contract_article_rules
for delete
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'finance')
);

revoke all on public.contract_article_rules from authenticated;

grant select, delete on public.contract_article_rules to authenticated;
-- organization_id intentionally excluded: derived by
-- derive_contract_article_rule_organization_id. created_by intentionally
-- excluded: stamped by set_created_by. contract_id/article_id are
-- insert-only (immutable pairing); only is_excluded is meaningfully editable
-- in place.
grant insert (
  id, contract_id, article_id, is_excluded
) on public.contract_article_rules to authenticated;
grant update (
  is_excluded
) on public.contract_article_rules to authenticated;

-- ---------------------------------------------------------------------------
-- Reference list: billing_period (see design note 1 above). Extending
-- seed_default_reference_lists per its documented extension pattern.
-- ---------------------------------------------------------------------------
create or replace function public.seed_default_reference_lists(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset_type_list_id uuid;
  v_asset_status_list_id uuid;
  v_contact_role_list_id uuid;
  v_asset_subtype_list_id uuid;
  v_hvac_id uuid;
  v_electrical_id uuid;
  v_plumbing_id uuid;
  v_generator_id uuid;
  v_other_id uuid;
  v_work_order_status_list_id uuid;
  v_work_order_priority_list_id uuid;
  v_contract_type_list_id uuid;
  v_sla_tier_list_id uuid;
  v_billing_terms_list_id uuid;
  v_billing_period_list_id uuid;
  v_maintenance_id uuid;
  v_service_id uuid;
  v_installation_id uuid;
  v_warranty_id uuid;
begin
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'asset_type', 'Asset Type')
  on conflict (organization_id, list_key) do nothing;

  select id into v_asset_type_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'asset_type';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_asset_type_list_id, p_organization_id, 'hvac', 'HVAC', 1, false),
    (v_asset_type_list_id, p_organization_id, 'electrical', 'Electrical', 2, false),
    (v_asset_type_list_id, p_organization_id, 'plumbing', 'Plumbing', 3, false),
    (v_asset_type_list_id, p_organization_id, 'generator', 'Generator', 4, false),
    (v_asset_type_list_id, p_organization_id, 'other', 'Other', 5, true)
  on conflict (reference_list_id, value) do nothing;

  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'asset_status', 'Asset Status')
  on conflict (organization_id, list_key) do nothing;

  select id into v_asset_status_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'asset_status';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default, color)
  values
    (v_asset_status_list_id, p_organization_id, 'active', 'Active', 1, true, 'green'),
    (v_asset_status_list_id, p_organization_id, 'in_repair', 'In Repair', 2, false, 'amber'),
    (v_asset_status_list_id, p_organization_id, 'decommissioned', 'Decommissioned', 3, false, 'gray')
  on conflict (reference_list_id, value) do nothing;

  -- contact_role: for contacts.role_item_id. Not a dependent list — flat,
  -- like asset_type/asset_status.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'contact_role', 'Contact Role')
  on conflict (organization_id, list_key) do nothing;

  select id into v_contact_role_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'contact_role';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_contact_role_list_id, p_organization_id, 'primary', 'Primary', 1, true),
    (v_contact_role_list_id, p_organization_id, 'billing', 'Billing', 2, false),
    (v_contact_role_list_id, p_organization_id, 'site_manager', 'Site manager', 3, false),
    (v_contact_role_list_id, p_organization_id, 'technical', 'Technical', 4, false)
  on conflict (reference_list_id, value) do nothing;

  -- asset_subtype: pilot dependent list, parent_list_key = asset_type. Each
  -- item's parent_item_id points at the matching asset_type item just
  -- seeded/looked-up above, in this same organization.
  insert into public.reference_lists (organization_id, list_key, name, parent_list_key)
  values (p_organization_id, 'asset_subtype', 'Asset Sub-type', 'asset_type')
  on conflict (organization_id, list_key) do nothing;

  select id into v_asset_subtype_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'asset_subtype';

  select id into v_hvac_id from public.reference_list_items where reference_list_id = v_asset_type_list_id and value = 'hvac';
  select id into v_electrical_id from public.reference_list_items where reference_list_id = v_asset_type_list_id and value = 'electrical';
  select id into v_plumbing_id from public.reference_list_items where reference_list_id = v_asset_type_list_id and value = 'plumbing';
  select id into v_generator_id from public.reference_list_items where reference_list_id = v_asset_type_list_id and value = 'generator';
  select id into v_other_id from public.reference_list_items where reference_list_id = v_asset_type_list_id and value = 'other';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, parent_item_id)
  values
    (v_asset_subtype_list_id, p_organization_id, 'compressor', 'Compressor', 1, v_hvac_id),
    (v_asset_subtype_list_id, p_organization_id, 'thermostat', 'Thermostat', 2, v_hvac_id),
    (v_asset_subtype_list_id, p_organization_id, 'ductwork', 'Ductwork', 3, v_hvac_id),
    (v_asset_subtype_list_id, p_organization_id, 'panel', 'Panel', 4, v_electrical_id),
    (v_asset_subtype_list_id, p_organization_id, 'wiring', 'Wiring', 5, v_electrical_id),
    (v_asset_subtype_list_id, p_organization_id, 'lighting', 'Lighting', 6, v_electrical_id),
    (v_asset_subtype_list_id, p_organization_id, 'pipe', 'Pipe', 7, v_plumbing_id),
    (v_asset_subtype_list_id, p_organization_id, 'valve', 'Valve', 8, v_plumbing_id),
    (v_asset_subtype_list_id, p_organization_id, 'pump', 'Pump', 9, v_plumbing_id),
    (v_asset_subtype_list_id, p_organization_id, 'engine', 'Engine', 10, v_generator_id),
    (v_asset_subtype_list_id, p_organization_id, 'transfer_switch', 'Transfer switch', 11, v_generator_id),
    (v_asset_subtype_list_id, p_organization_id, 'other_subtype', 'Other', 12, v_other_id)
  on conflict (reference_list_id, value) do nothing;

  -- work_order_status: for work_orders.status_id. Flat list, ordered
  -- lifecycle: New (default) -> Scheduled -> En Route -> In Progress ->
  -- Completed -> Invoiced.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'work_order_status', 'Work Order Status')
  on conflict (organization_id, list_key) do nothing;

  select id into v_work_order_status_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'work_order_status';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_work_order_status_list_id, p_organization_id, 'new', 'New', 1, true),
    (v_work_order_status_list_id, p_organization_id, 'scheduled', 'Scheduled', 2, false),
    (v_work_order_status_list_id, p_organization_id, 'en_route', 'En Route', 3, false),
    (v_work_order_status_list_id, p_organization_id, 'in_progress', 'In Progress', 4, false),
    (v_work_order_status_list_id, p_organization_id, 'completed', 'Completed', 5, false),
    (v_work_order_status_list_id, p_organization_id, 'invoiced', 'Invoiced', 6, false)
  on conflict (reference_list_id, value) do nothing;

  -- work_order_priority: for work_orders.priority_id. Flat list.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'work_order_priority', 'Work Order Priority')
  on conflict (organization_id, list_key) do nothing;

  select id into v_work_order_priority_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'work_order_priority';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_work_order_priority_list_id, p_organization_id, 'low', 'Low', 1, false),
    (v_work_order_priority_list_id, p_organization_id, 'normal', 'Normal', 2, true),
    (v_work_order_priority_list_id, p_organization_id, 'high', 'High', 3, false),
    (v_work_order_priority_list_id, p_organization_id, 'urgent', 'Urgent', 4, false)
  on conflict (reference_list_id, value) do nothing;

  -- contract_type: for contracts.type_id (issue #33). Flat list.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'contract_type', 'Contract Type')
  on conflict (organization_id, list_key) do nothing;

  select id into v_contract_type_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'contract_type';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_contract_type_list_id, p_organization_id, 'maintenance', 'Maintenance', 1, true),
    (v_contract_type_list_id, p_organization_id, 'service', 'Service', 2, false),
    (v_contract_type_list_id, p_organization_id, 'installation', 'Installation', 3, false),
    (v_contract_type_list_id, p_organization_id, 'warranty', 'Warranty', 4, false)
  on conflict (reference_list_id, value) do nothing;

  -- sla_tier: SECOND pilot of the dependent-list mechanism (issue #33),
  -- parent_list_key = contract_type. A few tiers per contract type. `value`
  -- must be unique per LIST (not per parent group), so each item's slug is
  -- prefixed with its parent type even though several share the same
  -- display label ("Standard"). No item is marked is_default here:
  -- is_default is enforced at most-one-per-LIST (not per parent group,
  -- see enforce_single_default_reference_item), which doesn't map cleanly
  -- onto "one default tier per contract type" — sla_tier_id stays a plain
  -- nullable pick with no auto-fill, unlike contracts.type_id.
  insert into public.reference_lists (organization_id, list_key, name, parent_list_key)
  values (p_organization_id, 'sla_tier', 'SLA Tier', 'contract_type')
  on conflict (organization_id, list_key) do nothing;

  select id into v_sla_tier_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'sla_tier';

  select id into v_maintenance_id from public.reference_list_items where reference_list_id = v_contract_type_list_id and value = 'maintenance';
  select id into v_service_id from public.reference_list_items where reference_list_id = v_contract_type_list_id and value = 'service';
  select id into v_installation_id from public.reference_list_items where reference_list_id = v_contract_type_list_id and value = 'installation';
  select id into v_warranty_id from public.reference_list_items where reference_list_id = v_contract_type_list_id and value = 'warranty';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, parent_item_id)
  values
    (v_sla_tier_list_id, p_organization_id, 'maintenance_standard', 'Standard', 1, v_maintenance_id),
    (v_sla_tier_list_id, p_organization_id, 'maintenance_priority', 'Priority', 2, v_maintenance_id),
    (v_sla_tier_list_id, p_organization_id, 'maintenance_premium', 'Premium', 3, v_maintenance_id),
    (v_sla_tier_list_id, p_organization_id, 'service_standard', 'Standard', 4, v_service_id),
    (v_sla_tier_list_id, p_organization_id, 'service_express', 'Express', 5, v_service_id),
    (v_sla_tier_list_id, p_organization_id, 'installation_standard', 'Standard', 6, v_installation_id),
    (v_sla_tier_list_id, p_organization_id, 'installation_expedited', 'Expedited', 7, v_installation_id),
    (v_sla_tier_list_id, p_organization_id, 'warranty_standard', 'Standard', 8, v_warranty_id),
    (v_sla_tier_list_id, p_organization_id, 'warranty_extended', 'Extended', 9, v_warranty_id)
  on conflict (reference_list_id, value) do nothing;

  -- billing_terms: for contracts.billing_terms_id. Flat, standalone list
  -- (not dependent on contract_type).
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'billing_terms', 'Billing Terms')
  on conflict (organization_id, list_key) do nothing;

  select id into v_billing_terms_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'billing_terms';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_billing_terms_list_id, p_organization_id, 'monthly', 'Monthly', 1, true),
    (v_billing_terms_list_id, p_organization_id, 'quarterly', 'Quarterly', 2, false),
    (v_billing_terms_list_id, p_organization_id, 'annually', 'Annually', 3, false),
    (v_billing_terms_list_id, p_organization_id, 'per_visit', 'Per-visit', 4, false),
    (v_billing_terms_list_id, p_organization_id, 'one_time', 'One-time', 5, false)
  on conflict (reference_list_id, value) do nothing;

  -- billing_period: for contracts.billing_period_id (issue #122). Flat,
  -- standalone list (not dependent on contract_type, not a repurposing of
  -- billing_terms) — see design note 1 in
  -- 20260905100000_contracts_billing_period_line_items_and_article_rules.sql.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'billing_period', 'Billing Period')
  on conflict (organization_id, list_key) do nothing;

  select id into v_billing_period_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'billing_period';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_billing_period_list_id, p_organization_id, 'monthly', 'Monthly', 1, true),
    (v_billing_period_list_id, p_organization_id, 'quarterly', 'Quarterly', 2, false),
    (v_billing_period_list_id, p_organization_id, 'annually', 'Annually', 3, false)
  on conflict (reference_list_id, value) do nothing;
end;
$$;

comment on function public.seed_default_reference_lists(uuid) is
  'Idempotent (on conflict do nothing throughout). Called automatically by organizations_seed_reference_lists on every new organization, and once directly in each feature migration to backfill organizations that already existed. Extended in 20260823150000_contracts_core.sql with contract_type (flat), sla_tier (SECOND pilot dependent list, parent_list_key=contract_type), and billing_terms (flat) blocks; extended in 20260905100000_contracts_billing_period_line_items_and_article_rules.sql with billing_period (flat, standalone — an independent sibling of billing_terms, NOT a repurposing of it). Future picklists should extend this function the same way, plus a one-time backfill call in that feature''s own migration.';

-- Backfill: seed the new billing_period list (and any missing items from
-- earlier blocks) for every organization that already existed before this
-- migration ran — the organizations_seed_reference_lists trigger only fires
-- for future inserts.
do $$
declare
  r record;
begin
  for r in select id from public.organizations loop
    perform public.seed_default_reference_lists(r.id);
  end loop;
end;
$$;
