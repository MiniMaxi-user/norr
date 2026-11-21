-- pgTAP: stock deduction on work_order_articles is gated on the `inventory`
-- module (issue #247, 20261126110000_inventory_feature_gates_stock_deduction.sql).
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

insert into auth.users (id, email) values
  ('f2111111-1111-1111-1111-111111111111', 'owner-f@test.local'),
  ('f2333333-3333-3333-3333-333333333333', 'engineer-f@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

-- Fixtures are inserted as the table owner (memberships bootstrap policy rejects multi-row inserts).
insert into public.organizations (id, name, created_by)
values ('f1000000-0000-0000-0000-00000000000a', 'Org F', 'f2111111-1111-1111-1111-111111111111');

insert into public.memberships (user_id, organization_id, role) values
  ('f2111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-00000000000a', 'owner'),
  ('f2333333-3333-3333-3333-333333333333', 'f1000000-0000-0000-0000-00000000000a', 'engineer');

insert into public.clients (id, organization_id, name)
values ('f3000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-00000000000a', 'Client F');

insert into public.articles (id, organization_id, article_number, description)
values ('f6000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-00000000000a', 'ART-F-001', 'Filter F');

insert into public.work_orders (id, client_id, external_reference, assigned_to)
values ('f4000000-0000-0000-0000-00000000000a', 'f3000000-0000-0000-0000-00000000000a', 'WO F', 'f2333333-3333-3333-3333-333333333333');

insert into public.warehouse_stock (id, warehouse_id, article_id, quantity)
values (
  'f8000000-0000-0000-0000-00000000000a',
  (select id from public.warehouses where organization_id = 'f1000000-0000-0000-0000-00000000000a' and user_id = 'f2333333-3333-3333-3333-333333333333'),
  'f6000000-0000-0000-0000-00000000000a',
  10
);

select pg_temp.act_as('f2333333-3333-3333-3333-333333333333');

select ok(
  public.organization_has_feature('f1000000-0000-0000-0000-00000000000a', 'inventory'),
  'new org has inventory enabled by the default bundle'
);

insert into public.work_order_articles (work_order_id, article_id, quantity)
values ('f4000000-0000-0000-0000-00000000000a', 'f6000000-0000-0000-0000-00000000000a', 3);

select is(
  (select quantity from public.warehouse_stock where id = 'f8000000-0000-0000-0000-00000000000a'),
  7::numeric,
  'inventory on: consumption deducts stock (10 - 3)'
);

-- Switch inventory off (no client write path; do it as the table owner).
reset role;
update public.organization_features set enabled = false
 where organization_id = 'f1000000-0000-0000-0000-00000000000a' and feature_key = 'inventory';
select pg_temp.act_as('f2333333-3333-3333-3333-333333333333');

insert into public.work_order_articles (work_order_id, article_id, quantity)
values ('f4000000-0000-0000-0000-00000000000a', 'f6000000-0000-0000-0000-00000000000a', 4);

select is(
  (select quantity from public.warehouse_stock where id = 'f8000000-0000-0000-0000-00000000000a'),
  7::numeric,
  'inventory off: consumption does not deduct stock'
);

select is(
  (select total_consumed from public.warehouse_stock where id = 'f8000000-0000-0000-0000-00000000000a'),
  3::numeric,
  'inventory off: total_consumed is not increased'
);

select is(
  (select count(*)::int from public.work_order_articles where work_order_id = 'f4000000-0000-0000-0000-00000000000a'),
  2,
  'inventory off: the work order article row itself is still inserted'
);

select * from finish();
rollback;
