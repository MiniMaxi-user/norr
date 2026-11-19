-- Follow-up to 20261119120000_work_order_photos.sql: the project's default
-- privileges grant EXECUTE on new public functions to anon explicitly, which
-- `revoke ... from public` does not remove. Lock the photo access helpers down
-- to authenticated only.
revoke all on function public.work_order_photo_access(uuid, uuid, boolean) from anon;
revoke all on function public.work_order_photo_object_access(text, boolean) from anon;
