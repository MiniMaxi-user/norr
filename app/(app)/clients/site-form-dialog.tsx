"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Button,
  Checkbox,
  Dialog,
  FormGrid,
  FormGridFull,
  FormSection,
  Heading,
  Inline,
  Label,
  Stack,
  Text,
  Textarea,
} from "@yourorg/ui";
import { Building2, FileText, MapPin } from "@yourorg/ui/icons";
import { createSite, updateSite, type SiteRecord } from "./actions";
import { FormField } from "./form-field";
import { useEscapeToClose } from "./use-escape-to-close";

/** Whatever the user actually typed/checked on the last (failed) submit —
 * echoed back by `action()` below and used, in preference to `site`, to
 * compute every field's `defaultValue`/`defaultChecked`. `site` alone is a
 * poor source of truth for a validation-error re-render: on create it's
 * always `null`, so relying on it exclusively would silently render every
 * field back to empty/default the moment these inputs are ever remounted
 * (e.g. a stale Server Action reference after a dev-mode Fast Refresh,
 * which forces a real reload and re-mount of this whole dialog) rather than
 * showing what the user had entered. Booleans are only present here for the
 * checkboxes that were actually live/interactive on that submit (mirrors
 * `action()`'s own `forcePurpose`/`primaryLocked` omission logic) —
 * `undefined` means "wasn't submitted, fall back to the locked/forced value
 * or `site`", not "unchecked". */
interface SiteFormValues {
  name?: string;
  addressLine1?: string;
  addressLine2?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  notes?: string;
  isVisitAddress?: boolean;
  isInvoiceAddress?: boolean;
  isDeliveryAddress?: boolean;
  isPrimary?: boolean;
}

interface SiteFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
  values?: SiteFormValues;
}

const initialState: SiteFormState = {};

/**
 * Create/edit dialog for a client's site/address (issue #41 redo, "Sites as
 * client addresses") — same `useActionState` wrapper pattern as
 * `client-form-dialog.tsx`. `clientId` is only submitted on create (a
 * hidden field); on edit it's intentionally omitted so an edit never
 * accidentally re-parents the site (moving it to a different client of the
 * same org is a real, allowed edit per `siteUpdateSchema`'s comment, but
 * not a control this dialog exposes today).
 *
 * No Latitude/Longitude inputs — those are no longer client-submittable at
 * all (`siteBaseSchema` dropped them); the pin is now computed automatically
 * server-side from the address fields by `lib/geocoding/nominatim.ts`
 * ("Pin op kaart wordt bepaald door adres gegevens, niet latlong").
 */
export function SiteFormDialog({
  open,
  onOpenChange,
  clientId,
  site,
  isFirstSite = false,
  hasPrimarySite = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  site?: SiteRecord | null;
  /** True only when creating (`site` absent) AND the client has no sites
   * yet — the server forces the very first site's purpose flags + primary
   * to `true` regardless of what's submitted (see `createSite`), so this is
   * purely a UX hint: pre-check and disable the group instead of letting the
   * user think they have a real choice on the one save that's already
   * decided. Disabled inputs are omitted from `FormData` entirely, which is
   * fine here — the server ignores submitted purpose/primary values for a
   * client's first site either way. */
  isFirstSite?: boolean;
  /** True when the client already has a site with `is_primary = true`
   * (passed down from `sites-panel.tsx`, which has the full `sites` array in
   * scope). Only consulted for a normal (non-first-site) create, to decide
   * whether the "Primary address" checkbox should default checked — it
   * should NOT when a primary already exists (checking it would still work,
   * the server auto-unsets the prior primary via `enforce_single_primary_site`,
   * but defaulting to "take over primary" on every new site would be
   * surprising). Irrelevant for the forced-first-site case (always primary)
   * and for edit (`site`'s own `is_primary` drives the default there). */
  hasPrimarySite?: boolean;
}) {
  const isEdit = Boolean(site);
  const router = useRouter();
  useEscapeToClose(open, onOpenChange);

  // Forced-first-site behavior only applies to a brand-new site; editing an
  // existing site (even the client's only/primary one) always shows the
  // real, editable state of its own flags.
  const forcePurpose = !isEdit && isFirstSite;
  // Already-primary sites keep their primary status locked in this dialog —
  // change primary by making a *different* site primary instead (the server
  // auto-unsets the old one), not by unchecking it here, which would leave
  // the client with no primary address at all.
  const primaryLocked = forcePurpose || (isEdit && site?.is_primary === true);

  async function action(_prevState: SiteFormState, formData: FormData): Promise<SiteFormState> {
    const input: Record<string, unknown> = Object.fromEntries(formData.entries());
    // A `<Checkbox>` only appears in `FormData` at all when checked, and a
    // *disabled* one never appears regardless of its `defaultChecked` —
    // `Object.fromEntries` alone would silently omit an unchecked/disabled
    // box, which `siteUpdateSchema`'s partial shape would then read as
    // "leave unchanged" rather than "false". Only override the boxes that
    // are actually rendered as live/interactive in this dialog instance;
    // the forced-first-site / locked-primary cases below deliberately don't
    // send these keys at all, since the server either ignores them entirely
    // (first site) or should leave the existing value untouched (locked
    // primary on edit).
    if (!forcePurpose) {
      input.isVisitAddress = formData.get("isVisitAddress") === "on";
      input.isInvoiceAddress = formData.get("isInvoiceAddress") === "on";
      input.isDeliveryAddress = formData.get("isDeliveryAddress") === "on";
    }
    if (!primaryLocked) {
      input.isPrimary = formData.get("isPrimary") === "on";
    }
    // Echoed straight back on failure (see `SiteFormValues`) so every field
    // re-renders with what the user actually entered/checked, not whatever
    // `site` happened to hold (always `null` on create) — see this
    // component's doc comment for why relying on `site` alone here would
    // silently blank the form if these inputs are ever remounted.
    const values: SiteFormValues = {
      name: String(formData.get("name") ?? ""),
      addressLine1: String(formData.get("addressLine1") ?? ""),
      addressLine2: String(formData.get("addressLine2") ?? ""),
      postalCode: String(formData.get("postalCode") ?? ""),
      city: String(formData.get("city") ?? ""),
      country: String(formData.get("country") ?? ""),
      notes: String(formData.get("notes") ?? ""),
      isVisitAddress: forcePurpose ? undefined : (input.isVisitAddress as boolean),
      isInvoiceAddress: forcePurpose ? undefined : (input.isInvoiceAddress as boolean),
      isDeliveryAddress: forcePurpose ? undefined : (input.isDeliveryAddress as boolean),
      isPrimary: primaryLocked ? undefined : (input.isPrimary as boolean),
    };
    const result = isEdit ? await updateSite(site!.id, input) : await createSite(input);
    if (result.error || !result.data) {
      return { error: result.error ?? "Something went wrong.", fieldErrors: result.fieldErrors, values };
    }
    return { success: true };
  }

  const [state, formAction] = useActionState(action, initialState);

  // Every field's `defaultValue`/`defaultChecked` prefers the last submitted
  // values (`state.values`, only present after a failed submit) over `site`
  // — see `SiteFormValues`'s doc comment. Falls through to `site` (edit) or
  // the task's new create defaults (see `purposeDefault`/`primaryDefault`)
  // when there's nothing to echo yet, i.e. before the first submit.
  const values = state.values;

  function textDefault(submitted: string | undefined, existing: string | null | undefined): string {
    if (submitted !== undefined) return submitted;
    return existing ?? "";
  }

  /** New sites default every purpose checkbox to CHECKED (not just the
   * forced-first-site case, which was already always-true) — the other two
   * cases (forced-first-site, edit) keep their own pre-existing source of
   * truth. */
  function purposeDefault(submitted: boolean | undefined, existing: boolean | undefined): boolean {
    if (forcePurpose) return true;
    if (submitted !== undefined) return submitted;
    if (isEdit) return existing ?? false;
    return true;
  }

  /** New sites default "Primary address" to checked only when the client
   * doesn't already have a primary site (`hasPrimarySite`) — unlike the
   * purpose checkboxes, this one does NOT unconditionally default true for
   * every create. */
  function primaryDefault(): boolean {
    if (primaryLocked) return true;
    if (values?.isPrimary !== undefined) return values.isPrimary;
    if (isEdit) return site?.is_primary ?? false;
    return !hasPrimarySite;
  }

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
        <Heading level={3}>{isEdit ? "Edit site" : "Add site"}</Heading>
      </Dialog.Header>
      <form action={formAction}>
        {!isEdit && <input type="hidden" name="clientId" value={clientId} />}
        <Dialog.Body>
          <Stack gap="lg">
            {state.error && <Text tone="danger">{state.error}</Text>}

            <FormSection title="Site" icon={<Building2 />}>
              <FormField
                label="Name"
                name="name"
                defaultValue={textDefault(values?.name, site?.name)}
                required
                errors={state.fieldErrors?.name}
              />
            </FormSection>

            <FormSection title="Address" icon={<MapPin />}>
              <FormField
                label="Address line 1"
                name="addressLine1"
                defaultValue={textDefault(values?.addressLine1, site?.address_line1)}
                required
                errors={state.fieldErrors?.addressLine1}
              />
              <FormField
                label="Address line 2"
                name="addressLine2"
                defaultValue={textDefault(values?.addressLine2, site?.address_line2)}
                errors={state.fieldErrors?.addressLine2}
              />
              <FormGrid>
                <FormField
                  label="Postal code"
                  name="postalCode"
                  defaultValue={textDefault(values?.postalCode, site?.postal_code)}
                  required
                  errors={state.fieldErrors?.postalCode}
                />
                <FormField
                  label="City"
                  name="city"
                  defaultValue={textDefault(values?.city, site?.city)}
                  required
                  errors={state.fieldErrors?.city}
                />
                <FormGridFull>
                  <FormField
                    label="Country"
                    name="country"
                    defaultValue={textDefault(values?.country, site?.country)}
                    required
                    errors={state.fieldErrors?.country}
                  />
                </FormGridFull>
              </FormGrid>
            </FormSection>

            <FormSection
              title="Purpose"
              description={
                isFirstSite && !isEdit
                  ? "This client's first site — always the visit, invoice, and delivery address, and the primary address."
                  : "Select what this address is used for."
              }
            >
              <Stack gap="xs">
                <Text tone="muted">Address is suitable for</Text>
                <Stack gap="xs">
                  <Inline gap="sm" align="center">
                    <Checkbox
                      id="site-is-visit-address"
                      name="isVisitAddress"
                      defaultChecked={purposeDefault(values?.isVisitAddress, site?.is_visit_address)}
                      disabled={forcePurpose}
                    />
                    <Label htmlFor="site-is-visit-address">Visit address</Label>
                  </Inline>
                  <Inline gap="sm" align="center">
                    <Checkbox
                      id="site-is-invoice-address"
                      name="isInvoiceAddress"
                      defaultChecked={purposeDefault(values?.isInvoiceAddress, site?.is_invoice_address)}
                      disabled={forcePurpose}
                    />
                    <Label htmlFor="site-is-invoice-address">Invoice address</Label>
                  </Inline>
                  <Inline gap="sm" align="center">
                    <Checkbox
                      id="site-is-delivery-address"
                      name="isDeliveryAddress"
                      defaultChecked={purposeDefault(values?.isDeliveryAddress, site?.is_delivery_address)}
                      disabled={forcePurpose}
                    />
                    <Label htmlFor="site-is-delivery-address">Delivery address</Label>
                  </Inline>
                </Stack>
                {state.fieldErrors?.isVisitAddress?.map((message) => (
                  <Text key={message} tone="danger">
                    {message}
                  </Text>
                ))}
              </Stack>

              <Inline gap="sm" align="center">
                <Checkbox
                  id="site-is-primary"
                  name="isPrimary"
                  defaultChecked={primaryDefault()}
                  disabled={primaryLocked}
                />
                <Label htmlFor="site-is-primary">Primary address for this client</Label>
              </Inline>
              {state.fieldErrors?.isPrimary?.map((message) => (
                <Text key={message} tone="danger">
                  {message}
                </Text>
              ))}
            </FormSection>

            <FormSection title="Notes" icon={<FileText />}>
              <Stack gap="xs">
                <Label htmlFor="site-notes">Internal notes</Label>
                <Textarea id="site-notes" name="notes" defaultValue={textDefault(values?.notes, site?.notes)} />
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
      {pending ? "Saving…" : isEdit ? "Save changes" : "Add site"}
    </Button>
  );
}
