-- Issue #247: "Inventory off: no stock deduction on work order articles".
--
-- Gates the automatic warehouse_stock deduction on the `inventory` module
-- (organization_features, 20261126100000_organization_features_and_module_
-- catalog.sql). When the organization does not have `inventory` enabled,
-- inserting a work_order_articles row no longer touches warehouse_stock.
--
-- Scope found by grep over all migrations: the only writer of warehouse_stock
-- from work order articles is deduct_warehouse_stock_for_work_order_article()
-- (20260917090000_warehouse_stock_consumption.sql), an AFTER INSERT trigger
-- on work_order_articles. It has not been redefined since. This migration
-- copies it forward with exactly one change: an early return when
-- organization_has_feature(new.organization_id, 'inventory') is false.
--
-- Reversal paths: there are none. No UPDATE/DELETE trigger exists on
-- work_order_articles that credits stock back, so editing or deleting an
-- article never produces a correction, and a module toggled mid-way cannot
-- yield negative or phantom corrections. Chosen behaviour:
--   * consumption logged while inventory is OFF is never deducted, and is NOT
--     back-filled when inventory is switched on later (stock counts start from
--     a manual count anyway; total_consumed only covers the period the module
--     was on);
--   * consumption logged while inventory is ON stays deducted if the module
--     is switched off afterwards (history is not rewritten);
--   * if a future reversal trigger is added, it must apply the same gate.

create or replace function public.deduct_warehouse_stock_for_work_order_article()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assigned_to uuid;
  v_assignee_role public.membership_role;
  v_warehouse_id uuid;
begin
  -- Inventory module off for this organization: no stock bookkeeping at all.
  if not public.organization_has_feature(new.organization_id, 'inventory') then
    return new;
  end if;

  select wo.assigned_to into v_assigned_to
  from public.work_orders wo
  where wo.id = new.work_order_id;

  if v_assigned_to is null then
    return new;
  end if;

  select m.role into v_assignee_role
  from public.memberships m
  where m.user_id = v_assigned_to
    and m.organization_id = new.organization_id;

  if v_assignee_role is distinct from 'engineer'::public.membership_role then
    return new;
  end if;

  select w.id into v_warehouse_id
  from public.warehouses w
  where w.organization_id = new.organization_id
    and w.user_id = v_assigned_to;

  if v_warehouse_id is null then
    return new;
  end if;

  update public.warehouse_stock
    set quantity = greatest(0, quantity - new.quantity),
        total_consumed = total_consumed + new.quantity,
        updated_at = now()
    where warehouse_id = v_warehouse_id
      and article_id = new.article_id;

  return new;
end;
$$;

comment on function public.deduct_warehouse_stock_for_work_order_article() is
  'AFTER INSERT trigger on public.work_order_articles (issues #182, #247): deducts the consumed quantity from the assigned engineer''s warehouse_stock row (floored at 0; total_consumed gets the full amount; last_counted_at untouched; every unresolved step is a silent no-op). Skipped entirely when the organization does not have the inventory module (organization_has_feature). No reversal path exists, so toggling the module never causes corrections; see 20261126110000 header.';
