-- Issue #226 follow-up: planners may SEND work receipts (`work_receipts`
-- update), and sending reads the org's sender configuration from
-- `work_receipt_email_settings` under the caller's own session. The original
-- select policy (owner/administratie only, mirroring invoice_email_settings)
-- made every planner send fail with "sender not configured". Planners get
-- READ access only; writing the settings stays owner/administratie.

drop policy "work_receipt_email_settings_select_owner_or_administratie"
on public.work_receipt_email_settings;

create policy "work_receipt_email_settings_select_receipt_senders"
on public.work_receipt_email_settings
for select to authenticated
using (public.current_member_role(organization_id) in ('owner', 'planner', 'administratie'));
