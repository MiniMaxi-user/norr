-- Issue #274: contract coverage on work orders (article price 0 on the
-- auto-draft quote lines) stops for an asset from its removed_on date.
--
-- sync_time_entry_line() and sync_work_order_article_line() (latest live
-- bodies, from 20260921090000; the resync triggers of that migration were
-- dropped by 20260921100000, so these two are the only coverage call sites)
-- are copied forward with ONE change: when the work order has a contract AND
-- an asset, coverage (unit_price 0) only applies if
-- asset_covered_by_contract_on(contract_id, asset_id, <work order date>) is
-- true. Without an asset the behaviour is unchanged.
--
-- Work order date = coalesce(scheduled_at, created_at), as a UTC calendar day
-- ((x at time zone 'UTC')::date), consistent with the UTC day boundary used
-- for removed_on / readings. scheduled_at is the planned visit moment; a work
-- order that is not planned yet falls back to its creation date.
-- As before, lines are only evaluated when a time entry / consumed article is
-- created or changed; existing frozen prices are not recalculated.

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
  v_asset_id uuid;
  v_wo_date date;
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
  select w.contract_id, w.asset_id, (coalesce(w.scheduled_at, w.created_at) at time zone 'UTC')::date
    into v_contract_id, v_asset_id, v_wo_date
    from public.work_orders w
    where w.id = p_entry.work_order_id;

  -- Issue #274: with an asset, coverage stops from the asset's removed_on.
  if public.is_article_covered_by_contract(v_contract_id, v_resolved_article_id)
     and (v_asset_id is null or public.asset_covered_by_contract_on(v_contract_id, v_asset_id, v_wo_date)) then
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
  'Issue #208: per-row body of the time entry -> auto-draft quote line sync (moved verbatim from sync_time_entry_to_auto_draft_quote, plus contract coverage => unit_price 0). Called by the time_entries trigger. Issue #274: with an asset on the work order, coverage only applies while the asset is covered on the work order date (coalesce(scheduled_at, created_at), UTC day). SECURITY DEFINER; internal, not granted to API roles.';

revoke all on function public.sync_time_entry_line(public.time_entries) from public, anon, authenticated;

create or replace function public.sync_work_order_article_line(p_row public.work_order_articles)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote_id uuid;
  v_contract_id uuid;
  v_asset_id uuid;
  v_wo_date date;
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
  select w.contract_id, w.asset_id, (coalesce(w.scheduled_at, w.created_at) at time zone 'UTC')::date
    into v_contract_id, v_asset_id, v_wo_date
    from public.work_orders w
    where w.id = p_row.work_order_id;

  -- Issue #274: with an asset, coverage stops from the asset's removed_on.
  if public.is_article_covered_by_contract(v_contract_id, p_row.article_id)
     and (v_asset_id is null or public.asset_covered_by_contract_on(v_contract_id, v_asset_id, v_wo_date)) then
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
  'Issue #208: per-row body of the consumed article -> auto-draft quote line sync (moved verbatim from sync_work_order_article_to_auto_draft_quote, plus contract coverage => unit_price 0). Called by the work_order_articles trigger. Issue #274: with an asset on the work order, coverage only applies while the asset is covered on the work order date (coalesce(scheduled_at, created_at), UTC day). SECURITY DEFINER; internal, not granted to API roles.';

revoke all on function public.sync_work_order_article_line(public.work_order_articles) from public, anon, authenticated;
