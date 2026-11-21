-- pgTAP tests for public.site_contact_roles (issue #273,
-- 20261125090000_site_contact_roles.sql).
--
-- Run with: supabase test db (Docker), or against the linked project via
-- `supabase db query --linked` with a forced-exception rollback.
--
-- Coverage: valid insert + derived organization_id; same-client rule; e-mail
-- required for invoice/work_receipt (and not for visit/delivery); role check;
-- unique; RLS isolation (cross-org invisible, non-owner cannot write);
-- cascade on contact delete; old sites columns / function gone;
-- auto_send_on_completed column default; backfill shape.

begin;
create extension if not exists pgtap with schema extensions;

select plan(20);

insert into auth.users (id, email) values
  ('e2111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('e2222222-2222-2222-2222-222222222222', 'owner-b@test.local'),
  ('e2333333-3333-3333-3333-333333333333', 'planner-a@test.local');

insert into public.organizations (id, name, created_by) values
  ('e1000000-0000-0000-0000-00000000000a', 'Org A', 'e2111111-1111-1111-1111-111111111111'),
  ('e1000000-0000-0000-0000-00000000000b', 'Org B', 'e2222222-2222-2222-2222-222222222222');

insert into public.memberships (user_id, organization_id, role) values
  ('e2111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a', 'owner');
insert into public.memberships (user_id, organization_id, role) values
  ('e2222222-2222-2222-2222-222222222222', 'e1000000-0000-0000-0000-00000000000b', 'owner');
insert into public.memberships (user_id, organization_id, role) values
  ('e2333333-3333-3333-3333-333333333333', 'e1000000-0000-0000-0000-00000000000a', 'planner');

insert into public.clients (id, organization_id, name) values
  ('e3000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'Client A'),
  ('e3000000-0000-0000-0000-0000000000a2', 'e1000000-0000-0000-0000-00000000000a', 'Client A2'),
  ('e3000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000b', 'Client B');

insert into public.sites (id, client_id, is_visit_address) values
  ('e4000000-0000-0000-0000-00000000000a', 'e3000000-0000-0000-0000-00000000000a', true),
  ('e4000000-0000-0000-0000-00000000000b', 'e3000000-0000-0000-0000-00000000000b', true);

insert into public.contacts (id, client_id, name, email) values
  ('e5000000-0000-0000-0000-0000000000a1', 'e3000000-0000-0000-0000-00000000000a', 'Contact A1', 'a1@test.local'),
  ('e5000000-0000-0000-0000-0000000000a2', 'e3000000-0000-0000-0000-00000000000a', 'Contact A2 (no email)', null),
  ('e5000000-0000-0000-0000-0000000000a3', 'e3000000-0000-0000-0000-0000000000a2', 'Contact of other client', 'x@test.local'),
  ('e5000000-0000-0000-0000-0000000000b1', 'e3000000-0000-0000-0000-00000000000b', 'Contact B1', 'b1@test.local');

-- Pre-existing row for RLS isolation checks (inserted as owner).
insert into public.site_contact_roles (site_id, contact_id, role) values
  ('e4000000-0000-0000-0000-00000000000b', 'e5000000-0000-0000-0000-0000000000b1', 'visit');

select ok(
  not exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sites'
      and column_name in ('visit_contact_id', 'delivery_contact_id', 'invoice_contact_id')),
  'the three single-contact columns are gone from sites'
); -- 1

select ok(
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'validate_site_contact_persons'),
  'validate_site_contact_persons is gone'
); -- 2

select is(
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'work_receipt_email_settings'
      and column_name = 'auto_send_on_completed'),
  'false',
  'auto_send_on_completed exists and defaults to false'
); -- 3

select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'site_contact_roles'
      and column_name in ('id', 'organization_id', 'site_id', 'contact_id', 'role', 'created_by', 'created_at')),
  7,
  'site_contact_roles has the expected columns (backfill shape: site_id, contact_id, role)'
); -- 4

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.site_contact_roles (site_id, contact_id, role)
     values ('e4000000-0000-0000-0000-00000000000a', 'e5000000-0000-0000-0000-0000000000a1', 'invoice') $$,
  'owner can add an invoice role for a same-client contact with e-mail'
); -- 5

select is(
  (select organization_id from public.site_contact_roles
    where site_id = 'e4000000-0000-0000-0000-00000000000a' and role = 'invoice'),
  'e1000000-0000-0000-0000-00000000000a'::uuid,
  'organization_id is derived from the site'
); -- 6

select lives_ok(
  $$ insert into public.site_contact_roles (site_id, contact_id, role)
     values ('e4000000-0000-0000-0000-00000000000a', 'e5000000-0000-0000-0000-0000000000a2', 'visit'),
            ('e4000000-0000-0000-0000-00000000000a', 'e5000000-0000-0000-0000-0000000000a2', 'delivery') $$,
  'visit and delivery roles do not require an e-mail'
); -- 7

select throws_ok(
  $$ insert into public.site_contact_roles (site_id, contact_id, role)
     values ('e4000000-0000-0000-0000-00000000000a', 'e5000000-0000-0000-0000-0000000000a2', 'invoice') $$,
  '23514', null,
  'invoice role for a contact without e-mail is rejected'
); -- 8

select throws_ok(
  $$ insert into public.site_contact_roles (site_id, contact_id, role)
     values ('e4000000-0000-0000-0000-00000000000a', 'e5000000-0000-0000-0000-0000000000a2', 'work_receipt') $$,
  '23514', null,
  'work_receipt role for a contact without e-mail is rejected'
); -- 9

select throws_ok(
  $$ insert into public.site_contact_roles (site_id, contact_id, role)
     values ('e4000000-0000-0000-0000-00000000000a', 'e5000000-0000-0000-0000-0000000000a3', 'visit') $$,
  '23514', null,
  'a contact of another client (same organization) is rejected'
); -- 10

select throws_ok(
  $$ insert into public.site_contact_roles (site_id, contact_id, role)
     values ('e4000000-0000-0000-0000-00000000000a', 'e5000000-0000-0000-0000-0000000000b1', 'visit') $$,
  '23514', null,
  'a contact of another organization is rejected'
); -- 11

select throws_ok(
  $$ insert into public.site_contact_roles (site_id, contact_id, role)
     values ('e4000000-0000-0000-0000-00000000000a', 'e5000000-0000-0000-0000-0000000000a1', 'bogus') $$,
  '23514', null,
  'an unknown role is rejected by the check constraint'
); -- 12

select throws_ok(
  $$ insert into public.site_contact_roles (site_id, contact_id, role)
     values ('e4000000-0000-0000-0000-00000000000a', 'e5000000-0000-0000-0000-0000000000a1', 'invoice') $$,
  '23505', null,
  'the same (site, contact, role) cannot be added twice'
); -- 13

select is(
  (select count(*)::int from public.site_contact_roles),
  3,
  'owner A sees only organization A rows (Org B row invisible)'
); -- 14

select throws_ok(
  $$ insert into public.site_contact_roles (site_id, contact_id, role)
     values ('e4000000-0000-0000-0000-00000000000b', 'e5000000-0000-0000-0000-0000000000b1', 'delivery') $$,
  '42501', null,
  'owner A cannot write a role on an Org B site'
); -- 15

select pg_temp.act_as('e2333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.site_contact_roles),
  3,
  'a planner of org A can read the matrix'
); -- 16

select throws_ok(
  $$ insert into public.site_contact_roles (site_id, contact_id, role)
     values ('e4000000-0000-0000-0000-00000000000a', 'e5000000-0000-0000-0000-0000000000a1', 'visit') $$,
  '42501', null,
  'a planner cannot write the matrix (owner only, like sites)'
); -- 17

reset role;
delete from public.contacts where id = 'e5000000-0000-0000-0000-0000000000a1';

select is(
  (select count(*)::int from public.site_contact_roles where contact_id = 'e5000000-0000-0000-0000-0000000000a1'),
  0,
  'deleting a contact cascades its matrix rows'
); -- 18

select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');

update public.sites set notes = 'touched' where id = 'e4000000-0000-0000-0000-00000000000a';

select is(
  (select count(*)::int from public.site_contact_roles where site_id = 'e4000000-0000-0000-0000-00000000000a'),
  2,
  'updating other site columns keeps the matrix rows'
); -- 19

update public.sites set client_id = 'e3000000-0000-0000-0000-0000000000a2' where id = 'e4000000-0000-0000-0000-00000000000a';

select is(
  (select count(*)::int from public.site_contact_roles where site_id = 'e4000000-0000-0000-0000-00000000000a'),
  0,
  're-parenting a site clears its matrix rows'
); -- 20

select * from finish();
rollback;
