"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Button, Dialog, FormGrid, FormSection, Heading, Label, Select, Stack, Text, Textarea } from "@yourorg/ui";
import { BarChart3, CreditCard, FileText, Users } from "@yourorg/ui/icons";
import type { AccountManagerRecord } from "@/lib/account-managers/actions";
import { updateClient, type ClientRecord } from "../actions";
import { FormField } from "./form-field";
import { CLIENT_STATUS_OPTIONS } from "../kanban";
import { useEscapeToClose } from "../use-escape-to-close";

interface EditClientFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
}

const initialState: EditClientFormState = {};

/**
 * Slide-in panel for editing an existing client (issue #46, "Client edit
 * pagina moet ook een slide in popup worden") — a second explicit, confirmed
 * override of this app's default "Popup vs. full page" rule (see
 * `NewClientPanel`'s doc comment for the first one, client CREATE, issue
 * #43). Replaces the old full-page `/clients/[id]/edit` route (deleted in
 * the same change) — `ClientForm`/`client-form.tsx` is gone too, since this
 * panel was its only remaining caller once creation moved to `NewClientPanel`.
 *
 * Same field set `ClientForm`'s edit branch had, minus `phone` (Client:
 * name; Business details: KvK/VAT/IBAN; Notes) — still no Address section: a
 * client's address(es) live exclusively on the Sites tab
 * (`sites-panel.tsx`), unchanged by this issue. `phone` moved off the client
 * entirely (see migration `20260826130000_sites_phone.sql`) — it now lives
 * on a site and is edited from the Sites tab's own site form
 * (`site-form-dialog.tsx`), not here: this panel only ever touches the
 * client record itself.
 *
 * Unlike `NewClientPanel`, there's no post-success navigation — the caller
 * is already on the right page (the client detail page, or the clients
 * list/kanban). A successful save closes the panel and calls
 * `router.refresh()` (same pattern `DeleteClientDialog` already uses) so the
 * Server Component data already on screen (the `DetailHero`'s name, the
 * table row, ...) picks up the change immediately.
 */
export function EditClientPanel({
  client,
  accountManagers,
  open,
  onOpenChange,
}: {
  client: ClientRecord;
  /** Fetched once in `clients-board.tsx`, passed down — populates the
   * "Account manager" `<Select>` below (issue #58), same as
   * `NewClientPanel`. */
  accountManagers: AccountManagerRecord[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  useEscapeToClose(open, onOpenChange);

  async function action(_prevState: EditClientFormState, formData: FormData): Promise<EditClientFormState> {
    const input = Object.fromEntries(formData.entries());
    const result = await updateClient(client.id, input);
    if (result.error || !result.data) {
      return { error: result.error ?? "Something went wrong.", fieldErrors: result.fieldErrors };
    }
    return { success: true };
  }

  const [state, formAction] = useActionState(action, initialState);

  useEffect(() => {
    if (state.success) {
      onOpenChange(false);
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="panel">
      <Dialog.Header>
        <Heading level={3}>Edit {client.name}</Heading>
      </Dialog.Header>
      <form action={formAction}>
        <Dialog.Body>
          <Stack gap="md">
            {state.error && <Text tone="danger">{state.error}</Text>}

            <FormSection title="Client" icon={<Users />}>
              <FormField
                label="Name"
                name="name"
                defaultValue={client.name}
                required
                errors={state.fieldErrors?.name}
              />
            </FormSection>

            {/* Pipeline fields (issue #58) — same field set as `NewClientPanel`'s
                own "Pipeline" section. Unlike that panel, "Client since"
                defaults to the client's EXISTING stored value here, never
                today's date — per the story's explicit "Bij het bewerken van
                een client mag je deze datum niet vullen alleen als het om een
                nieuwe klant gaat." (only default it to today on a brand-new
                client). */}
            <FormSection title="Pipeline" icon={<BarChart3 />}>
              <FormGrid columns={2}>
                <Stack gap="xs">
                  <Label htmlFor="edit-client-status">Status</Label>
                  <Select id="edit-client-status" name="status" defaultValue={client.status}>
                    {CLIENT_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                  {state.fieldErrors?.status?.map((message) => (
                    <Text key={message} tone="danger">
                      {message}
                    </Text>
                  ))}
                </Stack>
                <Stack gap="xs">
                  <Label htmlFor="edit-client-account-manager">Account manager</Label>
                  <Select
                    id="edit-client-account-manager"
                    name="accountManagerId"
                    defaultValue={client.account_manager_id ?? ""}
                  >
                    <option value="">No account manager</option>
                    {accountManagers.map((manager) => (
                      <option key={manager.id} value={manager.id}>
                        {manager.first_name} {manager.last_name}
                      </option>
                    ))}
                  </Select>
                  {state.fieldErrors?.accountManagerId?.map((message) => (
                    <Text key={message} tone="danger">
                      {message}
                    </Text>
                  ))}
                </Stack>
                <FormField
                  label="Potential"
                  name="potentialValue"
                  type="number"
                  step="1"
                  min="0"
                  defaultValue={client.potential_value}
                  errors={state.fieldErrors?.potentialValue}
                />
                <FormField
                  label="Client since"
                  name="clientSince"
                  type="date"
                  defaultValue={client.client_since}
                  errors={state.fieldErrors?.clientSince}
                />
              </FormGrid>
            </FormSection>

            <FormSection title="Business details" icon={<CreditCard />}>
              <FormGrid columns={3}>
                <FormField
                  label="KvK number"
                  name="kvkNumber"
                  defaultValue={client.kvk_number}
                  errors={state.fieldErrors?.kvkNumber}
                />
                <FormField
                  label="VAT number"
                  name="vatNumber"
                  defaultValue={client.vat_number}
                  errors={state.fieldErrors?.vatNumber}
                />
                <FormField label="IBAN" name="iban" defaultValue={client.iban} errors={state.fieldErrors?.iban} />
              </FormGrid>
            </FormSection>

            <FormSection title="Notes" icon={<FileText />}>
              <Stack gap="xs">
                <Label htmlFor="edit-client-notes">Internal notes</Label>
                <Textarea id="edit-client-notes" name="notes" defaultValue={client.notes ?? ""} />
                {state.fieldErrors?.notes?.map((message) => (
                  <Text key={message} tone="danger">
                    {message}
                  </Text>
                ))}
              </Stack>
            </FormSection>
          </Stack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <SubmitButton />
        </Dialog.Footer>
      </form>
    </Dialog>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? "Saving…" : "Save changes"}
    </Button>
  );
}
