-- Issue #208 follow-up (product feedback): contract article coverage is
-- evaluated ONLY when a time entry or consumed article is created or changed
-- -- the existing per-row sync triggers on time_entries/work_order_articles
-- (sync_time_entry_line / sync_work_order_article_line, from
-- 20260921090000_work_order_price_respects_contract_article_coverage.sql)
-- stay exactly as they are. The price frozen on the auto-draft quote line at
-- that moment must NOT be recalculated afterwards, so the bulk resync paths
-- added by that same migration are removed:
--   - work_orders_resync_contract_coverage (contract_id changed on a work order)
--   - contract_article_rules_resync_coverage / contract_article_group_rules_resync_coverage
--     (coverage rules edited on a contract)
-- Their trigger functions go too. resync_work_order_auto_draft_lines() itself
-- is dropped as well: nothing else calls it, and keeping an unused
-- recalculate-everything function around invites exactly the behavior this
-- follow-up removes.

drop trigger if exists work_orders_resync_contract_coverage on public.work_orders;
drop trigger if exists contract_article_rules_resync_coverage on public.contract_article_rules;
drop trigger if exists contract_article_group_rules_resync_coverage on public.contract_article_group_rules;

drop function if exists public.resync_on_work_order_contract_change();
drop function if exists public.resync_on_contract_coverage_rule_change();
drop function if exists public.resync_work_order_auto_draft_lines(uuid);
