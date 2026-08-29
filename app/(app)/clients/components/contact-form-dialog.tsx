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
import { createContact, updateContact, type ContactRecord } from "../contacts-actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { FormField } from "./form-field";
import { useEscapeToClose } from "../use-escape-to-close";

interface ContactFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
  /** The just-created/updated row, only present on success — added for
   * issue #52's nested "+ New contact" flow (see `onCreated` below), which
   * needs the fresh `ContactRecord` (id, in particular) to select it in the
   * caller's own contact `<Select>` without a `router.refresh()`. */
  contact?: ContactRecord;
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
  onCreated,
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
  /** Issue #52: when this dialog is opened FROM another already-open dialog
   * (`SiteFormDialog`'s per-purpose "+ New contact" trigger) rather than
   * from `ContactsPanel` directly, the normal success path — `onOpenChange
   * (false)` + `router.refresh()` — is wrong on two counts: `router.refresh
   * ()` re-fetches the whole page's server data, which would also blow away
   * whatever the caller's own in-progress, not-yet-submitted form state was
   * (the entire point of "don't lose the rest of the in-progress site form"
   * per issue #52's brief); and the caller needs the fresh contact to select
   * it in its own `<Select>` immediately, before any refresh could even
   * deliver it back down as a new prop. When provided, this replaces that
   * default success path entirely: called with the new/updated contact, and
   * the caller is responsible for closing this dialog itself (typically
   * immediately, by flipping its own `open` state) — no `router.refresh()`
   * happens here in that case, since the caller's own eventual site-save
   * will trigger one anyway once the whole flow completes. */
  onCreated?: (contact: ContactRecord) => void;
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
    return { success: true, contact: result.data.contact };
  }

  const [state, formAction] = useActionState(action, initialState);

  useEffect(() => {
    if (!state.success) return;
    if (onCreated && state.contact) {
      onCreated(state.contact);
      return;
    }
    onOpenChange(false);
    router.refresh();
    // Depends on the whole `state` object, NOT `state.success` — issue #52's
    // nested "+ New contact" flow keeps this component mounted across
    // multiple opens (`SitePurposeFields` renders one `ContactFormDialog`
    // instance for all three purposes, only its `open` prop toggles), so a
    // SECOND successful create in the same session would produce a new
    // `state` object whose `success` field is still literally `true` —
    // `Object.is(true, true)` sees no change, and a `[state.success]`
    // dependency would silently skip this effect the second time around
    // (missing the second `onCreated` call and, in the non-nested case,
    // leaving the dialog open with `router.refresh()` never called). `state`
    // itself is always a fresh object reference on every dispatch, so
    // depending on it directly re-fires every time, repeats included.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

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
