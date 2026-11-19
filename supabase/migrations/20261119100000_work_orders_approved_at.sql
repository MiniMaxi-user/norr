-- `work_orders.approved_at` — moment a planner/owner approved the work order
-- in the web app (to_review -> completed). The dashboard counts a work order
-- as "completed" on this date, NOT on `completed_at` (which the PWA stamps
-- when the engineer finishes in the field and which stays as is).
--
-- No RLS policy change: work_orders_update_scoped already scopes writes by
-- row. A column-level UPDATE grant is added for approved_at only (column-level
-- grants are additive; the current lists include external_reference, so they
-- are not re-issued) and never INSERT. Because the grant is shared by every
-- `authenticated` member (incl. engineers on their own rows), a trigger
-- restricts who may actually change the column to owner/planner.

alter table public.work_orders
  add column approved_at timestamptz;

comment on column public.work_orders.approved_at is
  'When the work order was approved (to_review -> completed) in the web app by an owner/planner. Nullable; set by the approve action only, never by the PWA/engineer (guarded by work_orders_guard_approved_at). Distinct from completed_at, which the PWA stamps when the engineer finishes in the field. Dashboard "completed" counts use this date.';

grant update (approved_at) on public.work_orders to authenticated;

-- Guard: only owner/planner may set or change approved_at. Callers without an
-- auth.uid() (service role / migrations) are not restricted.
create or replace function public.guard_work_order_approved_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.approved_at is not null and auth.uid() is not null
       and coalesce(public.current_member_role(new.organization_id)::text, '') not in ('owner', 'planner') then
      raise exception 'Only an owner or planner can set approved_at' using errcode = '42501';
    end if;
  elsif new.approved_at is distinct from old.approved_at then
    if auth.uid() is not null
       and coalesce(public.current_member_role(new.organization_id)::text, '') not in ('owner', 'planner') then
      raise exception 'Only an owner or planner can change approved_at' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.guard_work_order_approved_at() is
  'BEFORE INSERT/UPDATE trigger on public.work_orders: rejects setting/changing approved_at unless the caller is an owner or planner of the work order''s organization (engineers share the authenticated column grant, so the grant alone cannot exclude them). No restriction when auth.uid() is null (service role / migrations).';

drop trigger if exists work_orders_guard_approved_at on public.work_orders;
create trigger work_orders_guard_approved_at
  before insert or update on public.work_orders
  for each row execute function public.guard_work_order_approved_at();

-- Backfill: already completed/invoiced orders were approved on the day of
-- their last update. Keep updated_at untouched by pausing its trigger.
alter table public.work_orders disable trigger work_orders_set_updated_at;

update public.work_orders wo
set approved_at = wo.updated_at
from public.reference_list_items s
where s.id = wo.status_id
  and s.value in ('completed', 'invoiced')
  and wo.approved_at is null;

alter table public.work_orders enable trigger work_orders_set_updated_at;
