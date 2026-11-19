-- Work order signatures + work receipts (issue #226).
--
-- A. work_order_signatures: the customer signature captured in the PWA, one row
--    per work order, PNG in the private "work-order-signatures" bucket at
--    {organization_id}/{work_order_id}/signature.png. Idempotent replace =
--    upsert (INSERT ... ON CONFLICT (work_order_id) DO UPDATE storage_path,
--    signed_at) and a storage upsert (bucket has INSERT + UPDATE policies).
--    Access reuses work_order_photo_access / work_order_photo_object_access
--    (owner/planner: any WO; engineer: assigned WOs; finance/administratie:
--    read only). No DELETE policy.
-- B. work_receipts: generation log of work receipts (werkbon). One row per
--    generated version; PDF in the private "work-receipts" bucket at
--    {organization_id}/{work_order_id}/{receipt_number}.pdf. Never deleted.
-- C. work_receipt_email_settings: per-org e-mail config, same shape and roles
--    as invoice_email_settings (#211).

-- ===========================================================================
-- A. work_order_signatures
-- ===========================================================================
create table public.work_order_signatures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  storage_path text not null,
  signed_at timestamptz not null,
  uploaded_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint work_order_signatures_work_order_unique unique (work_order_id)
);

comment on table public.work_order_signatures is
  'Customer signature (PNG) for a work order, one row per work order. File in the private "work-order-signatures" bucket at {organization_id}/{work_order_id}/signature.png. organization_id derived from the work order, uploaded_by stamped from auth.uid() (also on replace). Replace via INSERT ... ON CONFLICT (work_order_id) DO UPDATE SET storage_path, signed_at. No DELETE.';

create index work_order_signatures_organization_id_idx on public.work_order_signatures (organization_id);
create index work_order_signatures_uploaded_by_idx on public.work_order_signatures (uploaded_by);

alter table public.work_order_signatures enable row level security;
alter table public.work_order_signatures force row level security;

create or replace function public.prepare_work_order_signature()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select wo.organization_id into v_org_id
  from public.work_orders wo
  where wo.id = new.work_order_id;

  if v_org_id is null then
    raise exception 'work_order_signatures.work_order_id % does not reference an existing work order', new.work_order_id
      using errcode = '23503';
  end if;

  if tg_op = 'UPDATE' and new.work_order_id is distinct from old.work_order_id then
    raise exception 'work_order_signatures.work_order_id is immutable' using errcode = '23514';
  end if;

  new.organization_id := v_org_id;
  new.uploaded_by := auth.uid();

  if new.storage_path <> v_org_id::text || '/' || new.work_order_id::text || '/signature.png' then
    raise exception 'work_order_signatures.storage_path must be {organization_id}/{work_order_id}/signature.png'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.prepare_work_order_signature() is
  'BEFORE INSERT/UPDATE trigger on work_order_signatures: derives organization_id, stamps uploaded_by, validates storage_path.';

create trigger work_order_signatures_prepare
  before insert or update on public.work_order_signatures
  for each row execute function public.prepare_work_order_signature();

create policy "work_order_signatures_select_scoped"
on public.work_order_signatures
for select to authenticated
using (public.work_order_photo_access(organization_id, work_order_id, false));

create policy "work_order_signatures_insert_scoped"
on public.work_order_signatures
for insert to authenticated
with check (public.work_order_photo_access(organization_id, work_order_id, true));

create policy "work_order_signatures_update_scoped"
on public.work_order_signatures
for update to authenticated
using (public.work_order_photo_access(organization_id, work_order_id, true))
with check (public.work_order_photo_access(organization_id, work_order_id, true));

revoke all on public.work_order_signatures from authenticated;
revoke all on public.work_order_signatures from anon;
grant select on public.work_order_signatures to authenticated;
grant insert (id, work_order_id, storage_path, signed_at) on public.work_order_signatures to authenticated;
grant update (storage_path, signed_at) on public.work_order_signatures to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('work-order-signatures', 'work-order-signatures', false, 1048576, array['image/png'])
on conflict (id) do nothing;

create policy "work_order_signatures_bucket_select"
on storage.objects for select to authenticated
using (bucket_id = 'work-order-signatures' and public.work_order_photo_object_access(name, false));

create policy "work_order_signatures_bucket_insert"
on storage.objects for insert to authenticated
with check (bucket_id = 'work-order-signatures' and public.work_order_photo_object_access(name, true));

create policy "work_order_signatures_bucket_update"
on storage.objects for update to authenticated
using (bucket_id = 'work-order-signatures' and public.work_order_photo_object_access(name, true))
with check (bucket_id = 'work-order-signatures' and public.work_order_photo_object_access(name, true));

-- ===========================================================================
-- B. work_receipts
-- ===========================================================================
create table public.work_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  version integer not null check (version >= 1),
  receipt_number text not null,
  pdf_path text,
  generated_at timestamptz not null default now(),
  generated_by uuid references public.users (id) on delete set null,
  emailed_to text,
  emailed_at timestamptz,
  email_error text,
  emailed_by uuid references public.users (id) on delete set null,
  constraint work_receipts_work_order_version_unique unique (work_order_id, version),
  constraint work_receipts_org_number_unique unique (organization_id, receipt_number)
);

comment on table public.work_receipts is
  'Work receipt (werkbon) generation log, issue #226. One row per generated version of a completed/invoiced work order. version and receipt_number (<work_order_number>-<version>) are assigned by trigger under a work order row lock; organization_id/generated_by are trigger-derived. PDF in the private "work-receipts" bucket at {organization_id}/{work_order_id}/{receipt_number}.pdf; pdf_path is set once after upload. Never deleted. UPDATE only: pdf_path (null -> value once) and the e-mail log columns.';
comment on column public.work_receipts.pdf_path is
  'Storage path in the work-receipts bucket. NULL until the PDF is uploaded; can be set once and must equal {organization_id}/{work_order_id}/{receipt_number}.pdf.';
comment on column public.work_receipts.emailed_to is 'Recipient of the last send attempt.';
comment on column public.work_receipts.emailed_at is 'When the last send succeeded (NULL if it failed / never sent).';
comment on column public.work_receipts.email_error is 'Error of the last failed send attempt (NULL on success).';
comment on column public.work_receipts.emailed_by is 'Stamped from auth.uid() by trigger whenever emailed_to/emailed_at/email_error change.';

create index work_receipts_organization_id_idx on public.work_receipts (organization_id);
create index work_receipts_work_order_id_idx on public.work_receipts (work_order_id);
create index work_receipts_generated_by_idx on public.work_receipts (generated_by);
create index work_receipts_emailed_by_idx on public.work_receipts (emailed_by);

alter table public.work_receipts enable row level security;
alter table public.work_receipts force row level security;

create or replace function public.prepare_work_receipt_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_number text;
  v_status text;
  v_version integer;
begin
  -- Lock the work order row: serializes concurrent generations per work order.
  select wo.organization_id, wo.work_order_number, rli.value
    into v_org_id, v_number, v_status
  from public.work_orders wo
  join public.reference_list_items rli on rli.id = wo.status_id
  where wo.id = new.work_order_id
  for update of wo;

  if v_org_id is null then
    raise exception 'work_receipts.work_order_id % does not reference an existing work order', new.work_order_id
      using errcode = '23503';
  end if;

  if v_status not in ('completed', 'invoiced') then
    raise exception 'A work receipt can only be generated for a completed or invoiced work order (status is %)', v_status
      using errcode = '23514';
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from public.work_receipts
  where work_order_id = new.work_order_id;

  new.organization_id := v_org_id;
  new.version := v_version;
  new.receipt_number := v_number || '-' || v_version::text;
  new.pdf_path := null;
  new.generated_at := now();
  new.generated_by := auth.uid();
  new.emailed_to := null;
  new.emailed_at := null;
  new.email_error := null;
  new.emailed_by := null;
  return new;
end;
$$;

comment on function public.prepare_work_receipt_insert() is
  'BEFORE INSERT trigger on work_receipts: locks the work order, enforces status completed/invoiced, assigns version (max+1) and receipt_number, derives organization_id, stamps generated_by.';

create trigger work_receipts_prepare_insert
  before insert on public.work_receipts
  for each row execute function public.prepare_work_receipt_insert();

create or replace function public.guard_work_receipt_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.work_order_id is distinct from old.work_order_id
     or new.version is distinct from old.version
     or new.receipt_number is distinct from old.receipt_number
     or new.generated_at is distinct from old.generated_at
     or new.generated_by is distinct from old.generated_by
     or new.emailed_by is distinct from old.emailed_by then
    raise exception 'work_receipts: only pdf_path and the e-mail log columns can be updated'
      using errcode = '23514';
  end if;

  if new.pdf_path is distinct from old.pdf_path then
    if old.pdf_path is not null then
      raise exception 'work_receipts.pdf_path is already set' using errcode = '23514';
    end if;
    if new.pdf_path is distinct from
       (new.organization_id::text || '/' || new.work_order_id::text || '/' || new.receipt_number || '.pdf') then
      raise exception 'work_receipts.pdf_path must be {organization_id}/{work_order_id}/{receipt_number}.pdf'
        using errcode = '23514';
    end if;
  end if;

  if new.emailed_to is distinct from old.emailed_to
     or new.emailed_at is distinct from old.emailed_at
     or new.email_error is distinct from old.email_error then
    new.emailed_by := auth.uid();
  end if;
  return new;
end;
$$;

comment on function public.guard_work_receipt_update() is
  'BEFORE UPDATE trigger on work_receipts: only pdf_path (null -> canonical path, once) and emailed_to/emailed_at/email_error may change; stamps emailed_by.';

create trigger work_receipts_guard_update
  before update on public.work_receipts
  for each row execute function public.guard_work_receipt_update();

create policy "work_receipts_select_office"
on public.work_receipts
for select to authenticated
using (public.current_member_role(organization_id) in ('owner', 'planner', 'finance', 'administratie'));

create policy "work_receipts_insert_office"
on public.work_receipts
for insert to authenticated
with check (public.current_member_role(organization_id) in ('owner', 'planner', 'administratie'));

create policy "work_receipts_update_office"
on public.work_receipts
for update to authenticated
using (public.current_member_role(organization_id) in ('owner', 'planner', 'administratie'))
with check (public.current_member_role(organization_id) in ('owner', 'planner', 'administratie'));

revoke all on public.work_receipts from authenticated;
revoke all on public.work_receipts from anon;
grant select on public.work_receipts to authenticated;
grant insert (id, work_order_id) on public.work_receipts to authenticated;
grant update (pdf_path, emailed_to, emailed_at, email_error) on public.work_receipts to authenticated;

-- Storage helper: {org}/{wo}/{file}; role is checked on the org folder.
create or replace function public.work_receipt_object_access(p_name text, p_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_org uuid;
  v_role public.membership_role;
begin
  if array_length(v_parts, 1) is distinct from 3 then
    return false;
  end if;
  begin
    v_org := v_parts[1]::uuid;
    perform v_parts[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  v_role := public.current_member_role(v_org);
  if p_write then
    return v_role in ('owner', 'planner', 'administratie');
  end if;
  return v_role in ('owner', 'planner', 'finance', 'administratie');
end;
$$;

comment on function public.work_receipt_object_access(text, boolean) is
  'Storage-object access for the work-receipts bucket: parses "{organization_id}/{work_order_id}/{file}". Read: owner/planner/finance/administratie; write: owner/planner/administratie. False for malformed paths.';

revoke all on function public.work_receipt_object_access(text, boolean) from public;
revoke all on function public.work_receipt_object_access(text, boolean) from anon;
grant execute on function public.work_receipt_object_access(text, boolean) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('work-receipts', 'work-receipts', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

create policy "work_receipts_bucket_select"
on storage.objects for select to authenticated
using (bucket_id = 'work-receipts' and public.work_receipt_object_access(name, false));

create policy "work_receipts_bucket_insert"
on storage.objects for insert to authenticated
with check (bucket_id = 'work-receipts' and public.work_receipt_object_access(name, true));

-- ===========================================================================
-- C. work_receipt_email_settings (mirrors invoice_email_settings)
-- ===========================================================================
create table public.work_receipt_email_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  from_email text,
  from_name text,
  cc_email text,
  subject_template text,
  body_template text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_receipt_email_settings_from_email_format
    check (from_email is null or from_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint work_receipt_email_settings_cc_email_format
    check (cc_email is null or cc_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

comment on table public.work_receipt_email_settings is
  'Per-organization work receipt e-mail configuration (issue #226): sender, CC and subject/body templates. One row per organization; owner/administratie only (same as invoice_email_settings).';

create index work_receipt_email_settings_created_by_idx on public.work_receipt_email_settings (created_by);

alter table public.work_receipt_email_settings enable row level security;
alter table public.work_receipt_email_settings force row level security;

create trigger work_receipt_email_settings_set_created_by
  before insert on public.work_receipt_email_settings
  for each row execute function public.set_created_by();

create trigger work_receipt_email_settings_set_updated_at
  before update on public.work_receipt_email_settings
  for each row execute function public.set_updated_at();

create policy "work_receipt_email_settings_select_owner_or_administratie"
on public.work_receipt_email_settings
for select to authenticated
using (public.current_member_role(organization_id) in ('owner', 'administratie'));

create policy "work_receipt_email_settings_insert_owner_or_administratie"
on public.work_receipt_email_settings
for insert to authenticated
with check (public.current_member_role(organization_id) in ('owner', 'administratie'));

create policy "work_receipt_email_settings_update_owner_or_administratie"
on public.work_receipt_email_settings
for update to authenticated
using (public.current_member_role(organization_id) in ('owner', 'administratie'))
with check (public.current_member_role(organization_id) in ('owner', 'administratie'));

revoke all on public.work_receipt_email_settings from authenticated;
revoke all on public.work_receipt_email_settings from anon;
grant select on public.work_receipt_email_settings to authenticated;
grant insert (organization_id, from_email, from_name, cc_email, subject_template, body_template)
  on public.work_receipt_email_settings to authenticated;
grant update (from_email, from_name, cc_email, subject_template, body_template)
  on public.work_receipt_email_settings to authenticated;

-- The project default privileges grant EXECUTE to anon explicitly: revoke on
-- the trigger functions too.
revoke all on function public.prepare_work_order_signature() from public, anon, authenticated;
revoke all on function public.prepare_work_receipt_insert() from public, anon, authenticated;
revoke all on function public.guard_work_receipt_update() from public, anon, authenticated;
