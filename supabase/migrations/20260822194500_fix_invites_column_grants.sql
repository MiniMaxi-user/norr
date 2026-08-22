-- Fix: same default-privilege gotcha as
-- 20260822193000_fix_clients_sites_assets_column_grants.sql, found on
-- `public.invites` while live-testing that fix (flagged by the
-- clients/sites/assets schema work, confirmed here independently).
--
-- `20260822180000_invites.sql` granted only
-- `insert (organization_id, email, role, invited_by)` to `authenticated`,
-- intending to keep `token` and `accepted_at` server/trigger-controlled —
-- but never revoked this project's default additive grant of unrestricted
-- INSERT to `authenticated` on new tables. Confirmed live: an owner could
-- POST /rest/v1/invites with an explicit `token` (defeating the
-- "unguessable capability" security property `get_invite_by_token`/
-- `redeem_invite` depend on) and/or an explicit `accepted_at` (creating an
-- invite that is already marked accepted). Both succeeded before this fix.
--
-- Fix: explicit `revoke all ... from authenticated` before re-granting the
-- originally-intended column-restricted INSERT. `token` and `accepted_at`
-- remain excluded from the INSERT grant (both have column defaults —
-- `gen_random_uuid()` and `null` respectively — that a real invite must
-- use). There is still no UPDATE grant on `invites` for `authenticated` at
-- all (unchanged; `accepted_at` is only ever set via `redeem_invite`,
-- SECURITY DEFINER), so this migration does not need to touch UPDATE.

revoke all on public.invites from authenticated;

grant select, delete on public.invites to authenticated;
grant insert (organization_id, email, role, invited_by) on public.invites to authenticated;
