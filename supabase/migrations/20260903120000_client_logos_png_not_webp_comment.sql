-- Comment-only correction (issue #119 fix): clients.logo_path was originally
-- uploaded/documented as webp (see 20260903090000_clients_logo_and_
-- organization_own_client.sql), but the invoice PDF (app/(app)/quotes/
-- invoice-pdf.tsx, issue #119) embeds this same logo via
-- `@react-pdf/renderer`, whose image resolver (`@react-pdf/image`) only
-- recognizes jpg/jpeg/png/svg -- a webp logo silently failed to resolve
-- (an internal async error the renderer swallows, not a visible crash),
-- so the invoice's logo slot rendered blank. The application-layer upload
-- pipeline (`app/(app)/clients/components/compress-logo.ts`,
-- `app/(app)/clients/logo-actions.ts`) has been changed to re-encode/store
-- PNG instead (fixed filename `.../logo.png`) -- this migration only
-- updates the column comment to stop documenting the now-incorrect `.webp`
-- example path. No column, constraint, RLS policy, or Storage bucket
-- configuration changes -- `clients.logo_path` is a free-text Storage
-- object path with no format enforced or needed at the DB layer, same as
-- it always was; this is purely a "keep the comment truthful" fix.
--
-- Note: any client logo uploaded BEFORE this fix is still stored as
-- `logo.webp` and will still fail to render on an invoice PDF until that
-- client's owner re-uploads it (which now produces `logo.png` and
-- transparently replaces the old path via the ordinary upload flow).

comment on column public.clients.logo_path is
  'Supabase Storage OBJECT PATH (not a full URL) in the public "client-logos" bucket, e.g. "{organization_id}/{client_id}/logo.png" -- fixed filename per client so a re-upload overwrites in place. Null means no logo uploaded. Compression (issue #120: "Logo wordt gecomprimeerd opgeslagen") happens client-side/at the upload edge before the PUT, same as users.avatar_path -- nothing DB-level enforces or needs to enforce that. PNG, not webp (issue #119 fix, 20260903120000_client_logos_png_not_webp_comment.sql): @react-pdf/renderer''s image resolver -- used to embed this logo on the invoice PDF -- only supports jpg/jpeg/png/svg.';
