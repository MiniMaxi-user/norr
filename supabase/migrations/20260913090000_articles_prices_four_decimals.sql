-- Articles: widen purchase_price/sale_price from numeric(12,2) to
-- numeric(14,4) (issue #135, "Artikel prijzen meer dan 2 decimalen") — the
-- acceptance criteria asks for 4 digits after the decimal point to be
-- configurable without error; the story body's own "3 cijfers" is
-- superseded by the acceptance criteria's explicit "4 cijfers", the actual
-- testable requirement.
--
-- `numeric(P, S)` is precision (total significant digits) then scale (digits
-- after the decimal point) — `numeric(12,2)` allows up to 10 digits before
-- the decimal. Simply bumping to `numeric(12,4)` would have shrunk that to 8
-- digits before the decimal (a silent regression in the maximum article
-- price this schema can hold), so precision is widened to 14 alongside the
-- scale change, preserving the original 10-digit integer-part capacity while
-- adding the 2 extra fractional digits the acceptance criteria needs.
-- `numeric` values are exact (unlike float), so widening scale never loses
-- precision on values already stored at 2 decimal places — this is a purely
-- additive change, safe on existing data.
--
-- The `articles_purchase_price_non_negative`/`articles_sale_price_non_negative`
-- CHECK constraints (>= 0) are untouched — they don't reference scale/
-- precision at all.
alter table public.articles
  alter column purchase_price type numeric(14, 4),
  alter column sale_price type numeric(14, 4);

comment on column public.articles.purchase_price is
  'numeric(14,4) — widened from numeric(12,2) by 20260913090000_articles_prices_four_decimals.sql (issue #135) to allow up to 4 digits after the decimal point. Always this article''s own manually-entered value, regardless of is_composite (see the table comment) — never derived from article_components.';
comment on column public.articles.sale_price is
  'numeric(14,4) — widened from numeric(12,2) by 20260913090000_articles_prices_four_decimals.sql (issue #135) to allow up to 4 digits after the decimal point. Always this article''s own manually-entered value, regardless of is_composite (see the table comment) — never derived from article_components.';
