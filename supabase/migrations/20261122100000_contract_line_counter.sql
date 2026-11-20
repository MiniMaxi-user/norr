-- Issue #238: link a volume contract line to a counter (reference list
-- `volume`) with an included quantity per invoicing period and an overage
-- unit price. Counters are configured per asset model (asset_model_volumes,
-- #221); is_volume was added in #129. RLS and the owner/finance write
-- boundary are unchanged; only the column grants and the validation trigger
-- are extended.

alter table public.contract_line_items
  add column volume_item_id uuid references public.reference_list_items (id) on delete set null,
  add column included_quantity numeric,
  add column overage_unit_price numeric;

alter table public.contract_line_items
  add constraint contract_line_items_included_quantity_nonneg
    check (included_quantity is null or included_quantity >= 0),
  add constraint contract_line_items_overage_unit_price_nonneg
    check (overage_unit_price is null or overage_unit_price >= 0),
  add constraint contract_line_items_counter_requires_volume
    check (
      is_volume
      or (volume_item_id is null and included_quantity is null and overage_unit_price is null)
    );

create index contract_line_items_volume_item_id_idx
  on public.contract_line_items (volume_item_id);

comment on column public.contract_line_items.volume_item_id is
  'The counter (reference_list_items row of the organization''s `volume` list) this volume line is settled against. Only allowed when is_volume = true (check contract_line_items_counter_requires_volume). Must belong to the same organization and the `volume` list (validate_contract_line_item_relations). Nullable: a volume line may exist without a counter. on delete set null.';
comment on column public.contract_line_items.included_quantity is
  'Quantity of the counter included per invoicing period; usage above it is billed at overage_unit_price. Nullable, >= 0, only when is_volume = true.';
comment on column public.contract_line_items.overage_unit_price is
  'Price per counter unit above included_quantity. Nullable, >= 0, only when is_volume = true.';

-- Extend the relations validator with the counter check.
create or replace function public.validate_contract_line_item_relations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_article_org_id uuid;
  v_volume_org_id uuid;
  v_volume_key text;
begin
  select organization_id into v_article_org_id
  from public.articles
  where id = new.article_id;

  if v_article_org_id is null then
    raise exception 'contract_line_items.article_id % does not reference an existing article', new.article_id
      using errcode = '23503';
  elsif v_article_org_id <> new.organization_id then
    raise exception 'contract_line_items.article_id must belong to the same organization as the contract'
      using errcode = '23514';
  end if;

  if new.volume_item_id is not null then
    select rl.organization_id, rl.list_key into v_volume_org_id, v_volume_key
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rli.id = new.volume_item_id;

    if v_volume_org_id is null then
      raise exception 'contract_line_items.volume_item_id % does not reference an existing reference_list_items row', new.volume_item_id
        using errcode = '23503';
    elsif v_volume_org_id <> new.organization_id then
      raise exception 'contract_line_items.volume_item_id must belong to the same organization as the contract'
        using errcode = '23514';
    elsif v_volume_key <> 'volume' then
      raise exception 'contract_line_items.volume_item_id must reference an item from the volume reference list (got list_key=%)', v_volume_key
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_contract_line_item_relations() is
  'BEFORE INSERT/UPDATE OF contract_id, article_id, volume_item_id trigger on public.contract_line_items: rejects an article_id from a different organization than the contract, and (issue #238) a volume_item_id from a different organization or from a list other than `volume`. contract_id is excluded from the UPDATE column grant, so that branch is a defense-in-depth backstop. Runs after contract_line_items_derive_organization_id (alphabetically later trigger name, same timing), so new.organization_id is already final.';

drop trigger contract_line_items_validate_relations on public.contract_line_items;
create trigger contract_line_items_validate_relations
  before insert or update of contract_id, article_id, volume_item_id on public.contract_line_items
  for each row execute function public.validate_contract_line_item_relations();

-- Column-level grants (replaces the #129 grants; same columns + the new ones).
revoke insert, update on public.contract_line_items from authenticated;

grant insert (
  id, contract_id, article_id, article_number, description, quantity,
  unit_price, purchase_price, is_volume, volume_item_id, included_quantity,
  overage_unit_price, sort_order
) on public.contract_line_items to authenticated;

grant update (
  article_id, article_number, description, quantity, unit_price,
  purchase_price, is_volume, volume_item_id, included_quantity,
  overage_unit_price, sort_order
) on public.contract_line_items to authenticated;
