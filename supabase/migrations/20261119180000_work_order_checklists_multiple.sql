-- Issue #231: a work order may have MORE than one checklist (e.g. two
-- templates). Drops the one-checklist-per-work-order unique constraint from
-- 20260823210000_checklists_core.sql and keeps a plain index for the
-- work_order_id lookups. RLS, grants and triggers are unaffected (none of them
-- rely on the uniqueness; nothing upserts on work_order_id).

alter table public.work_order_checklists
  drop constraint work_order_checklists_work_order_id_key;

create index if not exists work_order_checklists_work_order_id_idx
  on public.work_order_checklists (work_order_id);

comment on column public.work_order_checklists.work_order_id is
  'The work order this checklist instance belongs to. Since 20261119180000 a work order may have several checklists (no longer unique).';
