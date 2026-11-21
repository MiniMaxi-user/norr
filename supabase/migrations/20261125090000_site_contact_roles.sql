-- Issue #273: site contact matrix + automatic work receipt e-mail on Completed.
--
-- SINGLE-SOURCE RULE: the matrix table public.site_contact_roles REPLACES the
-- three single-contact columns on public.sites (visit_contact_id,
-- delivery_contact_id, invoice_contact_id). They are backfilled into the matrix
-- and then dropped, together with validate_site_contact_persons and its
-- trigger sites_validate_contact_persons. There must never be two sources of
-- truth for "who is the contact for role X at site Y".
--
-- Contents:
--   1. site_contact_roles (site x contact x role), RLS, triggers, grants.
--   2. Backfill from the three sites columns (before the e-mail trigger exists,
--      so existing invoice contacts without an e-mail are not lost).
--   3. Drop the old trigger, function, indexes (with the columns) and columns.
--   4. work_receipt_email_settings.auto_send_on_completed.
--   5. work_receipts.emailed_to: plain text without any constraint (checked in
--      20261119140000 / 20261122110000), so several addresses joined by ", "
--      already fit. Nothing to relax; documented here only.
--
-- Dependency check done: no view, other function or policy references the
-- dropped columns (20260915090000 only re-issued the sites column grants,
-- which vanish with the columns).

create table public.site_contact_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  role text not null,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint site_contact_roles_role_check
    check (role in ('visit', 'delivery', 'invoice', 'work_receipt')),
  constraint site_contact_roles_unique unique (site_id, contact_id, role)
);

comment on table public.site_contact_roles is
  'Site contact matrix (issue #273): which contact of the site''s client fulfils which role (visit, delivery, invoice, work_receipt) at the site. Replaces sites.visit_contact_id/delivery_contact_id/invoice_contact_id. organization_id is derived from the site by a trigger.';
comment on column public.site_contact_roles.organization_id is
  'Derived from sites.organization_id by validate_site_contact_role. Never client-writable.';
comment on column public.site_contact_roles.role is
  'visit | delivery | invoice | work_receipt. invoice and work_receipt require the contact to have a non-empty e-mail.';

create index site_contact_roles_organization_id_idx on public.site_contact_roles (organization_id);
create index site_contact_roles_site_id_idx on public.site_contact_roles (site_id);
create index site_contact_roles_contact_id_idx on public.site_contact_roles (contact_id);
create index site_contact_roles_created_by_idx on public.site_contact_roles (created_by);

alter table public.site_contact_roles enable row level security;
alter table public.site_contact_roles force row level security;

create trigger site_contact_roles_set_created_by
  before insert on public.site_contact_roles
  for each row execute function public.set_created_by();

-- Derives organization_id from the site and enforces that the contact belongs
-- to the same client as the site (23514), plus the e-mail requirement.
create or replace function public.validate_site_contact_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_site_client uuid;
  v_contact_client uuid;
  v_email text;
begin
  select organization_id, client_id into v_org, v_site_client
  from public.sites where id = new.site_id;
  if v_org is null then
    raise exception 'site_contact_roles.site_id % does not reference an existing site', new.site_id
      using errcode = '23503';
  end if;

  select client_id, email into v_contact_client, v_email
  from public.contacts where id = new.contact_id;
  if v_contact_client is null then
    raise exception 'site_contact_roles.contact_id % does not reference an existing contact', new.contact_id
      using errcode = '23503';
  end if;
  if v_contact_client <> v_site_client then
    raise exception 'site_contact_roles.contact_id must reference a contact belonging to the same client as the site'
      using errcode = '23514';
  end if;

  if new.role in ('invoice', 'work_receipt') and nullif(btrim(coalesce(v_email, '')), '') is null then
    raise exception 'A contact without an e-mail address cannot have the % role', new.role
      using errcode = '23514';
  end if;

  new.organization_id := v_org;
  return new;
end;
$$;

comment on function public.validate_site_contact_role() is
  'BEFORE INSERT/UPDATE trigger on public.site_contact_roles: derives organization_id from the site, rejects a contact of a different client than the site (23514), and rejects invoice/work_receipt roles for a contact without a non-empty e-mail (23514). SECURITY DEFINER so it can resolve site and contact regardless of the caller''s RLS.';

create trigger site_contact_roles_validate
  before insert or update of site_id, contact_id, role on public.site_contact_roles
  for each row execute function public.validate_site_contact_role();

-- RLS: same as sites. Read: any org member. Write (insert/delete): owner.
-- There is no UPDATE: the app replaces a site's rows (delete + insert).
create policy "site_contact_roles_select_member"
on public.site_contact_roles
for select
to authenticated
using (public.is_member_of_org(organization_id));

create policy "site_contact_roles_insert_owner"
on public.site_contact_roles
for insert
to authenticated
with check (public.is_org_owner(organization_id));

create policy "site_contact_roles_delete_owner"
on public.site_contact_roles
for delete
to authenticated
using (public.is_org_owner(organization_id));

revoke all on public.site_contact_roles from authenticated;
revoke all on public.site_contact_roles from anon;
grant select, delete on public.site_contact_roles to authenticated;
-- organization_id / created_by intentionally excluded: derived by triggers.
grant insert (site_id, contact_id, role) on public.site_contact_roles to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill (runs before the e-mail trigger would block invoice contacts
-- without an e-mail; the validate trigger is already attached, so bypass it
-- for the backfill by inserting with the trigger disabled).
-- ---------------------------------------------------------------------------
alter table public.site_contact_roles disable trigger site_contact_roles_validate;

insert into public.site_contact_roles (organization_id, site_id, contact_id, role)
select s.organization_id, s.id, s.visit_contact_id, 'visit'
from public.sites s where s.visit_contact_id is not null
union all
select s.organization_id, s.id, s.delivery_contact_id, 'delivery'
from public.sites s where s.delivery_contact_id is not null
union all
select s.organization_id, s.id, s.invoice_contact_id, 'invoice'
from public.sites s where s.invoice_contact_id is not null;

alter table public.site_contact_roles enable trigger site_contact_roles_validate;

-- ---------------------------------------------------------------------------
-- Drop the old single-contact columns and their validation.
-- ---------------------------------------------------------------------------
drop trigger sites_validate_contact_persons on public.sites;
drop function public.validate_site_contact_persons();

alter table public.sites
  drop column visit_contact_id,
  drop column delivery_contact_id,
  drop column invoice_contact_id;

-- ---------------------------------------------------------------------------
-- Automatic work receipt e-mail on Completed.
-- ---------------------------------------------------------------------------
alter table public.work_receipt_email_settings
  add column auto_send_on_completed boolean not null default false;

comment on column public.work_receipt_email_settings.auto_send_on_completed is
  'Organization switch (issue #273): when true, approving a work order review (transition to completed) e-mails the latest work receipt to the site''s work_receipt contacts. Only effective when email_work_receipts is not false.';

grant insert (auto_send_on_completed), update (auto_send_on_completed)
  on public.work_receipt_email_settings to authenticated;
