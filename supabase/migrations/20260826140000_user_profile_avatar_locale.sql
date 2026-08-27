-- Personal profile management (issue #49): name edit, password change (handled
-- entirely by Supabase Auth, no schema change needed), stored language
-- preference, and a profile photo.
--
-- Scope check: `public.users` already has RLS enabled+forced and an existing
-- `users_update_self` row-level policy (`id = auth.uid()` on USING and WITH
-- CHECK) from 20260822150910_organizations_memberships_baseline_rls.sql — no
-- new row-level policy is needed for the column additions below. Column-level
-- lockdown (that migration's `revoke all on public.users from authenticated;`
-- followed by `grant update (full_name) ...`) already structurally prevents
-- `is_platform_admin`/`email`/`id` from ever appearing in a client-facing
-- UPDATE, regardless of what the row-level policy allows — the new columns
-- below are added to that same additive column grant, not layered with a
-- redundant WITH CHECK old-value-equality trick (this repo's established
-- convention for "self-service but not fully open" updates is column-level
-- GRANTs, not CHECK-based field pinning; see that migration's design note 3
-- and docs/ARCHITECTURE.md's `users` bullet under "Core schema (v1)").
--
-- This migration only adds columns to an already-RLS'd, identity-scoped
-- table (not organization-scoped — a user's own profile isn't a tenant
-- resource) plus a new Storage bucket/policies. No new table, no change to
-- any existing tenant-isolation boundary.

-- ---------------------------------------------------------------------------
-- 1. New columns on public.users
-- ---------------------------------------------------------------------------
alter table public.users
  add column avatar_path text null,
  add column avatar_updated_at timestamptz null,
  add column locale text not null default 'nl' check (locale in ('nl', 'en'));

comment on column public.users.avatar_path is
  'Supabase Storage OBJECT PATH (not a full URL) in the public "avatars" bucket, e.g. "{user_id}/avatar.webp". Null means no photo uploaded — UI shows an initials fallback, never an ambiguous blank string.';
comment on column public.users.avatar_updated_at is
  'Stamped to now() only when avatar_path actually changes (see set_avatar_updated_at trigger below) — deliberately separate from the general updated_at column so the app can cache-bust the public avatar URL (?v=<epoch of this column>) precisely on photo changes, not on unrelated profile edits like a name change. Not client-writable; the trigger is the only writer.';
comment on column public.users.locale is
  'Stored UI-language preference. Fixed 2-value system constant (not tenant-configurable business data), hence a plain CHECK constraint rather than a reference_lists entry — see docs/ARCHITECTURE.md''s "Domain completeness" section for that distinction. No i18n/translation system exists yet in the app; this column only stores the preference for future wiring.';

-- ---------------------------------------------------------------------------
-- 2. Trigger-stamp avatar_updated_at whenever avatar_path changes (including
--    to/from null), mirroring this repo's established "server/trigger-only
--    field" pattern (created_by via set_created_by, checked_by/checked_at
--    via set_checklist_item_checked_fields) rather than trusting a
--    client-supplied timestamp. avatar_updated_at is therefore excluded from
--    the client-facing UPDATE column grant below.
-- ---------------------------------------------------------------------------
create or replace function public.set_avatar_updated_at()
returns trigger
language plpgsql
as $$
begin
  if new.avatar_path is distinct from old.avatar_path then
    new.avatar_updated_at = now();
  end if;
  return new;
end;
$$;

comment on function public.set_avatar_updated_at() is
  'BEFORE UPDATE trigger on public.users: stamps avatar_updated_at = now() only when avatar_path itself changes (upload, re-upload, or removal), never on unrelated profile edits.';

create trigger users_set_avatar_updated_at
  before update on public.users
  for each row execute function public.set_avatar_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Extend the client-facing UPDATE column grant. Additive to the existing
--    `grant update (full_name) on public.users to authenticated;` — Postgres
--    column-level grants accumulate, so this does not need a `revoke all`
--    first (that correction was already needed/done once, in the baseline
--    migration, for the original over-broad default grant). avatar_path and
--    locale are client-settable directly; avatar_updated_at is NOT (trigger
--    only, see above); is_platform_admin/email/id remain untouched/excluded.
-- ---------------------------------------------------------------------------
grant update (avatar_path, locale) on public.users to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Storage: "avatars" bucket. PUBLIC (readable without auth) — these are
--    headshot photos, not sensitive tenant business data; the app renders
--    them via a plain <img src> with no auth header, same as a typical SaaS
--    avatar CDN URL. Setting the convention for this repo's first Storage
--    migration (grepped supabase/migrations/ for "storage.objects" — none
--    exist yet):
--
--    Ownership is enforced by path-prefix, not a DB-level owner column:
--    an object's name must be "{auth.uid()}/..." (e.g.
--    "{user_id}/avatar.webp") for that user to INSERT/UPDATE/DELETE it.
--    storage.foldername(name) splits the object path on "/" and returns
--    everything except the final segment (the filename) as a text[] — so
--    (storage.foldername(name))[1] is the first path segment, checked
--    against auth.uid()::text. SELECT is open to any role (public bucket
--    read), matching the bucket's own `public = true` flag.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatars_select_public"
on storage.objects
for select
to public
using (bucket_id = 'avatars');

create policy "avatars_insert_own_folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "avatars_update_own_folder"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "avatars_delete_own_folder"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);
