-- pgTAP tests for contract_line_items.volume_item_id / overage_unit_price
-- (issue #238, 20261122100000_contract_line_counter.sql; included_quantity was
-- dropped in 20261122130000: the line quantity is the included quantity).
--
-- Run with: supabase test db (Docker), or against the linked project via
-- `supabase db query --linked` with a forced-exception rollback.
--
-- Coverage: valid counter accepted; counter from another organization
-- rejected; item of a non-volume list rejected; counter / overage_unit_price
-- on a non-volume line rejected; negative overage price rejected;
-- included_quantity column is gone; RLS still isolates organizations.

begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

-- Fixtures are inserted as the table owner (before any act_as).
insert into auth.users (id, email) values
  ('f2111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('f2222222-2222-2222-2222-222222222222', 'owner-b@test.local');

insert into public.organizations (id, name, created_by) values
  ('f1000000-0000-0000-0000-00000000000a', 'Org A', 'f2111111-1111-1111-1111-111111111111'),
  ('f1000000-0000-0000-0000-00000000000b', 'Org B', 'f2222222-2222-2222-2222-222222222222');

insert into public.memberships (user_id, organization_id, role) values
  ('f2111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-00000000000a', 'owner');
insert into public.memberships (user_id, organization_id, role) values
  ('f2222222-2222-2222-2222-222222222222', 'f1000000-0000-0000-0000-00000000000b', 'owner');

insert into public.clients (id, organization_id, name) values
  ('f3000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-00000000000a', 'Client A'),
  ('f3000000-0000-0000-0000-00000000000b', 'f1000000-0000-0000-0000-00000000000b', 'Client B');

insert into public.contracts (id, client_id, external_reference, start_date) values
  ('f6000000-0000-0000-0000-00000000000a', 'f3000000-0000-0000-0000-00000000000a', 'Contract A', '2026-01-01'),
  ('f6000000-0000-0000-0000-00000000000b', 'f3000000-0000-0000-0000-00000000000b', 'Contract B', '2026-01-01');

insert into public.articles (id, organization_id, article_number, description) values
  ('f8000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-00000000000a', 'ART-A', 'Article A'),
  ('f8000000-0000-0000-0000-00000000000b', 'f1000000-0000-0000-0000-00000000000b', 'ART-B', 'Article B');

-- Counter items (volume list is dependent on article_unit: pick a unit as parent).
insert into public.reference_list_items (id, reference_list_id, value, label, sort_order, parent_item_id)
select v.id, vl.id, 'bw_prints', 'B/W prints', 1,
  (select u.id from public.reference_list_items u join public.reference_lists ul on ul.id = u.reference_list_id
    where ul.organization_id = vl.organization_id and ul.list_key = 'article_unit' order by u.sort_order limit 1)
from public.reference_lists vl
join (values
  ('f0000000-0000-0000-0000-0000000000a1'::uuid, 'f1000000-0000-0000-0000-00000000000a'::uuid),
  ('f0000000-0000-0000-0000-0000000000b1'::uuid, 'f1000000-0000-0000-0000-00000000000b'::uuid)
) as v(id, org_id) on v.org_id = vl.organization_id
where vl.list_key = 'volume';

-- A non-volume item in org A (billing_period list).
insert into public.reference_list_items (id, reference_list_id, value, label, sort_order)
select 'f0000000-0000-0000-0000-0000000000a2', rl.id, 'tap_extra', 'Extra', 99
from public.reference_lists rl
where rl.organization_id = 'f1000000-0000-0000-0000-00000000000a' and rl.list_key = 'billing_period';

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

select pg_temp.act_as('f2111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.contract_line_items
       (contract_id, article_id, is_volume, volume_item_id, overage_unit_price)
     values ('f6000000-0000-0000-0000-00000000000a', 'f8000000-0000-0000-0000-00000000000a',
       true, 'f0000000-0000-0000-0000-0000000000a1', 0.05) $$,
  'valid volume line with same-org volume counter is accepted'
); -- 1

select throws_ok(
  $$ insert into public.contract_line_items (contract_id, article_id, is_volume, volume_item_id)
     values ('f6000000-0000-0000-0000-00000000000a', 'f8000000-0000-0000-0000-00000000000a',
       true, 'f0000000-0000-0000-0000-0000000000b1') $$,
  '23514', null,
  'counter from another organization is rejected'
); -- 2

select throws_ok(
  $$ insert into public.contract_line_items (contract_id, article_id, is_volume, volume_item_id)
     values ('f6000000-0000-0000-0000-00000000000a', 'f8000000-0000-0000-0000-00000000000a',
       true, 'f0000000-0000-0000-0000-0000000000a2') $$,
  '23514', null,
  'item from a non-volume reference list is rejected'
); -- 3

select throws_ok(
  $$ insert into public.contract_line_items (contract_id, article_id, is_volume, volume_item_id)
     values ('f6000000-0000-0000-0000-00000000000a', 'f8000000-0000-0000-0000-00000000000a',
       false, 'f0000000-0000-0000-0000-0000000000a1') $$,
  '23514', null,
  'volume_item_id on a line with is_volume = false is rejected'
); -- 4

select hasnt_column('public', 'contract_line_items', 'included_quantity',
  'included_quantity is dropped (the line quantity is the included quantity)'); -- 5

select throws_ok(
  $$ insert into public.contract_line_items (contract_id, article_id, is_volume, overage_unit_price)
     values ('f6000000-0000-0000-0000-00000000000a', 'f8000000-0000-0000-0000-00000000000a', false, 1) $$,
  '23514', null,
  'overage_unit_price on a non-volume line is rejected'
); -- 6

select throws_ok(
  $$ insert into public.contract_line_items (contract_id, article_id, is_volume, overage_unit_price)
     values ('f6000000-0000-0000-0000-00000000000a', 'f8000000-0000-0000-0000-00000000000a', true, -1) $$,
  '23514', null,
  'negative overage_unit_price is rejected'
); -- 7

select throws_ok(
  $$ update public.contract_line_items set volume_item_id = 'f0000000-0000-0000-0000-0000000000b1'
     where contract_id = 'f6000000-0000-0000-0000-00000000000a' $$,
  '23514', null,
  'updating to a cross-org counter is rejected'
); -- 8

select is(
  (select count(*)::int from public.contract_line_items where contract_id = 'f6000000-0000-0000-0000-00000000000b'),
  0,
  'RLS: owner_a sees no contract_line_items of org B'
); -- 9

select pg_temp.act_as('f2222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.contract_line_items where volume_item_id = 'f0000000-0000-0000-0000-0000000000a1'),
  0,
  'RLS: owner_b cannot see org A counter-linked lines'
); -- 10

select * from finish();
rollback;
