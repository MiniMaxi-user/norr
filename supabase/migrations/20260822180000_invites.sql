-- Invite-by-existing-owner mechanism (issue #3/#4). See
-- docs/ARCHITECTURE.md ("Multi-tenancy & data isolation") and CLAUDE.md
-- rule 2 — this is an auth/tenancy primitive, not a coincidental new RLS
-- pattern, so it's added directly here rather than handed to
-- db-schema-architect.
--
-- Problem: Supabase Auth (and this schema's `memberships` table) has no way
-- to create a membership row for a `user_id` that doesn't have an
-- auth.users row yet. An owner inviting a brand-new person by email needs
-- somewhere to park "this email, this org, this role" until that person
-- actually creates an account (or logs into an existing one).
--
-- Design:
--   1. `invites` is a plain tenant-scoped table (organization_id, email,
--      role, invited_by, token, expires_at, accepted_at).
--   2. Looking up an invite by its token must work for a signed-OUT visitor
--      (they've just clicked an emailed link and haven't authenticated
--      yet) — but a blanket `anon` SELECT policy on the raw table would let
--      anyone enumerate every pending invite (email addresses, roles) via
--      PostgREST, not just the one they hold the token for. Instead,
--      `get_invite_by_token(token)` is a SECURITY DEFINER function that
--      returns invite details for an exact token match only — the token
--      (a random uuid, unguessable) is the capability, not row-level
--      visibility.
--   3. Redemption (turning an invite into an actual `memberships` row) also
--      cannot go through the normal `memberships_insert_bootstrap_or_owner`
--      RLS policy — the invited user is neither the org's creator nor
--      (yet) one of its owners. `redeem_invite(token)` is a second
--      SECURITY DEFINER function, callable only by `authenticated`, that:
--        - requires the caller to be authenticated (`auth.uid()` present),
--        - requires the invite to exist, be unexpired, and unused,
--        - requires the caller's own account email to case-insensitively
--          match the invite's email (so a forwarded invite link can't be
--          redeemed by a different account than the one it was sent to),
--        - inserts the `memberships` row itself (bypassing RLS, which is
--          safe here specifically because the function does its own
--          authorization above instead of relying on the caller's RLS
--          grants), and marks the invite `accepted_at`.
--   4. Both functions follow the same SECURITY DEFINER + `set search_path =
--      public` pattern already established by `is_member_of_org` /
--      `is_org_owner` / `org_has_members` in the baseline migration.
--   5. `invites.role` reuses the existing `membership_role` enum, which has
--      no `platform_admin` value — Platform Admin access structurally
--      cannot be granted through this (or any tenant-facing) invite flow,
--      per CLAUDE.md.

-- ---------------------------------------------------------------------------
-- invites
-- ---------------------------------------------------------------------------
create table public.invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null,
  role public.membership_role not null,
  invited_by uuid references public.users (id) on delete set null,
  token uuid not null default gen_random_uuid(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.invites is
  'Pending invitations of an email address into an organization with a given tenant role. Redeemed via public.redeem_invite(token) into a memberships row once the invitee is authenticated. Never used for Platform Admin access (membership_role has no such value).';
comment on column public.invites.token is
  'Opaque bearer capability handed out via the invite link (/invite/[token]); unguessable by design, not a row-level visibility control on its own — see public.get_invite_by_token.';
comment on column public.invites.email is
  'Case-insensitively matched against the redeeming user''s own account email inside public.redeem_invite — an invite can only be redeemed by the account it was actually sent to.';

alter table public.invites add constraint invites_token_key unique (token);

-- Only one *pending* invite per (org, email) at a time; resend by deleting
-- the old one and creating a new one (owners can delete via
-- invites_delete_owner below). Already-accepted/expired invites don't
-- count, so history isn't blocked from having multiple rows over time.
create unique index invites_pending_org_email_idx
  on public.invites (organization_id, lower(email))
  where accepted_at is null;

create index invites_organization_id_idx on public.invites (organization_id);
create index invites_token_idx on public.invites (token);

alter table public.invites enable row level security;
alter table public.invites force row level security;

-- ---------------------------------------------------------------------------
-- RLS policies: invites
-- ---------------------------------------------------------------------------

-- Owners can see the pending/past invites for their own org (a team-mgmt UI
-- can list these). No visibility for non-owner members or other tenants.
create policy "invites_select_owner"
on public.invites
for select
to authenticated
using (public.is_org_owner(organization_id));

-- Only an owner of the target org may create an invite, and only naming
-- themselves as the inviter.
create policy "invites_insert_owner"
on public.invites
for insert
to authenticated
with check (
  public.is_org_owner(organization_id)
  and invited_by = auth.uid()
);

-- Owners can revoke a pending invite (e.g. to resend with a fresh token).
create policy "invites_delete_owner"
on public.invites
for delete
to authenticated
using (public.is_org_owner(organization_id));

-- No client-facing UPDATE policy: `accepted_at` is only ever set by
-- `redeem_invite` (SECURITY DEFINER, bypasses RLS deliberately).

-- Column-level lockdown on INSERT, mirroring the pattern used for
-- `users.is_platform_admin` in the baseline migration: even though the
-- row-level policy above would otherwise permit it, an owner cannot supply
-- `token` or `accepted_at` explicitly — both must come from the column
-- defaults (a fresh, unused invite).
grant select, delete on public.invites to authenticated;
grant insert (organization_id, email, role, invited_by) on public.invites to authenticated;

-- ---------------------------------------------------------------------------
-- get_invite_by_token: safe to call while signed out (anon) or signed in.
-- Returns nothing (zero rows) if the token doesn't match any invite —
-- callers must not distinguish "wrong token" from "expired"/"used" beyond
-- what the returned row itself says, to avoid leaking which case applies to
-- a guessed token (not that a random uuid is guessable in practice).
-- ---------------------------------------------------------------------------
create or replace function public.get_invite_by_token(p_token uuid)
returns table (
  organization_id uuid,
  organization_name text,
  email text,
  role public.membership_role,
  expires_at timestamptz,
  accepted_at timestamptz,
  is_expired boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    i.organization_id,
    o.name as organization_name,
    i.email,
    i.role,
    i.expires_at,
    i.accepted_at,
    (i.expires_at < now()) as is_expired
  from public.invites i
  join public.organizations o on o.id = i.organization_id
  where i.token = p_token;
$$;

comment on function public.get_invite_by_token(uuid) is
  'Public, token-gated lookup for the /invite/[token] page — safe for signed-out (anon) callers because the token itself (a random uuid) is the capability, not row-level grants on invites.';

revoke all on function public.get_invite_by_token(uuid) from public;
grant execute on function public.get_invite_by_token(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- redeem_invite: turns a valid, unexpired, unused invite into a membership
-- row for the CALLING (authenticated) user. Bypasses RLS on both `invites`
-- and `memberships` (SECURITY DEFINER) but performs its own authorization
-- checks first, which is what makes that safe.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_invite(p_token uuid)
returns public.memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.invites;
  v_caller_email text;
  v_membership public.memberships;
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated to redeem an invite' using errcode = '28000';
  end if;

  select * into v_invite
  from public.invites
  where token = p_token
  for update;

  if not found then
    raise exception 'Invite not found' using errcode = 'P0002';
  end if;

  if v_invite.accepted_at is not null then
    raise exception 'Invite has already been used' using errcode = '22023';
  end if;

  if v_invite.expires_at < now() then
    raise exception 'Invite has expired' using errcode = '22023';
  end if;

  select email into v_caller_email from public.users where id = auth.uid();

  if v_caller_email is null or lower(v_caller_email) <> lower(v_invite.email) then
    raise exception 'This invite was sent to a different email address than the signed-in account' using errcode = '28000';
  end if;

  insert into public.memberships (user_id, organization_id, role)
  values (auth.uid(), v_invite.organization_id, v_invite.role)
  on conflict (user_id, organization_id)
  do update set role = excluded.role
  returning * into v_membership;

  update public.invites set accepted_at = now() where id = v_invite.id;

  return v_membership;
end;
$$;

comment on function public.redeem_invite(uuid) is
  'Redeems a pending invite into a memberships row for the calling authenticated user. Enforces its own authorization (auth.uid() present, invite unexpired/unused, caller email matches invite email) since it necessarily bypasses RLS via SECURITY DEFINER to write memberships for a user who is not yet an owner of the target org.';

revoke all on function public.redeem_invite(uuid) from public;
grant execute on function public.redeem_invite(uuid) to authenticated;
