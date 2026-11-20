-- Contract volume lines: the line's own quantity IS the included counter
-- quantity (per billing period), so the separate included_quantity column
-- (#238, added the same day) is dropped. Existing values lapse (agreed with
-- the product owner). Usage above quantity x (terms / period) is billed at
-- overage_unit_price when generating contract quotes (#239).
--
-- Dropping the column also drops the constraints and column-level grants that
-- reference it (contract_line_items_included_quantity_nonneg and the
-- multi-column contract_line_items_counter_requires_volume), so the latter is
-- recreated without it. The remaining column grants are unchanged.

alter table public.contract_line_items
  drop constraint if exists contract_line_items_counter_requires_volume,
  drop constraint if exists contract_line_items_included_quantity_nonneg;

alter table public.contract_line_items
  drop column if exists included_quantity;

alter table public.contract_line_items
  add constraint contract_line_items_counter_requires_volume
    check (is_volume or (volume_item_id is null and overage_unit_price is null));

comment on column public.contract_line_items.overage_unit_price is
  'Price per counter unit above the included quantity (= quantity per billing period, scaled to the invoice period). Nullable, >= 0, only when is_volume = true.';
