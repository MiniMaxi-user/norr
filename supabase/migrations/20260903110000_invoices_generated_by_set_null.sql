-- QA follow-up (issue #119) to 20260903100000_invoices_core.sql: fix
-- invoices.generated_by's delete-cascade behavior.
--
-- Problem: invoices.generated_by was defined as
--   `generated_by uuid not null references public.users (id) on delete cascade`
-- Grepping every actor-stamped column in this schema (created_by/assigned_to/
-- checked_by/reported_by/action_holder_id/actor_id/invited_by/
-- engineer_user_id, 24 occurrences total) shows exactly one other required
-- (not null) user-FK precedent, activities.action_holder_id
-- (20260828090000_activities_core.sql) / activity_notes.action_holder_id
-- (20260902090000_activity_notes_and_events.sql) -- both `on delete cascade`
-- for the same documented reason: a required FK cannot use `on delete set
-- null` without violating its own not-null constraint. That reasoning does
-- NOT apply to invoices.generated_by, which has no such requirement -- an
-- invoice is meaningful with an unknown/departed generator, exactly like
-- every OTHER (nullable) actor-stamped column in this schema
-- (created_by/assigned_to/checked_by/reported_by/actor_id/invited_by), all of
-- which are nullable + `on delete set null`. invoices.generated_by being
-- both not-null AND cascade was an unjustified one-off: deleting the user who
-- generated an invoice would destroy the invoice itself -- a financial
-- record -- along with it. Fix: make the column nullable and switch the FK
-- action to `on delete set null`, matching every other actor-stamped column.
--
-- Not touched: the trigger (set_invoice_generated_by), the RLS
-- policies/grants, invoice_number_sequences, or the Storage bucket -- none of
-- that is affected by this column's cascade behavior. This is a column-level
-- fix, not a data-isolation boundary change, so no new RLS test/qa-reviewer
-- handoff is needed beyond what 20260903100000_invoices_core.sql's own RLS
-- test already covers for this column (test #5, "auto-stamped to the
-- inserting user"), which remains valid unchanged.

alter table public.invoices
  alter column generated_by drop not null;

alter table public.invoices
  drop constraint invoices_generated_by_fkey;

alter table public.invoices
  add constraint invoices_generated_by_fkey
  foreign key (generated_by) references public.users (id) on delete set null;

comment on column public.invoices.generated_by is
  'Who generated this invoice. Stamped by the set_invoice_generated_by trigger from auth.uid() -- never client-suppliable (excluded from the INSERT grant). Nullable, on delete set null: if the generating user''s account is later deleted, the invoice row (a financial record) survives with generated_by cleared -- same "who did this" semantics loss every other on delete set null actor column in this schema (created_by/assigned_to/checked_by/reported_by/actor_id/invited_by) already tolerates. (Originally not null + on delete cascade in 20260903100000_invoices_core.sql; corrected here per QA review -- see 20260903110000_invoices_generated_by_set_null.sql''s header for the full rationale.)';
