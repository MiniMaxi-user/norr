-- pgTAP: contract coverage (price 0 on auto-draft quote lines) is gated on the
-- `contracts` module (issue #247, 20261126120000_contracts_feature_gates_coverage.sql).
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

insert into auth.users (id, email) values
  ('e2111111-1111-1111-1111-111111111111', 'owner-e@test.local');

insert into public.organizations (id, name, created_by)
values ('e1000000-0000-0000-0000-00000000000a', 'Org E', 'e2111111-1111-1111-1111-111111111111');

insert into public.memberships (user_id, organization_id, role)
values ('e2111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a', 'owner');

insert into public.clients (id, organization_id, name)
values ('e3000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'Client E');

insert into public.articles (id, organization_id, article_number, description)
values ('e8000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'ART-E', 'Article E');

insert into public.contracts (id, client_id, external_reference, start_date, status)
values ('e6000000-0000-0000-0000-00000000000a', 'e3000000-0000-0000-0000-00000000000a', 'Contract E', '2026-01-01', 'active');

insert into public.contract_article_rules (contract_id, organization_id, article_id, is_excluded)
values ('e6000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'e8000000-0000-0000-0000-00000000000a', true);

select ok(
  public.organization_has_feature('e1000000-0000-0000-0000-00000000000a', 'contracts'),
  'new org has contracts enabled by the default bundle'
);

select ok(
  public.is_article_covered_by_contract('e6000000-0000-0000-0000-00000000000a', 'e8000000-0000-0000-0000-00000000000a'),
  'contracts on: included article on an active contract is covered (price 0)'
);

update public.organization_features set enabled = false
 where organization_id = 'e1000000-0000-0000-0000-00000000000a' and feature_key = 'contracts';

select ok(
  not public.is_article_covered_by_contract('e6000000-0000-0000-0000-00000000000a', 'e8000000-0000-0000-0000-00000000000a'),
  'contracts off: the same article is not covered (standard price)'
);

select is(
  (select count(*)::int from public.contract_covered_article_ids('e6000000-0000-0000-0000-00000000000a', array['e8000000-0000-0000-0000-00000000000a']::uuid[])),
  0,
  'contracts off: batch variant returns no covered articles'
);

update public.organization_features set enabled = true
 where organization_id = 'e1000000-0000-0000-0000-00000000000a' and feature_key = 'contracts';

select is(
  (select count(*)::int from public.contract_covered_article_ids('e6000000-0000-0000-0000-00000000000a', array['e8000000-0000-0000-0000-00000000000a']::uuid[])),
  1,
  'contracts back on: batch variant covers the article again'
);

select * from finish();
rollback;
