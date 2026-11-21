-- pgTAP: issue #274, 20261126130000_work_order_coverage_respects_asset_removal.sql.
-- Contract coverage (unit_price 0 on the auto-draft quote line of a consumed
-- article) stops for an asset from its removed_on. Work order date =
-- coalesce(scheduled_at, created_at) as a UTC day.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

insert into auth.users (id, email) values
  ('d2111111-1111-1111-1111-111111111111', 'owner-d@test.local');

insert into public.organizations (id, name, created_by)
values ('d1000000-0000-0000-0000-00000000000a', 'Org D', 'd2111111-1111-1111-1111-111111111111');

insert into public.memberships (user_id, organization_id, role)
values ('d2111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-00000000000a', 'owner');

insert into public.clients (id, organization_id, name)
values ('d3000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-00000000000a', 'Client D');

insert into public.sites (id, client_id, is_visit_address)
values ('d4000000-0000-0000-0000-00000000000a', 'd3000000-0000-0000-0000-00000000000a', true);

insert into public.assets (id, site_id, name, type_id)
select v.id, 'd4000000-0000-0000-0000-00000000000a', v.name, rli.id
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id,
  (values ('d7000000-0000-0000-0000-0000000000a1'::uuid, 'Asset removed'),
          ('d7000000-0000-0000-0000-0000000000a2'::uuid, 'Asset kept')) as v(id, name)
where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a' and rl.list_key = 'asset_type' and rli.value = 'hvac';

insert into public.articles (id, organization_id, article_number, description, purchase_price, sale_price)
values ('d8000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-00000000000a', 'ART-D', 'Article D', 4.00, 10.00);

insert into public.contracts (id, client_id, external_reference, start_date)
values ('d6000000-0000-0000-0000-00000000000a', 'd3000000-0000-0000-0000-00000000000a', 'Contract D', '2026-01-01');

insert into public.contract_assets (contract_id, asset_id) values
  ('d6000000-0000-0000-0000-00000000000a', 'd7000000-0000-0000-0000-0000000000a1'),
  ('d6000000-0000-0000-0000-00000000000a', 'd7000000-0000-0000-0000-0000000000a2');

insert into public.contract_article_rules (contract_id, organization_id, article_id, is_excluded)
values ('d6000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-00000000000a', 'd8000000-0000-0000-0000-00000000000a', true);

update public.contracts set status = 'active' where id = 'd6000000-0000-0000-0000-00000000000a';

-- Asset 1 removed from the contract on 2026-03-15 (fixture shortcut: direct
-- update as table owner instead of remove_contract_asset).
update public.contract_assets set removed_on = '2026-03-15', removed_at = now(), removed_by = 'd2111111-1111-1111-1111-111111111111'
 where contract_id = 'd6000000-0000-0000-0000-00000000000a' and asset_id = 'd7000000-0000-0000-0000-0000000000a1';

-- Work orders: (a) asset 1 planned on the removal day (late evening UTC still
-- counts as that day), (b) asset 1 planned the day after, (c) asset 1 not
-- planned (created today, after removal), (d) no asset, planned after removal,
-- (e) asset 2 (still on the contract) planned after the removal of asset 1.
insert into public.work_orders (id, client_id, site_id, asset_id, contract_id, external_reference, scheduled_at) values
  ('d5000000-0000-0000-0000-00000000000a', 'd3000000-0000-0000-0000-00000000000a', 'd4000000-0000-0000-0000-00000000000a', 'd7000000-0000-0000-0000-0000000000a1', 'd6000000-0000-0000-0000-00000000000a', 'WO a', '2026-03-15 23:30:00+00'),
  ('d5000000-0000-0000-0000-00000000000b', 'd3000000-0000-0000-0000-00000000000a', 'd4000000-0000-0000-0000-00000000000a', 'd7000000-0000-0000-0000-0000000000a1', 'd6000000-0000-0000-0000-00000000000a', 'WO b', '2026-03-16 00:30:00+00'),
  ('d5000000-0000-0000-0000-00000000000c', 'd3000000-0000-0000-0000-00000000000a', 'd4000000-0000-0000-0000-00000000000a', 'd7000000-0000-0000-0000-0000000000a1', 'd6000000-0000-0000-0000-00000000000a', 'WO c', null),
  ('d5000000-0000-0000-0000-00000000000d', 'd3000000-0000-0000-0000-00000000000a', null, null, 'd6000000-0000-0000-0000-00000000000a', 'WO d', '2026-06-01 10:00:00+00'),
  ('d5000000-0000-0000-0000-00000000000e', 'd3000000-0000-0000-0000-00000000000a', 'd4000000-0000-0000-0000-00000000000a', 'd7000000-0000-0000-0000-0000000000a2', 'd6000000-0000-0000-0000-00000000000a', 'WO e', '2026-06-01 10:00:00+00');

insert into public.work_order_articles (work_order_id, article_id, quantity)
select id, 'd8000000-0000-0000-0000-00000000000a', 1 from public.work_orders
 where id::text like 'd5000000-%';

create or replace function pg_temp.price(p_wo uuid) returns numeric
language sql stable as $$
  select li.unit_price from public.quote_line_items li
    join public.quotes q on q.id = li.quote_id
   where q.work_order_id = p_wo and q.is_auto_draft;
$$;

select is(pg_temp.price('d5000000-0000-0000-0000-00000000000a'), 0::numeric,
  'asset removed on D, work order dated D (late evening UTC): still covered, price 0');
select is(pg_temp.price('d5000000-0000-0000-0000-00000000000b'), 10::numeric,
  'work order dated D+1: no longer covered, standard price');
select is(pg_temp.price('d5000000-0000-0000-0000-00000000000c'), 10::numeric,
  'unplanned work order falls back to created_at (today, after removal): not covered');
select is(pg_temp.price('d5000000-0000-0000-0000-00000000000d'), 0::numeric,
  'work order without asset: coverage unchanged (price 0)');
select is(pg_temp.price('d5000000-0000-0000-0000-00000000000e'), 0::numeric,
  'work order for an asset still on the contract: covered');

-- Lines are evaluated when saved (no bulk resync): re-saving re-evaluates.
update public.work_order_articles set quantity = 2
 where work_order_id = 'd5000000-0000-0000-0000-00000000000b';
select is(pg_temp.price('d5000000-0000-0000-0000-00000000000b'), 10::numeric,
  're-saving the line re-evaluates with the same outcome (not covered)');

update public.contract_assets set removed_on = null, removed_at = null, removed_by = null
 where contract_id = 'd6000000-0000-0000-0000-00000000000a' and asset_id = 'd7000000-0000-0000-0000-0000000000a1';
update public.work_order_articles set quantity = 3
 where work_order_id = 'd5000000-0000-0000-0000-00000000000b';
select is(pg_temp.price('d5000000-0000-0000-0000-00000000000b'), 0::numeric,
  'open link again (removed_on cleared): re-saved line is covered');

select * from finish();
rollback;
