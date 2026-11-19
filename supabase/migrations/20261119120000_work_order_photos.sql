-- Work order photos (issue #224): photos an engineer takes in the PWA are
-- uploaded to a PRIVATE storage bucket and listed on the work order in the web
-- app. Mirrors the private `invoices` bucket conventions
-- (20260903100000_invoices_core.sql) and the work-order sub-resource pattern
-- of time_entries (organization_id derived from the work order).
--
-- Object path convention: {organization_id}/{work_order_id}/{photo_id}.{ext}
--
-- Access matrix (table AND storage):
--   SELECT: owner/planner/finance/administratie -> every photo in their org;
--           engineer -> only photos of work orders assigned to them
--           (same shape as work_orders_select_scoped).
--   INSERT: owner/planner -> any work order of their org; engineer -> only
--           work orders assigned to them; finance/administratie -> never.
--   DELETE: owner/planner only. No UPDATE at all (photos are immutable).
--
-- One security-definer helper (work_order_photo_access) backs all policies so
-- table and storage rules cannot drift apart and no policy recursion occurs.
-- Idempotency: unique (work_order_id, client_photo_key) lets a retried PWA
-- upload `insert ... on conflict do nothing` instead of duplicating; storage
-- uploads should use upsert=false and treat a 409 (already exists) as success,
-- since the bucket has no UPDATE policy.

-- ===========================================================================
-- A. Access helper
-- ===========================================================================
create or replace function public.work_order_photo_access(
  p_organization_id uuid,
  p_work_order_id uuid,
  p_write boolean
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    join public.work_orders wo
      on wo.organization_id = m.organization_id
    where m.user_id = auth.uid()
      and m.organization_id = p_organization_id
      and wo.id = p_work_order_id
      and (
        m.role in ('owner', 'planner')
        or (m.role = 'engineer' and wo.assigned_to = auth.uid())
        or (not p_write and m.role in ('finance', 'administratie'))
      )
  );
$$;

comment on function public.work_order_photo_access(uuid, uuid, boolean) is
  'True when the caller may read (p_write = false) or add (p_write = true) photos on the given work order of the given organization. owner/planner: any work order in their org; engineer: only work orders assigned to them; finance/administratie: read only. SECURITY DEFINER so it can read memberships/work_orders regardless of the caller''s own RLS (avoids policy recursion); used by work_order_photos and storage.objects policies.';

revoke all on function public.work_order_photo_access(uuid, uuid, boolean) from public;
grant execute on function public.work_order_photo_access(uuid, uuid, boolean) to authenticated;

-- Same check keyed on a storage object name ({org}/{work_order}/{file}).
-- Malformed names (wrong segment count / non-uuid segments) are denied.
create or replace function public.work_order_photo_object_access(p_name text, p_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_org uuid;
  v_wo uuid;
begin
  if array_length(v_parts, 1) is distinct from 3 then
    return false;
  end if;
  begin
    v_org := v_parts[1]::uuid;
    v_wo := v_parts[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  return public.work_order_photo_access(v_org, v_wo, p_write);
end;
$$;

comment on function public.work_order_photo_object_access(text, boolean) is
  'Storage-object variant of work_order_photo_access: parses "{organization_id}/{work_order_id}/{file}" and applies the same rules. Returns false for malformed paths.';

revoke all on function public.work_order_photo_object_access(text, boolean) from public;
grant execute on function public.work_order_photo_object_access(text, boolean) to authenticated;

-- ===========================================================================
-- B. work_order_photos
-- ===========================================================================
create table public.work_order_photos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  storage_path text not null unique,
  content_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  taken_at timestamptz not null,
  uploaded_by uuid references public.users (id) on delete set null,
  client_photo_key uuid,
  created_at timestamptz not null default now(),
  constraint work_order_photos_client_key_unique unique (work_order_id, client_photo_key)
);

comment on table public.work_order_photos is
  'Photos taken by engineers (PWA) on a work order. File lives in the private "work-order-photos" bucket at storage_path ({organization_id}/{work_order_id}/{photo_id}.{ext}). organization_id is derived from the work order, uploaded_by is stamped from auth.uid(); neither is client-writable. Immutable: no UPDATE.';
comment on column public.work_order_photos.organization_id is
  'Derived from work_orders.organization_id by derive_work_order_photo_organization_id. Never client-writable.';
comment on column public.work_order_photos.storage_path is
  'Object path in the work-order-photos bucket. Must start with "{organization_id}/{work_order_id}/" (enforced by trigger).';
comment on column public.work_order_photos.client_photo_key is
  'Idempotency key generated on the device (PWA). Unique per work order so a retried upload does not duplicate.';
comment on column public.work_order_photos.uploaded_by is
  'Stamped from auth.uid() by trigger; not client-writable.';

create index work_order_photos_organization_id_idx on public.work_order_photos (organization_id);
create index work_order_photos_work_order_id_idx on public.work_order_photos (work_order_id);
create index work_order_photos_uploaded_by_idx on public.work_order_photos (uploaded_by);

alter table public.work_order_photos enable row level security;
alter table public.work_order_photos force row level security;

create or replace function public.derive_work_order_photo_organization_id()
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
    raise exception 'work_order_photos.work_order_id % does not reference an existing work order', new.work_order_id
      using errcode = '23503';
  end if;

  new.organization_id := v_org_id;

  if new.storage_path not like v_org_id::text || '/' || new.work_order_id::text || '/%' then
    raise exception 'work_order_photos.storage_path must start with {organization_id}/{work_order_id}/'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.derive_work_order_photo_organization_id() is
  'BEFORE INSERT trigger on work_order_photos: sets organization_id from the work order and validates the storage_path prefix.';

create trigger work_order_photos_derive_organization_id
  before insert on public.work_order_photos
  for each row execute function public.derive_work_order_photo_organization_id();

create or replace function public.set_work_order_photo_uploaded_by()
returns trigger
language plpgsql
as $$
begin
  new.uploaded_by := auth.uid();
  return new;
end;
$$;

comment on function public.set_work_order_photo_uploaded_by() is
  'BEFORE INSERT trigger on work_order_photos: stamps uploaded_by = auth.uid().';

create trigger work_order_photos_set_uploaded_by
  before insert on public.work_order_photos
  for each row execute function public.set_work_order_photo_uploaded_by();

-- RLS policies
create policy "work_order_photos_select_scoped"
on public.work_order_photos
for select
to authenticated
using (public.work_order_photo_access(organization_id, work_order_id, false));

-- organization_id is only final after the derive trigger (which runs before
-- RLS WITH CHECK evaluation), so it can be used here.
create policy "work_order_photos_insert_scoped"
on public.work_order_photos
for insert
to authenticated
with check (
  public.work_order_photo_access(organization_id, work_order_id, true)
  and uploaded_by = auth.uid()
);

create policy "work_order_photos_delete_owner_or_planner"
on public.work_order_photos
for delete
to authenticated
using (public.current_member_role(organization_id) in ('owner', 'planner'));

-- New table: default grants give authenticated ALL; lock down first.
revoke all on public.work_order_photos from authenticated;
revoke all on public.work_order_photos from anon;

grant select, delete on public.work_order_photos to authenticated;
-- organization_id (derived) and uploaded_by (stamped) are excluded.
grant insert (
  id, work_order_id, storage_path, content_type, size_bytes, width, height, taken_at, client_photo_key
) on public.work_order_photos to authenticated;

-- ===========================================================================
-- C. Storage: private "work-order-photos" bucket
-- ===========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'work-order-photos', 'work-order-photos', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;

create policy "work_order_photos_bucket_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'work-order-photos'
  and public.work_order_photo_object_access(name, false)
);

create policy "work_order_photos_bucket_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'work-order-photos'
  and public.work_order_photo_object_access(name, true)
);

create policy "work_order_photos_bucket_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'work-order-photos'
  and public.current_member_role(
    case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         then (storage.foldername(name))[1]::uuid end
  ) in ('owner', 'planner')
);
