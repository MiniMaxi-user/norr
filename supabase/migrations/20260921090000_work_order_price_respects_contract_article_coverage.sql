-- Work order sales price respects contract article coverage (issue #208).
--
-- A work order may be linked to a contract (`work_orders.contract_id`).
-- Contracts carry per-contract coverage rules (see
-- 20260905100000_contracts_billing_period_line_items_and_article_rules.sql):
-- `contract_article_rules` (per article) and `contract_article_group_rules`
-- (per article group, applying to the whole subtree via
-- `article_groups.parent_group_id`). CAREFUL, the column is inverted relative
-- to the UI: `is_excluded = true` means "excluded from SEPARATE INVOICING" =
-- COVERED by the contract = shown as "Included"; `is_excluded = false` = NOT
-- covered = shown as "Excluded" (see `coverageStateFromRule` in
-- app/(app)/contracts/components/contract-article-coverage-section.tsx).
--
-- Covered(contract, article):
--   * false when the contract is null;
--   * collect every rule matching the article: its own article-level rule plus
--     group rules on the article's group AND all ancestor groups;
--   * any matching rule with is_excluded = false (UI "Excluded") => NOT
--     covered -- "Excluded overrules included", absolute, whatever the
--     specificity;
--   * else any matching rule with is_excluded = true (UI "Included") =>
--     covered;
--   * else not covered.
-- When an article is covered, its SALE price on the work order's auto-draft
-- quote line is 0 (travel/work time: the article returned by
-- resolve_billing_rate; consumed material: work_order_articles.article_id).
-- The purchase price snapshot is untouched.
--
-- Design:
-- 1. `is_article_covered_by_contract` (single) and `contract_covered_article_ids`
--    (batch for the app layer). SECURITY INVOKER: members can SELECT the rule
--    tables / articles / article_groups under normal RLS.
-- 2. The bodies of the two existing sync triggers were moved VERBATIM (LIVE
--    bodies: sync_time_entry_to_auto_draft_quote from
--    20260920090000_travel_work_time_rounding_settings.sql,
--    sync_work_order_article_to_auto_draft_quote from
--    20260901090000_work_order_auto_draft_quotes.sql, no later redefinitions)
--    into per-row functions `sync_time_entry_line(public.time_entries)` and
--    `sync_work_order_article_line(public.work_order_articles)`, changing only
--    `new.` -> `p_*.`, `return new` -> `return`, and adding the coverage check
--    on unit_price. The triggers are now thin wrappers (the time-entry one
--    keeps its re-parenting cleanup). Reusing the exact same per-row logic for
--    resync guarantees uncovered lines are priced exactly as before.
--    Resync deliberately does NOT do no-op UPDATEs on time_entries /
--    work_order_articles (would bump updated_at and fire unrelated triggers).
-- 3. Resync triggers: work_orders.contract_id change, and any
--    insert/update/delete on the two rule tables, re-run the per-row functions
--    for the affected work orders. They only ever touch is_auto_draft quotes
--    (the resync function no-ops when none exists, so promoted quotes are
--    never modified). Rule triggers are row-level; bulk rule edits cost one
--    resync pass per row (acceptable at current volumes).
--    Group-tree changes (article moved to another group, group re-parented)
--    are NOT resynced here; they take effect on the next line sync.

-- ===========================================================================
-- 1. Coverage functions
-- ===========================================================================
create or replace function public.is_article_covered_by_contract(
  p_contract_id uuid,
  p_article_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  with recursive grp(id) as (
    select a.group_id from public.articles a
      where a.id = p_article_id and a.group_id is not null
    union
    select g.parent_group_id from public.article_groups g
      join grp on g.id = grp.id
      where g.parent_group_id is not null
  ),
  matched as (
    select r.is_excluded
      from public.contract_article_rules r
      where r.contract_id = p_contract_id and r.article_id = p_article_id
    union all
    select gr.is_excluded
      from public.contract_article_group_rules gr
      where gr.contract_id = p_contract_id
        and gr.article_group_id in (select id from grp)
  )
  select p_contract_id is not null
    and p_article_id is not null
    and exists (select 1 from matched where is_excluded)
    and not exists (select 1 from matched where not is_excluded);
$$;

comment on function public.is_article_covered_by_contract(uuid, uuid) is
  'Issue #208: true when the article is covered by the contract (sale price 0 on work order quotes). Collects the article rule + group rules on its group and all ancestor groups; any rule with is_excluded=false (UI "Excluded") overrules everything (not covered); else any is_excluded=true (UI "Included") => covered; else false. Null contract => false. SECURITY INVOKER, stable.';

create or replace function public.contract_covered_article_ids(
  p_contract_id uuid,
  p_article_ids uuid[]
)
returns setof uuid
language sql
stable
security invoker
set search_path = public
as $$
  select ids.id
    from (select distinct unnest(p_article_ids) as id) ids
    where public.is_article_covered_by_contract(p_contract_id, ids.id);
$$;

comment on function public.contract_covered_article_ids(uuid, uuid[]) is
  'Issue #208: batch variant of is_article_covered_by_contract; returns the subset of p_article_ids covered by the contract. SECURITY INVOKER, stable.';

revoke all on function public.is_article_covered_by_contract(uuid, uuid) from public, anon;
grant execute on function public.is_article_covered_by_contract(uuid, uuid) to authenticated;
revoke all on function public.contract_covered_article_ids(uuid, uuid[]) from public, anon;
grant execute on function public.contract_covered_article_ids(uuid, uuid[]) to authenticated;

-- ===========================================================================
-- 2a. Per-row time entry sync (body moved from the live trigger function)
-- ===========================================================================
create or replace function public.sync_time_entry_line(p_entry public.time_entries)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote_id uuid;
  v_quote_client_id uuid;
  v_contract_id uuid;
  v_entry_type text;
  v_is_travel boolean;
  v_billable boolean;
  v_total_minutes numeric;
  v_minimum_minutes integer;
  v_rounding_minutes integer;
  v_rounding_direction text;
  v_net_minutes numeric;
  v_quantity numeric;
  v_resolved_article_id uuid;
  v_resolved_sale_price numeric;
  v_resolved_purchase_price numeric;
  v_article_number text;
  v_article_description text;
  v_line_description text;
  v_unit_price numeric;
  v_existing_line_item_id uuid;
begin
  select q.id, q.client_id into v_quote_id, v_quote_client_id
    from public.quotes q
    where q.work_order_id = p_entry.work_order_id and q.is_auto_draft
    limit 1;

  -- No auto-draft quote for this work order (never created -- a pre-
  -- migration work order -- or already promoted).
  if v_quote_id is null then
    return;
  end if;

  select rli.value into v_entry_type
    from public.reference_list_items rli
    where rli.id = p_entry.entry_type_id;

  v_billable := coalesce(v_entry_type in ('labor', 'travel'), false);
  v_is_travel := v_entry_type = 'travel';

  if not v_billable or p_entry.ended_at is null then
    delete from public.quote_line_items
      where source_time_entry_id = p_entry.id and quote_id = v_quote_id;
    return;
  end if;

  v_total_minutes := round(extract(epoch from (p_entry.ended_at - p_entry.started_at))::numeric / 60);

  if v_is_travel then
    select o.travel_time_minimum_minutes, o.travel_time_rounding_minutes, o.travel_time_rounding_direction
      into v_minimum_minutes, v_rounding_minutes, v_rounding_direction
      from public.organizations o
      where o.id = p_entry.organization_id;
  else
    select o.work_time_minimum_minutes, o.work_time_rounding_minutes, o.work_time_rounding_direction
      into v_minimum_minutes, v_rounding_minutes, v_rounding_direction
      from public.organizations o
      where o.id = p_entry.organization_id;
  end if;

  v_net_minutes := public.compute_rounded_minutes(
    v_total_minutes, v_minimum_minutes, v_rounding_minutes, v_rounding_direction
  );

  v_quantity := round((v_net_minutes / 60) * 100) / 100;

  if v_quantity is null or v_quantity <= 0 then
    delete from public.quote_line_items
      where source_time_entry_id = p_entry.id and quote_id = v_quote_id;
    return;
  end if;

  select resolved_article_id, resolved_sale_price, resolved_purchase_price
    into v_resolved_article_id, v_resolved_sale_price, v_resolved_purchase_price
    from public.resolve_billing_rate(p_entry.organization_id, v_quote_client_id, p_entry.user_id, v_is_travel);

  if v_resolved_article_id is null then
    delete from public.quote_line_items
      where source_time_entry_id = p_entry.id and quote_id = v_quote_id;
    return;
  end if;

  select a.article_number, a.description into v_article_number, v_article_description
    from public.articles a
    where a.id = v_resolved_article_id;

  v_line_description := coalesce(v_article_number || ' — ' || v_article_description, 'Time entry');

  -- Issue #208: contract coverage => sale price 0 (purchase price unchanged).
  select w.contract_id into v_contract_id
    from public.work_orders w
    where w.id = p_entry.work_order_id;

  if public.is_article_covered_by_contract(v_contract_id, v_resolved_article_id) then
    v_unit_price := 0;
  else
    v_unit_price := coalesce(v_resolved_sale_price, 0);
  end if;

  select id into v_existing_line_item_id
    from public.quote_line_items
    where source_time_entry_id = p_entry.id and quote_id = v_quote_id;

  if v_existing_line_item_id is not null then
    update public.quote_line_items
      set description = v_line_description,
          quantity = v_quantity,
          unit_price = v_unit_price,
          purchase_price = v_resolved_purchase_price,
          article_id = v_resolved_article_id,
          engineer_user_id = p_entry.user_id
      where id = v_existing_line_item_id;
  else
    insert into public.quote_line_items (
      quote_id, source_time_entry_id, description, quantity, unit_price,
      purchase_price, article_id, engineer_user_id
    ) values (
      v_quote_id, p_entry.id, v_line_description, v_quantity, v_unit_price,
      v_resolved_purchase_price, v_resolved_article_id, p_entry.user_id
    );
  end if;
end;
$$;

comment on function public.sync_time_entry_line(public.time_entries) is
  'Issue #208: per-row body of the time entry -> auto-draft quote line sync (moved verbatim from sync_time_entry_to_auto_draft_quote, plus contract coverage => unit_price 0). Called by the time_entries trigger and by the coverage resync functions. SECURITY DEFINER; internal, not granted to API roles.';

revoke all on function public.sync_time_entry_line(public.time_entries) from public, anon, authenticated;

create or replace function public.sync_time_entry_to_auto_draft_quote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_quote_id uuid;
begin
  -- work_order_id is NOT immutable on time_entries: clean up any line item
  -- left behind on the OLD work order's auto-draft quote (unchanged logic).
  if tg_op = 'UPDATE' and old.work_order_id is distinct from new.work_order_id then
    select id into v_old_quote_id
      from public.quotes
      where work_order_id = old.work_order_id and is_auto_draft
      limit 1;

    if v_old_quote_id is not null then
      delete from public.quote_line_items
        where source_time_entry_id = old.id and quote_id = v_old_quote_id;
    end if;
  end if;

  perform public.sync_time_entry_line(new);
  return new;
end;
$$;

comment on function public.sync_time_entry_to_auto_draft_quote() is
  'AFTER INSERT/UPDATE trigger on public.time_entries (issues #109, #198, #208): handles re-parenting cleanup then delegates to sync_time_entry_line (rate resolution, #198 rounding, #208 contract coverage => unit_price 0). DELETE is handled by sync_time_entry_to_auto_draft_quote_delete. SECURITY DEFINER. No-ops when no is_auto_draft quote exists for the work order.';

-- ===========================================================================
-- 2b. Per-row work order article sync
-- ===========================================================================
create or replace function public.sync_work_order_article_line(p_row public.work_order_articles)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote_id uuid;
  v_contract_id uuid;
  v_article_number text;
  v_article_description text;
  v_line_description text;
  v_sale_price numeric;
  v_purchase_price numeric;
  v_unit_price numeric;
  v_existing_line_item_id uuid;
begin
  select id into v_quote_id
    from public.quotes
    where work_order_id = p_row.work_order_id and is_auto_draft
    limit 1;

  if v_quote_id is null then
    return;
  end if;

  select a.article_number, a.description, a.sale_price, a.purchase_price
    into v_article_number, v_article_description, v_sale_price, v_purchase_price
    from public.articles a
    where a.id = p_row.article_id;

  v_line_description := coalesce(v_article_number || ' — ' || v_article_description, 'Consumed article');

  -- Issue #208: contract coverage => sale price 0 (purchase price unchanged).
  select w.contract_id into v_contract_id
    from public.work_orders w
    where w.id = p_row.work_order_id;

  if public.is_article_covered_by_contract(v_contract_id, p_row.article_id) then
    v_unit_price := 0;
  else
    v_unit_price := coalesce(v_sale_price, 0);
  end if;

  select id into v_existing_line_item_id
    from public.quote_line_items
    where source_work_order_article_id = p_row.id and quote_id = v_quote_id;

  if v_existing_line_item_id is not null then
    update public.quote_line_items
      set description = v_line_description,
          quantity = p_row.quantity,
          unit_price = v_unit_price,
          purchase_price = v_purchase_price,
          article_id = p_row.article_id
      where id = v_existing_line_item_id;
  else
    insert into public.quote_line_items (
      quote_id, source_work_order_article_id, description, quantity, unit_price,
      purchase_price, article_id
    ) values (
      v_quote_id, p_row.id, v_line_description, p_row.quantity, v_unit_price,
      v_purchase_price, p_row.article_id
    );
  end if;
end;
$$;

comment on function public.sync_work_order_article_line(public.work_order_articles) is
  'Issue #208: per-row body of the consumed article -> auto-draft quote line sync (moved verbatim from sync_work_order_article_to_auto_draft_quote, plus contract coverage => unit_price 0). Called by the work_order_articles trigger and the coverage resync functions. SECURITY DEFINER; internal, not granted to API roles.';

revoke all on function public.sync_work_order_article_line(public.work_order_articles) from public, anon, authenticated;

create or replace function public.sync_work_order_article_to_auto_draft_quote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_work_order_article_line(new);
  return new;
end;
$$;

comment on function public.sync_work_order_article_to_auto_draft_quote() is
  'AFTER INSERT/UPDATE trigger on public.work_order_articles (issues #109, #208): delegates to sync_work_order_article_line (upsert of the auto-draft quote line; contract coverage => unit_price 0). DELETE is handled by sync_work_order_article_to_auto_draft_quote_delete. SECURITY DEFINER.';

-- ===========================================================================
-- 3. Resync
-- ===========================================================================
create or replace function public.resync_work_order_auto_draft_lines(p_work_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_te public.time_entries;
  v_woa public.work_order_articles;
begin
  -- Only work orders with an auto-draft quote have anything to resync;
  -- promoted quotes (is_auto_draft = false) are never touched.
  if not exists (
    select 1 from public.quotes where work_order_id = p_work_order_id and is_auto_draft
  ) then
    return;
  end if;

  for v_te in select * from public.time_entries where work_order_id = p_work_order_id loop
    perform public.sync_time_entry_line(v_te);
  end loop;

  for v_woa in select * from public.work_order_articles where work_order_id = p_work_order_id loop
    perform public.sync_work_order_article_line(v_woa);
  end loop;
end;
$$;

comment on function public.resync_work_order_auto_draft_lines(uuid) is
  'Issue #208: re-runs the per-row line sync for every time entry and consumed article of a work order (no-op without an auto-draft quote). Used when contract coverage inputs change. SECURITY DEFINER; internal.';

revoke all on function public.resync_work_order_auto_draft_lines(uuid) from public, anon, authenticated;

create or replace function public.resync_on_work_order_contract_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.resync_work_order_auto_draft_lines(new.id);
  return new;
end;
$$;

comment on function public.resync_on_work_order_contract_change() is
  'Issue #208: AFTER UPDATE OF contract_id trigger on work_orders; resyncs that work order''s auto-draft lines.';

revoke all on function public.resync_on_work_order_contract_change() from public, anon, authenticated;

create trigger work_orders_resync_contract_coverage
  after update of contract_id on public.work_orders
  for each row
  when (old.contract_id is distinct from new.contract_id)
  execute function public.resync_on_work_order_contract_change();

create or replace function public.resync_on_contract_coverage_rule_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wo_id uuid;
  v_contract_ids uuid[] := '{}';
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_contract_ids := v_contract_ids || old.contract_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_contract_ids := v_contract_ids || new.contract_id;
  end if;

  for v_wo_id in
    select w.id from public.work_orders w
      where w.contract_id = any (v_contract_ids)
  loop
    perform public.resync_work_order_auto_draft_lines(v_wo_id);
  end loop;

  return null;
end;
$$;

comment on function public.resync_on_contract_coverage_rule_change() is
  'Issue #208: AFTER INSERT/UPDATE/DELETE row trigger on contract_article_rules and contract_article_group_rules; resyncs auto-draft lines of all work orders linked to the affected contract(s).';

revoke all on function public.resync_on_contract_coverage_rule_change() from public, anon, authenticated;

create trigger contract_article_rules_resync_coverage
  after insert or update or delete on public.contract_article_rules
  for each row execute function public.resync_on_contract_coverage_rule_change();

create trigger contract_article_group_rules_resync_coverage
  after insert or update or delete on public.contract_article_group_rules
  for each row execute function public.resync_on_contract_coverage_rule_change();

-- Supporting index for the resync lookup (work orders by contract).
create index if not exists work_orders_contract_id_idx on public.work_orders (contract_id);
