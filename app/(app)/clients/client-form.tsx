"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  FormGrid,
  FormGridFull,
  FormSection,
  Label,
  Stack,
  Text,
  Textarea,
} from "@yourorg/ui";
import { FileText, MapPin, Users } from "@yourorg/ui/icons";
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
 * Create/edit form for a client, rendered as a real page (`/clients/new`,
 * `/clients/[id]/edit`) rather than a `Dialog` — see docs/ARCHITECTURE.md
 * "Popup vs. full page — pick by weight, not habit". Field grouping
 * (Contact/Address/Notes via `FormSection`/`FormGrid`) is carried over
 * unchanged from the old `client-form-dialog.tsx`; only the container
 * changed (a `Card` on a page instead of a `Dialog`), and success now
 * navigates to a URL instead of closing an overlay.
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
            <FormGrid>
              <FormField
                label="Email"
                name="email"
                type="email"
                defaultValue={client?.email}
                errors={state.fieldErrors?.email}
              />
              <FormField label="Phone" name="phone" defaultValue={client?.phone} errors={state.fieldErrors?.phone} />
            </FormGrid>
          </FormSection>

          <FormSection title="Address" icon={<MapPin />}>
            <FormField
              label="Address line 1"
              name="addressLine1"
              defaultValue={client?.address_line1}
              errors={state.fieldErrors?.addressLine1}
            />
            <FormField
              label="Address line 2"
              name="addressLine2"
              defaultValue={client?.address_line2}
              errors={state.fieldErrors?.addressLine2}
            />
            <FormGrid>
              <FormField
                label="Postal code"
                name="postalCode"
                defaultValue={client?.postal_code}
                errors={state.fieldErrors?.postalCode}
              />
              <FormField label="City" name="city" defaultValue={client?.city} errors={state.fieldErrors?.city} />
              <FormGridFull>
                <FormField
                  label="Country"
                  name="country"
                  defaultValue={client?.country}
                  errors={state.fieldErrors?.country}
                />
              </FormGridFull>
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
