"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Button, Card, FormGrid, FormSection, Label, Stack, Text, Textarea } from "@yourorg/ui";
import { CreditCard, FileText, Users } from "@yourorg/ui/icons";
import { createClient, updateClient, type ClientRecord } from "./actions";
import { FormField } from "./form-field";

interface ClientFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
  clientId?: string;
}

const initialState: ClientFormState = {};

/**
 * Create/edit form for a client, rendered as a real page rather than a
 * `Dialog` — see docs/ARCHITECTURE.md "Popup vs. full page — pick by weight,
 * not habit". As of issue #43, creating a client no longer goes through this
 * component/route at all (`/clients/new` was removed): "Add client" now
 * opens `NewClientPanel` (`new-client-panel.tsx`), a slide-in panel that
 * creates the client AND its first site together, per the user's explicit
 * override of the popup-vs-full-page default for that one flow. This
 * component is still live for editing (`/clients/[id]/edit`, the story only
 * asked for CREATE to become a panel) — the `client` prop is effectively
 * always present now, but the `isEdit`-branching is kept rather than ripped
 * out, in case a full-page create route is ever reintroduced.
 *
 * No Address section here (issue #41 redo, "Sites as client addresses") —
 * `ClientRecord` no longer carries flat address columns at all. A client's
 * address(es) are managed exclusively via the Sites tab on the client detail
 * page (`sites-panel.tsx`), created in context per docs/ARCHITECTURE.md
 * "Relational detail pages", not on this top-level form.
 *
 * No Email field (issue #43) — `clients.email` was dropped from the DB; a
 * client's contact email now only ever lives on its `Contact` rows. Added
 * KvK/VAT/IBAN as a "Business details" section instead (see migration
 * `20260825150000_clients_business_fields.sql`).
 *
 * Route-level RBAC gating (`can(actor, "clients", "create"|"update")`)
 * happens in the page Server Component before this ever renders — this
 * component doesn't re-check it, same division of responsibility the old
 * dialog had.
 */
export function ClientForm({ client }: { client?: ClientRecord | null }) {
  const isEdit = Boolean(client);
  const router = useRouter();

  async function action(_prevState: ClientFormState, formData: FormData): Promise<ClientFormState> {
    const input = Object.fromEntries(formData.entries());
    const result = isEdit ? await updateClient(client!.id, input) : await createClient(input);
    if (result.error || !result.data) {
      return { error: result.error ?? "Something went wrong.", fieldErrors: result.fieldErrors };
    }
    return { success: true, clientId: result.data.client.id };
  }

  const [state, formAction] = useActionState(action, initialState);

  useEffect(() => {
    if (state.success && state.clientId) {
      router.push(`/clients/${state.clientId}`);
    }
    // Only re-run when the mutation actually succeeds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success, state.clientId]);

  const cancelHref = isEdit ? `/clients/${client!.id}` : "/clients";

  return (
    <Card>
      <form action={formAction}>
        <Stack gap="lg">
          {state.error && <Text tone="danger">{state.error}</Text>}

          <FormSection title="Contact" icon={<Users />}>
            <FormField
              label="Name"
              name="name"
              defaultValue={client?.name}
              required
              errors={state.fieldErrors?.name}
            />
            <FormField label="Phone" name="phone" defaultValue={client?.phone} errors={state.fieldErrors?.phone} />
          </FormSection>

          {/* Dutch business-registration fields (issue #43, "Breid client
              uit") — kept as their own section rather than folded into
              "Contact": these are legal/financial identifiers, not ways to
              reach someone (that distinction is also why there's no Email
              field here anymore — a client's contact email now lives on its
              Contact records instead, see `contacts-panel.tsx`). */}
          <FormSection title="Business details" icon={<CreditCard />}>
            <FormGrid columns={3}>
              <FormField
                label="KvK number"
                name="kvkNumber"
                defaultValue={client?.kvk_number}
                errors={state.fieldErrors?.kvkNumber}
              />
              <FormField
                label="VAT number"
                name="vatNumber"
                defaultValue={client?.vat_number}
                errors={state.fieldErrors?.vatNumber}
              />
              <FormField label="IBAN" name="iban" defaultValue={client?.iban} errors={state.fieldErrors?.iban} />
            </FormGrid>
          </FormSection>

          <FormSection title="Notes" icon={<FileText />}>
            <Stack gap="xs">
              <Label htmlFor="notes">Internal notes</Label>
              <Textarea id="notes" name="notes" defaultValue={client?.notes ?? ""} />
              {state.fieldErrors?.notes?.map((message) => (
                <Text key={message} tone="danger">
                  {message}
                </Text>
              ))}
            </Stack>
          </FormSection>

          <div>
            <Button type="button" variant="outline" onClick={() => router.push(cancelHref)}>
              Cancel
            </Button>{" "}
            <SubmitButton isEdit={isEdit} />
          </div>
        </Stack>
      </form>
    </Card>
  );
}

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? "Saving…" : isEdit ? "Save changes" : "Add client"}
    </Button>
  );
}
