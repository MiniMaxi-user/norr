"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Button, Dialog, FormGrid, FormSection, Heading, Label, Stack, Text, Textarea } from "@yourorg/ui";
import { CreditCard, FileText, Users } from "@yourorg/ui/icons";
import { updateClient, type ClientRecord } from "./actions";
import { FormField } from "./form-field";
import { useEscapeToClose } from "./use-escape-to-close";

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
  open,
  onOpenChange,
}: {
  client: ClientRecord;
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
