"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Button,
  Checkbox,
  Dialog,
  FormGrid,
  FormSection,
  Heading,
  Inline,
  Label,
  Select,
  Stack,
  Text,
  Textarea,
} from "@yourorg/ui";
import { FileText, Users } from "@yourorg/ui/icons";
import { createContact, updateContact, type ContactRecord } from "./contacts-actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { FormField } from "./form-field";
import { useEscapeToClose } from "./use-escape-to-close";

interface ContactFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
}

const initialState: ContactFormState = {};

/**
 * Create/edit dialog for a client's contact (issue #26) — created/edited
 * in-context, pre-scoped to `clientId`, per docs/ARCHITECTURE.md "Relational
 * detail pages" (no bare disconnected form). Same `useActionState` +
 * `FormSection`/`FormGrid` shape as `client-form-dialog.tsx`/
 * `site-form-dialog.tsx`.
 *
 * `isPrimary` needs special handling unlike every other field here: a
 * `<Checkbox>` only appears in `FormData` at all when checked (value
 * `"on"`), and `contactCreateSchema`/`contactUpdateSchema` expect a real
 * `boolean`, not that string — so unlike `client-form-dialog.tsx`'s plain
 * `Object.fromEntries(formData.entries())`, this dialog overrides that one
 * field explicitly (same idea as `asset-form-actions.ts`'s
 * `readOptionalField`, which also normalizes a raw `FormData` value into the
 * shape its schema actually expects, before calling the real Server Action).
 */
export function ContactFormDialog({
  open,
  onOpenChange,
  clientId,
  contact,
  contactRoles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  /** Present for edit, absent for create — same `isEdit = Boolean(...)`
   * convention as `ClientFormDialog`/`SiteFormDialog`. */
  contact?: ContactRecord | null;
  /** This org's `contact_role` picklist values, fetched by the caller (same
   * "fetch once, pass down" convention `AssetFormDialog` uses for
   * `assetTypes`/`assetStatuses`). */
  contactRoles: ReferenceListItemRecord[];
}) {
  const isEdit = Boolean(contact);
  const router = useRouter();
  useEscapeToClose(open, onOpenChange);

  async function action(_prevState: ContactFormState, formData: FormData): Promise<ContactFormState> {
    const input = {
      ...Object.fromEntries(formData.entries()),
      isPrimary: formData.get("isPrimary") === "on",
    };
    const result = isEdit ? await updateContact(contact!.id, input) : await createContact(clientId, input);
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
    <Dialog open={open} onOpenChange={onOpenChange} size="lg">
      <Dialog.Header>
        <Heading level={3}>{isEdit ? "Edit contact" : "Add contact"}</Heading>
      </Dialog.Header>
      <form action={formAction}>
        <Dialog.Body>
          <Stack gap="lg">
            {state.error && <Text tone="danger">{state.error}</Text>}

            <FormSection title="Contact" icon={<Users />}>
              <FormField
                label="Name"
                name="name"
                defaultValue={contact?.name}
                required
                errors={state.fieldErrors?.name}
              />
              <FormGrid>
                <FormField
                  label="Email"
                  name="email"
                  type="email"
                  defaultValue={contact?.email}
                  errors={state.fieldErrors?.email}
                />
                <FormField
                  label="Phone"
                  name="phone"
                  defaultValue={contact?.phone}
                  errors={state.fieldErrors?.phone}
                />
              </FormGrid>

              <Stack gap="xs">
                <Label htmlFor="contact-role">Role</Label>
                <Select id="contact-role" name="roleItemId" defaultValue={contact?.role_item_id ?? ""}>
                  <option value="">No role</option>
                  {contactRoles.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </Select>
                {state.fieldErrors?.roleItemId?.map((message) => (
                  <Text key={message} tone="danger">
                    {message}
                  </Text>
                ))}
              </Stack>

              <Inline gap="sm" align="center">
                <Checkbox id="contact-is-primary" name="isPrimary" defaultChecked={contact?.is_primary ?? false} />
                <Label htmlFor="contact-is-primary">Primary contact for this client</Label>
              </Inline>
              {state.fieldErrors?.isPrimary?.map((message) => (
                <Text key={message} tone="danger">
                  {message}
                </Text>
              ))}
            </FormSection>

            <FormSection title="Notes" icon={<FileText />}>
              <Stack gap="xs">
                <Label htmlFor="contact-notes">Internal notes</Label>
                <Textarea id="contact-notes" name="notes" defaultValue={contact?.notes ?? ""} />
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
          <SubmitButton isEdit={isEdit} />
        </Dialog.Footer>
      </form>
    </Dialog>
  );
}

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? "Saving…" : isEdit ? "Save changes" : "Add contact"}
    </Button>
  );
}
