"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Dialog, FormGrid, FormSection, Heading, Label, Select, Stack, Text, Textarea } from "@yourorg/ui";
import { BarChart3, Building2, CreditCard, FileText, Users } from "@yourorg/ui/icons";
import type { AccountManagerRecord } from "@/lib/account-managers/actions";
import { createClient, createSite } from "./actions";
import { FormField } from "./form-field";
import { CLIENT_STATUS_OPTIONS } from "./kanban";
import { clientCreateSchema, siteBaseSchema } from "./schema";
import { useEscapeToClose } from "./use-escape-to-close";

/** Only the address-shaped subset of `siteBaseSchema` this panel actually
 * collects — no `clientId` (the new client doesn't exist yet at validation
 * time; it's supplied separately once `createClient` returns an id), no
 * purpose/primary flags (per issue #43's spec: this is implicitly the
 * client's default/primary address, mirroring `createSite`'s existing
 * "first site for a client is forced to all-purposes + primary" rule — see
 * that rule's comment in `actions.ts`, which fires automatically here too
 * since a brand-new client always has zero prior sites), and no `notes`
 * (this panel has no "site notes" field — only the client's own `notes`,
 * which is a different field entirely; see `action()` below for why the two
 * must never be conflated even though both are named `notes` in `FormData`).
 * `phone` IS included here even though it's rendered under this panel's
 * "Address" section below: phone lives on `sites`, not `clients` (see
 * migration `20260826130000_sites_phone.sql`), so "this new client's first
 * phone number" is really this new site's phone number — collected once in
 * this single-panel flow, but routed through `createSite` below, never
 * `createClient`. */
const newClientAddressSchema = siteBaseSchema.pick({
  addressLine1: true,
  addressLine2: true,
  postalCode: true,
  city: true,
  country: true,
  phone: true,
});

interface NewClientFormValues {
  name?: string;
  phone?: string;
  kvkNumber?: string;
  vatNumber?: string;
  iban?: string;
  notes?: string;
  addressLine1?: string;
  addressLine2?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  status?: string;
  accountManagerId?: string;
  potentialValue?: string;
  clientSince?: string;
}

interface NewClientFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
  /** Set on full success (client + site both created), AND on the rare
   * partial-failure case where the client insert succeeded but the site
   * insert then failed (see `action()`) — in that second case `success` is
   * still `false`, so the panel stays open showing the site error, but this
   * lets the JSX offer a "View client" escape hatch rather than stranding
   * the user with no way to reach a client that, from their perspective,
   * "failed" but actually exists. */
  clientId?: string;
  values?: NewClientFormValues;
}

const initialState: NewClientFormState = {};

/**
 * Slide-in panel for creating a client (issue #43, "Nieuwe klant toevoegen
 * toont nieuwe popup") — an explicit, confirmed override of this app's
 * default "Popup vs. full page" rule (a top-level module's own record
 * normally gets a real page, never a `Dialog`; see docs/ARCHITECTURE.md).
 * Replaces the old full-page `/clients/new` flow (route deleted in the same
 * change). As of issue #46, editing a client is the same kind of override —
 * `EditClientPanel` (`edit-client-panel.tsx`), opened instead of navigating
 * to the (now-deleted) full-page `/clients/[id]/edit` route.
 *
 * Collects the client's own fields AND its first address in the SAME panel
 * (no separate "add a site" step) — on submit, `action()`:
 *   1. Validates both the client fields (`clientCreateSchema`) and the
 *      address fields (`newClientAddressSchema`) up front, before either
 *      insert fires. This matters specifically because the two inserts are
 *      sequential and the first (`createClient`) has no automatic rollback
 *      if the second (`createSite`) then fails — without validating both
 *      shapes first, a submission that was always going to fail address
 *      validation would still leave behind an orphaned client with zero
 *      sites. Combines both schemas' `fieldErrors` into one object (their
 *      field names never collide — see the schema comment above re: `notes`)
 *      so every bad field across both "sections" highlights in one pass.
 *   2. Calls `createClient`, then (only if that succeeded) `createSite` with
 *      the new client's id — same sequential-await style
 *      `SiteFormDialog`/`ContactFormDialog` already use for their own single
 *      calls, just two calls here. `createSite`'s own "first site for this
 *      client is forced to all-purposes + primary" override
 *      (`actions.ts`) fires automatically since `count` is naturally 0 for a
 *      client that was just created — this panel doesn't (and shouldn't)
 *      show the Visit/Invoice/Delivery/"Primary address" controls
 *      `SiteFormDialog` has, since none of them are real choices here.
 *
 * Value-echoing on a failed submit follows the exact same pattern
 * `SiteFormDialog` uses (see that file's `SiteFormValues` doc comment):
 * `state.values` (only populated after a failed submit) takes priority over
 * any prop-derived default, so nothing the user typed is ever silently
 * dropped by a re-render.
 */
export function NewClientPanel({
  open,
  onOpenChange,
  accountManagers,
  todayIso,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fetched once in `clients-board.tsx`, passed down — populates the
   * "Account manager" `<Select>` below (issue #58). */
  accountManagers: AccountManagerRecord[];
  /** Server-computed `YYYY-MM-DD` "today" — the default "Client since" value
   * on this (CREATE-only) panel. See `clients-board.tsx` for why this is
   * computed server-side rather than via the visitor's local browser date. */
  todayIso: string;
}) {
  const router = useRouter();
  useEscapeToClose(open, onOpenChange);

  async function action(_prevState: NewClientFormState, formData: FormData): Promise<NewClientFormState> {
    const input = Object.fromEntries(formData.entries());

    const values: NewClientFormValues = {
      name: String(formData.get("name") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      kvkNumber: String(formData.get("kvkNumber") ?? ""),
      vatNumber: String(formData.get("vatNumber") ?? ""),
      iban: String(formData.get("iban") ?? ""),
      notes: String(formData.get("notes") ?? ""),
      addressLine1: String(formData.get("addressLine1") ?? ""),
      addressLine2: String(formData.get("addressLine2") ?? ""),
      postalCode: String(formData.get("postalCode") ?? ""),
      city: String(formData.get("city") ?? ""),
      country: String(formData.get("country") ?? ""),
      status: String(formData.get("status") ?? ""),
      accountManagerId: String(formData.get("accountManagerId") ?? ""),
      potentialValue: String(formData.get("potentialValue") ?? ""),
      clientSince: String(formData.get("clientSince") ?? ""),
    };

    // Validate both shapes up front (see this component's doc comment for
    // why) — each schema silently strips the other's fields (plain zod
    // object behavior for unrecognized keys), so passing the same combined
    // `input` to both is safe and never produces a false-positive error on
    // the other section's fields.
    const clientParsed = clientCreateSchema.safeParse(input);
    const addressParsed = newClientAddressSchema.safeParse(input);

    if (!clientParsed.success || !addressParsed.success) {
      const fieldErrors: Record<string, string[] | undefined> = {
        ...(clientParsed.success ? {} : clientParsed.error.flatten().fieldErrors),
        ...(addressParsed.success ? {} : addressParsed.error.flatten().fieldErrors),
      };
      return { error: "Please fix the highlighted fields.", fieldErrors, values };
    }

    const clientResult = await createClient(input);
    if (clientResult.error || !clientResult.data) {
      return { error: clientResult.error ?? "Something went wrong.", fieldErrors: clientResult.fieldErrors, values };
    }

    const newClientId = clientResult.data.client.id;

    // Built explicitly (not spread from `input`) — `input` also carries the
    // client's own `notes` field under the same `notes` key `siteBaseSchema`
    // uses for a SITE's notes; spreading it here would silently write the
    // client's internal notes onto the new site instead. This panel has no
    // "site notes" field at all, so `notes` is simply omitted from this
    // payload.
    const siteResult = await createSite({
      clientId: newClientId,
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2,
      postalCode: input.postalCode,
      city: input.city,
      country: input.country,
      phone: input.phone,
    });
    if (siteResult.error || !siteResult.data) {
      // Rare: the address was already validated locally above, so a failure
      // here is a genuine server-side error (DB constraint, transient
      // failure, ...), not a validation miss. The client record was already
      // created successfully at this point — there's no clean rollback
      // available (silently deleting the just-created client out from under
      // a concurrent read would be its own hazard), so this keeps the panel
      // open with the site error surfaced, but threads `clientId` through so
      // the JSX can offer a "View client" link rather than stranding the
      // user with a client they can't otherwise reach from here.
      return {
        error: siteResult.error ?? "The client was created, but its address could not be saved.",
        fieldErrors: siteResult.fieldErrors,
        values,
        clientId: newClientId,
      };
    }

    return { success: true, clientId: newClientId };
  }

  const [state, formAction] = useActionState(action, initialState);
  const values = state.values;

  function textDefault(submitted: string | undefined): string {
    return submitted ?? "";
  }

  useEffect(() => {
    if (state.success && state.clientId) {
      onOpenChange(false);
      router.push(`/clients/${state.clientId}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success, state.clientId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="panel">
      <Dialog.Header>
        <Heading level={3}>Add client</Heading>
      </Dialog.Header>
      <form action={formAction}>
        <Dialog.Body>
          <Stack gap="md">
            {state.error && (
              <Stack gap="xs">
                <Text tone="danger">{state.error}</Text>
                {state.clientId && (
                  <Link href={`/clients/${state.clientId}`}>
                    <Button type="button" variant="outline" size="sm">
                      View the client that was created
                    </Button>
                  </Link>
                )}
              </Stack>
            )}

            <FormSection title="Client" icon={<Users />}>
              <FormField
                label="Name"
                name="name"
                defaultValue={textDefault(values?.name)}
                required
                errors={state.fieldErrors?.name}
              />
            </FormSection>

            {/* Pipeline fields (issue #58) — same field set on both the New
                and Edit panels ("zelfde als client edit"), only the
                defaults differ: Status defaults to "Lead" here (matches the
                DB default, shown/editable so a prospect that's already past
                Lead isn't forced into a follow-up edit); Client since
                defaults to today's date here (never auto-filled on Edit —
                see that panel's own comment). */}
            <FormSection title="Pipeline" icon={<BarChart3 />}>
              <FormGrid columns={2}>
                <Stack gap="xs">
                  <Label htmlFor="new-client-status">Status</Label>
                  <Select id="new-client-status" name="status" defaultValue={values?.status || "lead"}>
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
                  <Label htmlFor="new-client-account-manager">Account manager</Label>
                  <Select
                    id="new-client-account-manager"
                    name="accountManagerId"
                    defaultValue={textDefault(values?.accountManagerId)}
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
                  defaultValue={values?.potentialValue}
                  errors={state.fieldErrors?.potentialValue}
                />
                <FormField
                  label="Client since"
                  name="clientSince"
                  type="date"
                  defaultValue={values?.clientSince || todayIso}
                  errors={state.fieldErrors?.clientSince}
                />
              </FormGrid>
            </FormSection>

            <FormSection title="Business details" icon={<CreditCard />}>
              <FormGrid columns={3}>
                <FormField
                  label="KvK number"
                  name="kvkNumber"
                  defaultValue={textDefault(values?.kvkNumber)}
                  errors={state.fieldErrors?.kvkNumber}
                />
                <FormField
                  label="VAT number"
                  name="vatNumber"
                  defaultValue={textDefault(values?.vatNumber)}
                  errors={state.fieldErrors?.vatNumber}
                />
                <FormField
                  label="IBAN"
                  name="iban"
                  defaultValue={textDefault(values?.iban)}
                  errors={state.fieldErrors?.iban}
                />
              </FormGrid>
            </FormSection>

            {/* This client's first (default/primary) address — deliberately
                no Visit/Invoice/Delivery purpose checkboxes and no "Primary
                address" checkbox here (unlike `SiteFormDialog`): a brand-new
                client always has zero prior sites, so `createSite`'s
                existing "first site is forced to all-purposes + primary"
                override already guarantees the outcome those controls would
                otherwise let the user (redundantly) choose. `phone` lives
                here (not in the "Client" section above) because it's a
                site-level field now — see `newClientAddressSchema`'s doc
                comment above — and a phone number for "how to reach someone
                at this address" belongs conceptually with the address it's
                attached to. */}
            <FormSection title="Address" icon={<Building2 />}>
              <FormField
                label="Address line 1"
                name="addressLine1"
                defaultValue={textDefault(values?.addressLine1)}
                required
                errors={state.fieldErrors?.addressLine1}
              />
              <FormField
                label="Address line 2"
                name="addressLine2"
                defaultValue={textDefault(values?.addressLine2)}
                errors={state.fieldErrors?.addressLine2}
              />
              <FormField
                label="Phone"
                name="phone"
                defaultValue={textDefault(values?.phone)}
                errors={state.fieldErrors?.phone}
              />
              <FormGrid columns={3}>
                <FormField
                  label="Postal code"
                  name="postalCode"
                  defaultValue={textDefault(values?.postalCode)}
                  required
                  errors={state.fieldErrors?.postalCode}
                />
                <FormField
                  label="City"
                  name="city"
                  defaultValue={textDefault(values?.city)}
                  required
                  errors={state.fieldErrors?.city}
                />
                <FormField
                  label="Country"
                  name="country"
                  defaultValue={textDefault(values?.country)}
                  errors={state.fieldErrors?.country}
                />
              </FormGrid>
            </FormSection>

            <FormSection title="Notes" icon={<FileText />}>
              <Stack gap="xs">
                <Label htmlFor="new-client-notes">Internal notes</Label>
                <Textarea id="new-client-notes" name="notes" defaultValue={textDefault(values?.notes)} />
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
      {pending ? "Saving…" : "Add client"}
    </Button>
  );
}
