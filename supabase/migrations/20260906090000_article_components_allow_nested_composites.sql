-- Articles module (issue #124, "[Story] Nested composite articles"):
-- REVERSES the "no nested composites" restriction
-- `20260829100000_articles_core.sql` (issue #92) deliberately built, per an
-- explicit product-owner ask (chat, 2026-09-06) for a real multi-level
-- bill-of-materials (a composite article assembled partly from other
-- composite articles, e.g. a "Service Van Kit" composite built from a
-- "Basic Toolset" composite plus a few loose parts).
--
-- What the original migration's design note said, and why it no longer
-- holds:
--   `20260829100000_articles_core.sql` (design note 4, and the
--   `article_components`/`validate_article_component` comments) structurally
--   forbade any BOM depth beyond one level: `validate_article_component`
--   required `parent_article_id` to be `is_composite = true` AND
--   `component_article_id` to be `is_composite = false`, and a companion
--   trigger on `articles`, `validate_article_is_composite_flip`, closed the
--   back-door route (flipping an already-in-use component article's own
--   `is_composite` to `true` after the fact). Together these meant a
--   component could never itself become a parent, which incidentally also
--   meant no cycle-detection was needed — a flat two-tier BOM cannot cycle.
--   The product owner now wants real nesting, which reopens exactly the
--   cycle risk `article_groups`' self-referential tree already has to guard
--   against (`validate_article_group_parent`) — so this migration adds the
--   equivalent guard for `article_components`' own (potentially
--   multi-branch) descendant graph instead of re-deriving flatness as a
--   substitute safety net.
--
-- Two changes:
--
-- 1. `validate_article_is_composite_flip` (trigger `articles_validate_is_
--    composite_flip` on `public.articles`, BEFORE UPDATE OF `is_composite`)
--    is DROPPED ENTIRELY, along with its function. It existed purely to
--    close the "flip an in-use component to composite" back door into a
--    nested composite — which is no longer a violation of anything. Nothing
--    else in this schema calls this function, so both the trigger and the
--    function are dropped rather than leaving a now-pointless empty body
--    around.
--
-- 2. `validate_article_component()` (trigger `article_components_validate_
--    component` on `public.article_components`, unchanged trigger
--    definition, only its function body changes):
--      - Still requires `parent_article_id` to resolve to an article with
--        `is_composite = true` (a component can only be attached under a
--        composite) and `component_article_id` to belong to the same
--        organization as the parent (both unchanged from before).
--      - NO LONGER requires `component_article_id`'s `is_composite = false`
--        — a composite article may now be used as a component of another
--        composite article.
--      - NEW: cycle detection. Adding `component_article_id = X` under
--        `parent_article_id = P` is rejected if `P` is reachable by walking
--        DOWN `X`'s own descendant tree (`P = X` itself is already caught
--        separately by the pre-existing `article_components_no_self_
--        reference` check constraint, which stays as-is per this issue's
--        scope — see the table's constraints, untouched by this migration).
--        Unlike `validate_article_group_parent`'s ancestor walk (a plain
--        `while` loop up a strictly single-parent chain — every
--        `article_groups` row has at most one `parent_group_id`), a BOM
--        node can have MULTIPLE children (several component lines under one
--        parent), so "walking down" here is a real tree/graph traversal, done
--        via a recursive CTE rather than a simple loop. Depth-capped at 1000
--        levels, the same defensive cap `validate_article_group_parent`
--        uses (an actual infinite loop is unreachable in practice — this
--        trigger is exactly what keeps the graph acyclic on every write in
--        the first place — the cap is purely a defensive bound on how deep a
--        single check will walk, same as the ancestor-chain trigger's own
--        cap). Raises with `errcode = '23514'`, message: 'article_components.
--        component_article_id would create a cycle in the bill of
--        materials' — chosen to parallel `validate_article_group_parent`'s
--        own '...would create a cycle in the group tree' message, and
--        chosen deliberately distinguishable so `mapArticleDbError`
--        (`app/(app)/articles/actions.ts`) can special-case it with a clean
--        user-facing message the same way it already special-cases `23505`.
--        FOLLOW-UP FOR api-backend-engineer (not done by this migration):
--        `mapArticleDbError` needs a new branch matching this exact message
--        text (Postgres gives every custom `raise exception` the same
--        generic-looking `23514`, so the message text — not a distinct code
--        — is the only thing to key off), and `components-actions.ts`'s own
--        header comment (`app/(app)/articles/components-actions.ts`, lines
--        ~26-27) still says "is_composite = false, no nested composites" —
--        stale after this migration and worth a fix in the same pass. A
--        recursive tree-fetch action (to render a multi-level BOM in the UI,
--        not just one level of `component_article` as `getArticle` currently
--        embeds) is also follow-up work, not schema work.
--
-- What deliberately did NOT change (out of scope for this migration):
--   - `article_components_no_self_reference` (`parent_article_id <>
--     component_article_id`) and the cross-organization check inside
--     `validate_article_component` both stay exactly as they were — still
--     valid regardless of nesting depth.
--   - No RLS policy or grant on `article_components`/`articles` changes here
--     — this is a business-rule/validation-trigger change, not a
--     tenant-isolation boundary change, so no new RLS test file or
--     `qa-reviewer` handoff accompanies this migration (see CLAUDE.md's
--     "Change size" calibration and this agent's own "small edit" working
--     mode) — only the existing `supabase/tests/database/articles_rls.
--     test.sql` is updated in the same pass, since two of its existing
--     assertions directly asserted the now-reversed behavior.

-- ---------------------------------------------------------------------------
-- 1. Drop the is_composite-flip back-door guard entirely — flipping
--    is_composite to true is no longer restricted by whether the article is
--    already used as a component elsewhere.
-- ---------------------------------------------------------------------------
drop trigger if exists articles_validate_is_composite_flip on public.articles;
drop function if exists public.validate_article_is_composite_flip();

comment on column public.articles.is_composite is
  'When true, this article is assembled from other articles (see article_components, its bill-of-materials). Does NOT affect purchase_price/sale_price, which are always this article''s own manually-entered values regardless of is_composite. As of issue #124, a composite article MAY itself be used as a component of another composite article (real multi-level BOM nesting) — the earlier one-level-only restriction and its is_composite-flip back-door guard were removed; only a cycle (this article, directly or transitively, becoming its own ancestor) is rejected, by validate_article_component.';

-- ---------------------------------------------------------------------------
-- 2. validate_article_component: drop the component-must-be-non-composite
--    requirement, add real cycle detection in its place.
-- ---------------------------------------------------------------------------
create or replace function public.validate_article_component()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_org uuid;
  v_parent_is_composite boolean;
  v_component_org uuid;
  v_cycle_found boolean;
begin
  select organization_id, is_composite into v_parent_org, v_parent_is_composite
  from public.articles
  where id = new.parent_article_id;

  if v_parent_org is null then
    raise exception 'article_components.parent_article_id % does not reference an existing article', new.parent_article_id
      using errcode = '23503';
  elsif not v_parent_is_composite then
    raise exception 'article_components.parent_article_id must reference an article with is_composite = true'
      using errcode = '23514';
  end if;

  select organization_id into v_component_org
  from public.articles
  where id = new.component_article_id;

  if v_component_org is null then
    raise exception 'article_components.component_article_id % does not reference an existing article', new.component_article_id
      using errcode = '23503';
  elsif v_component_org <> new.organization_id then
    raise exception 'article_components.component_article_id must belong to the same organization as the parent article'
      using errcode = '23514';
  end if;

  -- Cycle detection (issue #124): nested composites are now allowed, so
  -- component_article_id is no longer required to be non-composite, which
  -- reopens the possibility of a cycle. Reject if new.parent_article_id (P)
  -- is reachable by walking DOWN new.component_article_id's (X's) own
  -- descendant tree — i.e. P is a descendant of X anywhere in the
  -- article_components graph, which would make attaching X under P a cycle
  -- (P = X itself is already caught separately by the
  -- article_components_no_self_reference check constraint). A BOM node can
  -- have multiple children (several component lines under one parent),
  -- unlike article_groups' strictly single-parent ancestor chain, so this
  -- is a real tree traversal via a recursive CTE rather than
  -- validate_article_group_parent's plain while-loop. Depth-capped at 1000
  -- levels, the same defensive bound that trigger uses — this trigger is
  -- exactly what keeps the graph acyclic on every write, so an actual
  -- infinite walk is unreachable in practice; the cap is purely defensive.
  with recursive descendants (node_id, depth) as (
    select ac.component_article_id, 1
    from public.article_components ac
    where ac.parent_article_id = new.component_article_id
    union all
    select ac2.component_article_id, d.depth + 1
    from public.article_components ac2
    join descendants d on ac2.parent_article_id = d.node_id
    where d.depth < 1000
  )
  select exists (select 1 from descendants where node_id = new.parent_article_id)
  into v_cycle_found;

  if v_cycle_found then
    raise exception 'article_components.component_article_id would create a cycle in the bill of materials'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.validate_article_component() is
  'BEFORE INSERT/UPDATE OF parent_article_id, component_article_id trigger on public.article_components: rejects a parent_article_id that is not is_composite = true, a component_article_id from a different organization than the parent, or (issue #124) a component_article_id whose own descendant tree already reaches back to parent_article_id (a cycle in the bill of materials, since nested composites are now allowed — see this migration''s header design note, 20260906090000_article_components_allow_nested_composites.sql). Superseded the earlier is_composite = false-on-component requirement that made cycle detection unnecessary.';

comment on column public.article_components.component_article_id is
  'The sub-article consumed by the parent. Must belong to the same organization as parent_article_id (validate_article_component). As of issue #124, MAY itself be a composite article (real multi-level BOM nesting is now supported) — validate_article_component instead rejects a component whose own descendant tree already reaches back to the parent, which would create a cycle.';
