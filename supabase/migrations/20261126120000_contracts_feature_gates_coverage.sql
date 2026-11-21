-- Issue #247: contract coverage (sale price 0 on auto-draft quote lines) only
-- applies while the organization has the `contracts` module. The batch variant
-- contract_covered_article_ids() delegates to is_article_covered_by_contract(),
-- so gating the single function gates both.
--
-- Body copied verbatim from 20261123120000_contract_status_and_invoicing_timing.sql
-- (latest live version) with ONE change: the contract's organization must have
-- organization_has_feature(org, 'contracts').

create or replace function public.is_article_covered_by_contract(
  p_contract_id uuid,
  p_article_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  with recursive grp(id) as (
    select a.group_id from public.articles a
      where a.id = p_article_id and a.group_id is not null
    union
    select g.parent_group_id from public.article_groups g
      join grp on g.id = grp.id
      where g.parent_group_id is not null
  ),
  matched as (
    select r.is_excluded
      from public.contract_article_rules r
      where r.contract_id = p_contract_id and r.article_id = p_article_id
    union all
    select gr.is_excluded
      from public.contract_article_group_rules gr
      where gr.contract_id = p_contract_id
        and gr.article_group_id in (select id from grp)
  )
  select p_contract_id is not null
    and p_article_id is not null
    and exists (
      select 1 from public.contracts c
      where c.id = p_contract_id
        and c.status = 'active'
        and public.organization_has_feature(c.organization_id, 'contracts')
    )
    and exists (select 1 from matched where is_excluded)
    and not exists (select 1 from matched where not is_excluded);
$$;

comment on function public.is_article_covered_by_contract(uuid, uuid) is
  'Issue #208/#270/#247: true when the contract is ACTIVE, its organization has the contracts module, and it covers the article (sale price 0 on work order quotes). Collects the article rule + group rules on its group and all ancestor groups; any rule with is_excluded=false (UI "Excluded") overrules everything (not covered); else any is_excluded=true (UI "Included") => covered; else false. Null, draft or ended contract, or module off => false. SECURITY INVOKER, stable.';
