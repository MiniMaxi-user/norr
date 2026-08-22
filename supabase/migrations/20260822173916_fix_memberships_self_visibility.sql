-- Fix: bootstrap owner self-insert into `memberships` failed whenever the
-- caller requested the inserted row back (e.g. Supabase JS `.insert(...).select()`,
-- or any PostgREST call using `Prefer: return=representation`).
--
-- Root cause: Postgres evaluates a table's SELECT policy against a freshly
-- inserted row when RETURNING is requested, as part of the *same command*.
-- `memberships_select_same_org` relied solely on `is_member_of_org(organization_id)`,
-- a SECURITY DEFINER function that re-queries `memberships` itself — but a row
-- inserted by the current command is not visible to other scans within that
-- same command (standard Postgres self-visibility/MVCC rule), so the function
-- always saw zero rows and the RETURNING check failed with "new row violates
-- row-level security policy for table memberships", even though the INSERT's
-- own WITH CHECK expression was satisfied.
--
-- Confirmed via direct testing against the live project: `insert ... returning *`
-- failed, while the identical `insert ...` without RETURNING succeeded and the
-- row was immediately visible via a separate, subsequent SELECT.
--
-- Fix: a membership row is always visible to the user it belongs to via a
-- direct `user_id = auth.uid()` comparison against the row itself, which does
-- not require re-querying the table and is therefore immune to this
-- same-command visibility issue. Org-peer visibility via `is_member_of_org`
-- is kept for the rest of the org's roster.

drop policy "memberships_select_same_org" on public.memberships;

create policy "memberships_select_self_or_same_org"
on public.memberships
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_member_of_org(organization_id)
);
