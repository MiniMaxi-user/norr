-- Client company-details management (issue #120, "Als client wil ik mijn
-- bedrijfsgegevens kunnen beheren"). Three schema prerequisites, all scoped
-- strictly to what the issue's acceptance criteria ask for -- no invoicing,
-- no new role/permission, no feature flag (core tenant configuration, not a
-- sellable module):
--
--   A. `clients.logo_path` / `clients.logo_updated_at` -- a per-client logo,
--      same shape as `users.avatar_path`/`avatar_updated_at`
--      (`20260826140000_user_profile_avatar_locale.sql`): nullable Storage
--      object path + a trigger-stamped-only timestamp, so the app can
--      cache-bust the public logo URL precisely on re-upload. "Gecomprimeerd
--      opgeslagen" (compressed on upload) is an application-layer concern
--      (client-side/edge compression to webp before the Storage PUT, exactly
--      like the existing avatar upload path already does) -- no DB-level
--      mechanism can compress an already-uploaded blob, so nothing schema-side
--      enforces or needs to enforce this; `api-backend-engineer`/
--      `frontend-ui-engineer` follow-up.
--
--   B. Storage bucket `client-logos` -- PUBLIC, mirroring `avatars` (a future
--      invoice PDF render needs a plain fetchable URL, no auth header). Path
--      convention `{organization_id}/{client_id}/logo.webp` (fixed filename
--      per client -- a re-upload overwrites in place, "no orphans", same
--      reasoning as the avatars bucket). Unlike `avatars` (identity-scoped,
--      path-prefix checked against `auth.uid()`), this bucket sits under a
--      TENANT-scoped resource (a `clients` row) -- INSERT/UPDATE/DELETE is
--      therefore checked with `is_org_owner((storage.foldername(name))[1]::uuid)`
--      against the path's organization_id segment, not a plain `auth.uid()`
--      string compare, matching `updateClient`'s existing owner-only RBAC gate
--      (`app/(app)/clients/actions.ts`: `can(actor, "clients", "update")` is
--      owner-only, "Only the organization owner can update clients."). This is
--      safe to call from a `storage.objects` policy for the same reason
--      `is_org_owner`/`is_member_of_org` are already safely callable from every
--      other table's RLS policy in this schema: both are declared `security
--      definer` (`20260822150910_organizations_memberships_baseline_rls.sql`),
--      so the policy evaluates them with the function OWNER's privileges to
--      read `memberships` regardless of the calling role's own row-visibility
--      into that table, and both are already `grant execute ... to
--      authenticated`, which is exactly the privilege a `storage.objects`
--      policy (evaluated as the `authenticated` role, same as any other RLS
--      policy) needs to invoke them. The bucket-level ownership check is
--      deliberately NOT scoped further to the specific `{client_id}` segment
--      of the path (no lookup against `clients.id` at the storage layer) --
--      the org-owner check alone is already the correct/only boundary this
--      table's own RLS enforces for a client write (`clients_update_owner`
--      has no per-client granularity either, any org owner may write any
--      client in their org), and a stray/mismatched `client_id` segment in an
--      org-owner-uploaded object is a harmless orphan, not a cross-tenant
--      leak, since the org segment is what's actually checked.
--
--   C. `organizations.own_client_id` -- nullable FK into `clients`, letting a
--      tenant designate which of ITS OWN `clients` rows represents itself
--      (for a future Invoicing module's "from" branding -- not built here).
--      Exact same nullable-FK-into-a-sibling-table-with-validation-trigger
--      shape as `organizations.default_travel_article_id`/
--      `default_work_article_id` (`20260901090000_work_order_auto_draft_quotes.sql`,
--      design note 1): a dedicated `security definer` `before insert or update
--      of own_client_id` trigger (`validate_organization_own_client`) checks
--      the referenced client's OWN `organization_id` against `new.id` (the
--      `organizations` row's own id IS the organization id here -- there is no
--      separate `organization_id` column on `organizations` itself to compare
--      against, same reason that migration's own trigger couldn't reuse
--      `validate_rate_override_articles`), raising `23503` for a dangling id
--      and `23514` for a cross-organization mismatch. `on delete set null`
--      (not cascade/restrict): deleting the designated "own" client should
--      just clear the org's designation, not block the delete or take the
--      organization row down with it. No new GRANT needed -- `organizations`
--      has never had column-level INSERT/UPDATE lockdown (its baseline grant
--      is table-wide, confirmed still true below), so this new column is
--      already covered; actual write access stays gated purely by the
--      existing `organizations_update_owner` RLS policy (`is_org_owner`).
--
--      NOT to be confused with `clients.represents_organization_id`
--      (`20260825160000_clients_represents_organization.sql`) -- that is an
--      unrelated, Platform-Admin-only concept (a Client row inside the
--      Platform org that itself IS a managed tenant). `own_client_id` is the
--      reverse direction and a completely different concept (an ordinary
--      tenant picking which of ITS OWN client rows represents itself) --
--      no relation to that column/trigger, neither reused nor touched here.
--
-- ---------------------------------------------------------------------------
-- Due diligence performed before writing this migration:
--   - Grepped supabase/migrations/ and supabase/tests/ for `logo_path`,
--     `own_client_id`, and `client-logos` -- zero hits. All three are wholly
--     new.
--   - Confirmed `organizations`' baseline grant is still table-wide and
--     unmodified since `20260822150910_organizations_memberships_baseline_rls.sql`
--     (`grant select, insert, update on public.organizations to
--     authenticated;`) -- no later migration narrowed it to column-level
--     (`20260826120000_organizations_is_active.sql`,
--     `20260901090000_work_order_auto_draft_quotes.sql` both rely on this same
--     table-wide grant for their own new `organizations` columns, per their
--     own header comments) -- so `own_client_id` needs no new GRANT statement,
--     same conclusion as `default_travel_article_id`/`default_work_article_id`.
--   - Confirmed `is_org_owner(uuid)` is `security definer` + already
--     `grant execute ... to authenticated`
--     (`20260822150910_organizations_memberships_baseline_rls.sql`) -- safe
--     and correctly privileged to call from the new `storage.objects`
--     policies below, exactly as it's already called from every tenant table's
--     own RLS policies.
--   - Grepped `supabase/migrations/` for `clients` UPDATE column grants across
--     every migration that has ever touched them (`20260822190000`,
--     `20260822193000`, `20260825150000`, `20260825160000`, `20260826130000`,
--     `20260827100000`, `20260830090000`) to assemble `clients`' true current
--     accumulated grant list before re-issuing it below (column-level grants
--     are additive in Postgres, so several of those migrations only granted
--     their OWN new columns rather than re-stating the full list -- the
--     re-issue below is the first full accounting since
--     `20260826130000_sites_phone.sql`).
--   - `supabase/tests/database/clients_sites_assets_rls.test.sql`'s `clients`
--     insert fixtures all use explicit, narrower column lists (none rely on
--     column order / `select *`) -- these two new nullable columns
--     (`clients.logo_path`, `organizations.own_client_id`) are a no-op for
--     every existing fixture there. New coverage lives in this migration's own
--     dedicated test file instead (see below), following the same
--     one-test-file-per-migration precedent as
--     `work_order_auto_draft_quotes_rls.test.sql` for
--     `20260901090000_work_order_auto_draft_quotes.sql`.
--
-- Out of scope here (api-backend-engineer / frontend-ui-engineer follow-ups):
--   - The actual logo upload UI/action (client-side webp compression + Storage
--     PUT to `client-logos/{organization_id}/{client_id}/logo.webp`,
--     mirroring the existing avatar upload flow).
--   - The Settings > Tenant "own Client" picker UI/action writing
--     `organizations.own_client_id`.
--   - Any future Invoicing module actually reading either of these.

-- ===========================================================================
-- A. clients.logo_path / clients.logo_updated_at
-- ===========================================================================
alter table public.clients
  add column logo_path text null,
  add column logo_updated_at timestamptz null;

comment on column public.clients.logo_path is
  'Supabase Storage OBJECT PATH (not a full URL) in the public "client-logos" bucket, e.g. "{organization_id}/{client_id}/logo.webp" -- fixed filename per client so a re-upload overwrites in place. Null means no logo uploaded. Compression (issue #120: "Logo wordt gecomprimeerd opgeslagen") happens client-side/at the upload edge before the PUT, same as users.avatar_path -- nothing DB-level enforces or needs to enforce that.';
comment on column public.clients.logo_updated_at is
  'Stamped to now() only when logo_path actually changes (see set_client_logo_updated_at trigger below) -- same cache-busting purpose as users.avatar_updated_at. Not client-writable; the trigger is the only writer.';

create or replace function public.set_client_logo_updated_at()
returns trigger
language plpgsql
as $$
begin
  if new.logo_path is distinct from old.logo_path then
    new.logo_updated_at = now();
  end if;
  return new;
end;
$$;

comment on function public.set_client_logo_updated_at() is
  'BEFORE UPDATE trigger on public.clients: stamps logo_updated_at = now() only when logo_path itself changes (upload, re-upload, or removal), never on unrelated client edits. Mirrors set_avatar_updated_at (20260826140000_user_profile_avatar_locale.sql) for clients.logo_path.';

create trigger clients_set_logo_updated_at
  before update on public.clients
  for each row execute function public.set_client_logo_updated_at();

-- Re-issue the clients UPDATE column grant reflecting clients' true current
-- accumulated column set (see this migration's header due-diligence note),
-- adding logo_path. UPDATE-only, same as represents_organization_id -- a
-- brand-new client is never created with a logo already attached (there's
-- nothing to upload a logo TO until the client row exists), so logo_path is
-- deliberately absent from the INSERT grant (left untouched below).
-- logo_updated_at is NOT granted at all -- trigger-only, same lockdown as
-- avatar_updated_at/won_at.
grant update (
  name, kvk_number, vat_number, iban, notes,
  represents_organization_id,
  status, account_manager_id, potential_value, client_since,
  has_custom_rate, travel_article_id, work_article_id, travel_sale_price, work_sale_price,
  logo_path
) on public.clients to authenticated;

-- ===========================================================================
-- B. Storage: "client-logos" bucket. PUBLIC, path convention
--    "{organization_id}/{client_id}/logo.webp". See migration header point B
--    for the full ownership-check reasoning (is_org_owner on the path's
--    organization_id segment, not a plain auth.uid() compare -- this is a
--    tenant resource, not an identity-scoped one like avatars).
-- ===========================================================================
insert into storage.buckets (id, name, public)
values ('client-logos', 'client-logos', true)
on conflict (id) do nothing;

create policy "client_logos_select_public"
on storage.objects
for select
to public
using (bucket_id = 'client-logos');

create policy "client_logos_insert_org_owner"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'client-logos'
  and public.is_org_owner((storage.foldername(name))[1]::uuid)
);

create policy "client_logos_update_org_owner"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'client-logos'
  and public.is_org_owner((storage.foldername(name))[1]::uuid)
)
with check (
  bucket_id = 'client-logos'
  and public.is_org_owner((storage.foldername(name))[1]::uuid)
);

create policy "client_logos_delete_org_owner"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'client-logos'
  and public.is_org_owner((storage.foldername(name))[1]::uuid)
);

-- ===========================================================================
-- C. organizations.own_client_id
-- ===========================================================================
alter table public.organizations
  add column own_client_id uuid references public.clients (id) on delete set null;

comment on column public.organizations.own_client_id is
  'Issue #120: which of THIS organization''s own clients rows represents the organization itself, for a future Invoicing module''s "from" branding (not built here). Nullable; on delete set null (deleting the designated client just clears the designation). Validated to belong to THIS SAME organization by validate_organization_own_client. NOT related to clients.represents_organization_id (20260825160000_clients_represents_organization.sql) -- that is the reverse direction, a Platform-Admin-only concept (a client row that IS a managed tenant).';

create index organizations_own_client_id_idx on public.organizations (own_client_id);

create or replace function public.validate_organization_own_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_org uuid;
begin
  if new.own_client_id is not null then
    select organization_id into v_client_org
    from public.clients
    where id = new.own_client_id;

    if v_client_org is null then
      raise exception 'organizations.own_client_id % does not reference an existing client', new.own_client_id
        using errcode = '23503';
    elsif v_client_org <> new.id then
      raise exception 'organizations.own_client_id must belong to this same organization'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_organization_own_client() is
  'BEFORE INSERT/UPDATE OF own_client_id trigger on public.organizations (issue #120): rejects a client that does not exist, or belongs to a DIFFERENT organization than the row itself (checked against new.id, since an organizations row IS the organization). Same structure as validate_organization_default_rate_articles (20260901090000_work_order_auto_draft_quotes.sql), one column instead of two, referencing public.clients instead of public.articles.';

create trigger organizations_validate_own_client
  before insert or update of own_client_id on public.organizations
  for each row execute function public.validate_organization_own_client();

-- No new GRANT statement needed: organizations' baseline grant is table-wide
-- (`grant select, insert, update on public.organizations to authenticated`,
-- 20260822150910_organizations_memberships_baseline_rls.sql), confirmed still
-- unmodified in this migration's header due-diligence note -- it already
-- covers own_client_id. Actual write access stays gated by the unchanged
-- `organizations_update_owner` RLS policy (is_org_owner); a brand-new
-- organizations row's own id has no clients yet, so any non-null
-- own_client_id supplied on that same INSERT is rejected as belonging to "a
-- different organization" (23514), same practical INSERT-is-self-defeating
-- note as default_travel_article_id/default_work_article_id.
