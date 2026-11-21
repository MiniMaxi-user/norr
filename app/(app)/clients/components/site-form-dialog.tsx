"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  FormField,
  FormGrid,
  FormSection,
  Heading,
  Inline,
  Label,
  Stack,
  Table,
  Text,
  Textarea,
  useEscapeToClose,
} from "@yourorg/ui";
import { Building2, FileText, Plus, Users } from "@yourorg/ui/icons";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { createSite, updateSite, type SiteRecord } from "../actions";
import { SITE_CONTACT_ROLES, type SiteContactRole } from "../schema";
import { ContactFormDialog } from "./contact-form-dialog";
import type { ContactRecord } from "../contacts-actions";

/** Shared "submitted value wins, else fall back to the existing row, else
 * empty" default resolution — used both directly (plain text fields) and by
 * `SiteFormBody` below (each purpose's own contact `<select>`). Lives at
 * module scope (no closure over component state) so both can call it
 * identically. */
function textDefault(submitted: string | undefined, existing: string | null | undefined): string {
  if (submitted !== undefined) return submitted;
  return existing ?? "";
}

/** New sites default every purpose checkbox to CHECKED (not just the
 * forced-first-site case, which was already always-true); an edit shows the
 * real, existing state of its own flags. Module-scope (not a closure over
 * `SiteFormDialog`'s own `forcePurpose`/`isEdit`) so `SiteFormBody` below can
 * use the exact same rule for its own lazy-initialized local state. */
function purposeChecked(
  forcePurpose: boolean,
  isEdit: boolean,
  submitted: boolean | undefined,
  existing: boolean | undefined,
): boolean {
  if (forcePurpose) return true;
  if (submitted !== undefined) return submitted;
  if (isEdit) return existing ?? false;
  return true;
}

type PurposeKey = "visit" | "invoice" | "delivery";

/** Matrix columns: label per role, and whether the role needs an e-mail address. */
const MATRIX_COLUMNS: { role: SiteContactRole; label: string; needsEmail: boolean }[] = [
  { role: "visit", label: "Visit", needsEmail: false },
  { role: "delivery", label: "Delivery", needsEmail: false },
  { role: "invoice", label: "Invoice", needsEmail: true },
  { role: "work_receipt", label: "Work receipt", needsEmail: true },
];

/** Cell key of one matrix checkbox (also its submitted value). */
function tickKey(contactId: string, role: SiteContactRole): string {
  return `${contactId}:${role}`;
}

/** Issue #55 (kept for the matrix): a brand-new site starts with its primary
 * contact (else the most recently added one) ticked for Visit, Delivery and
 * Invoice. Invoice only when that contact has an e-mail address. Only used
 * for a pristine CREATE; an edit shows the site's own saved ticks. */
function defaultTicks(contacts: ContactRecord[]): string[] {
  const contact =
    contacts.find((item) => item.is_primary) ??
    contacts.reduce<ContactRecord | null>((latest, item) => (!latest || item.created_at > latest.created_at ? item : latest), null);
  if (!contact) return [];
  const ticks = [tickKey(contact.id, "visit"), tickKey(contact.id, "delivery")];
  if (contact.email?.trim()) ticks.push(tickKey(contact.id, "invoice"));
  return ticks;
}

/** Primary contact first, then by name (same order the server uses to pick "the" contact). */
function sortContacts(contacts: ContactRecord[]): ContactRecord[] {
  return [...contacts].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.name.localeCompare(b.name));
}

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
  addressLine1?: string;
  addressLine2?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  phone?: string;
  notes?: string;
  isVisitAddress?: boolean;
  isInvoiceAddress?: boolean;
  isDeliveryAddress?: boolean;
  /** Issue #52 — echoed back the same way as every other field above (see
   * this interface's own doc comment), though in practice `SiteFormBody`
   * below never actually unmounts/remounts on a failed submit within the
   * same dialog session (it lives inside the `<Dialog>` subtree, which only
   * remounts on an open/close transition, not on a failed submit), so its own
   * local `useState` already survives a failed submit unaided. Kept here
   * anyway for the same defensive "remount safety net" reason as every other
   * field. */
  contactTicks?: string[];
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
 *
 * The actual `<form>` (plus, since issue #52, the nested "+ New contact"
 * `ContactFormDialog`) lives in `SiteFormBody` below, not inline here — see
 * that component's own doc comment for why.
 */
export function SiteFormDialog({
  open,
  onOpenChange,
  clientId,
  site,
  isFirstSite = false,
  hasPrimarySite = false,
  contacts,
  contactRoles,
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
  /** This client's own existing contacts (issue #52) — fetched once by
   * `client-detail.tsx` and threaded down through `SitesPanel`, same "fetch
   * once, pass down" convention `ContactsPanel`/`AccessPanel` already use.
   * Populates each purpose's contact `<select>` — deliberately scoped to
   * THIS client only (never the org's other clients' contacts), which is
   * what keeps a user from even attempting the cross-client pick the DB's
   * `validate_site_contact_persons` trigger would otherwise reject. */
  contacts: ContactRecord[];
  /** This org's `contact_role` picklist values — passed straight through to
   * the nested "+ New contact" `ContactFormDialog` (same prop `ContactsPanel`
   * already threads to its own instance) and to `contactOptionLabel` for each
   * `<select>`'s option text. */
  contactRoles: ReferenceListItemRecord[];
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
    // Matrix cells arrive as repeated "contactId:role" values (only ticked,
    // enabled boxes are submitted).
    const contactTicks = formData.getAll("contactTicks").map(String);
    delete input.contactTicks;
    input.contactRoles = contactTicks.flatMap((tick) => {
      const [contactId, role] = tick.split(":");
      return contactId && (SITE_CONTACT_ROLES as readonly string[]).includes(role ?? "")
        ? [{ contactId, role: role as SiteContactRole }]
        : [];
    });
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
      addressLine1: String(formData.get("addressLine1") ?? ""),
      addressLine2: String(formData.get("addressLine2") ?? ""),
      postalCode: String(formData.get("postalCode") ?? ""),
      city: String(formData.get("city") ?? ""),
      country: String(formData.get("country") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      notes: String(formData.get("notes") ?? ""),
      isVisitAddress: forcePurpose ? undefined : (input.isVisitAddress as boolean),
      isInvoiceAddress: forcePurpose ? undefined : (input.isInvoiceAddress as boolean),
      isDeliveryAddress: forcePurpose ? undefined : (input.isDeliveryAddress as boolean),
      contactTicks,
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
  // the task's new create defaults (see `purposeChecked`/`primaryDefault`)
  // when there's nothing to echo yet, i.e. before the first submit.
  const values = state.values;

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
    // Depends on the whole `state` object, not `state.success` — see the
    // identical fix (and its full reasoning) in `ContactFormDialog`'s own
    // success effect. `SitesPanel` also keeps one `SiteFormDialog` instance
    // mounted across every open/close, so a second successful save in the
    // same session would otherwise produce a new `state` object whose
    // `success` field is still literally `true`, which a `[state.success]`
    // dependency can't tell apart from "no change" and would silently skip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="panel">
      <Dialog.Header>
        <Heading level={3}>{isEdit ? "Edit site" : "Add site"}</Heading>
      </Dialog.Header>
      <SiteFormBody
        isEdit={isEdit}
        forcePurpose={forcePurpose}
        primaryLocked={primaryLocked}
        clientId={clientId}
        site={site}
        contacts={contacts}
        contactRoles={contactRoles}
        formAction={formAction}
        state={state}
        values={values}
        primaryDefault={primaryDefault}
        onCancel={() => onOpenChange(false)}
      />
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

const PURPOSE_ROWS: { key: PurposeKey; name: "isVisitAddress" | "isInvoiceAddress" | "isDeliveryAddress"; label: string }[] = [
  { key: "visit", name: "isVisitAddress", label: "Visit address" },
  { key: "invoice", name: "isInvoiceAddress", label: "Invoice address" },
  { key: "delivery", name: "isDeliveryAddress", label: "Delivery address" },
];

/**
 * The actual `<form>` (address/purpose/notes fields), plus — since issue #52
 * — the nested "+ New contact" `ContactFormDialog`, rendered as a SIBLING of
 * `<form>` rather than inside it.
 *
 * That sibling placement is load-bearing, not a style choice: `<form>` can
 * never contain another `<form>` as a descendant (invalid HTML; React
 * detects it and the inner form's own submit stops working correctly —
 * confirmed by hand while building this, the inner "Add contact" button
 * silently failed to save anything with React logging "In HTML, <form>
 * cannot be a descendant of <form>"). `ContactFormDialog` renders its own
 * `<form>`, so it must live outside this one's `<form>` element — both are
 * still children of the same outer `<Dialog>`'s wrapper `<div>`, which is
 * all that's needed for it to render visually stacked on top.
 *
 * This is also why the purpose-checkbox/contact-select state (previously a
 * separate `SitePurposeFields` component) now lives here instead: whichever
 * component renders `<ContactFormDialog>` needs that state anyway (to know
 * which purpose's contact just got created), and it needs to be exactly this
 * component — a child of `<Dialog>` that fully unmounts/remounts on every
 * open/close transition (`Dialog` itself returns `null` while `open` is
 * false) — not `SiteFormDialog` itself, which stays mounted across opens
 * (only `Dialog`'s children remount). A plain `useState` lazy initializer
 * here behaves exactly like the rest of this form's `defaultValue`/
 * `defaultChecked` props: fresh per `site` on every reopen, no state left
 * over from editing a *different* site the last time this dialog happened
 * to be open.
 */
function SiteFormBody({
  isEdit,
  forcePurpose,
  primaryLocked,
  clientId,
  site,
  contacts,
  contactRoles,
  formAction,
  state,
  values,
  primaryDefault,
  onCancel,
}: {
  isEdit: boolean;
  forcePurpose: boolean;
  primaryLocked: boolean;
  clientId: string;
  site: SiteRecord | null | undefined;
  contacts: ContactRecord[];
  contactRoles: ReferenceListItemRecord[];
  formAction: (formData: FormData) => void;
  state: SiteFormState;
  values: SiteFormValues | undefined;
  primaryDefault: () => boolean;
  onCancel: () => void;
}) {
  const [checkedByPurpose, setCheckedByPurpose] = useState<Record<PurposeKey, boolean>>(() => ({
    visit: purposeChecked(forcePurpose, isEdit, values?.isVisitAddress, site?.is_visit_address),
    invoice: purposeChecked(forcePurpose, isEdit, values?.isInvoiceAddress, site?.is_invoice_address),
    delivery: purposeChecked(forcePurpose, isEdit, values?.isDeliveryAddress, site?.is_delivery_address),
  }));
  const [ticks, setTicks] = useState<Set<string>>(() => {
    // Pristine create (never submitted yet) gets the issue #55 default.
    if (!isEdit && !values) return new Set(defaultTicks(contacts));
    if (values?.contactTicks) return new Set(values.contactTicks);
    return new Set((site?.contact_roles ?? []).map((entry) => tickKey(entry.contact_id, entry.role)));
  });
  // Contacts created THIS dialog session via "+ New contact" — merged into
  // `contacts` for every purpose's `<select>`, not just the one it was
  // created for (the same person can plausibly end up as e.g. both the
  // invoice and delivery contact). Needed because `contacts` itself is a
  // server-fetched prop that won't include a contact created moments ago
  // without a `router.refresh()` — which this flow deliberately avoids
  // mid-form; see `ContactFormDialog`'s `onCreated` doc comment.
  const [addedContacts, setAddedContacts] = useState<ContactRecord[]>([]);
  const [newContactOpen, setNewContactOpen] = useState(false);
  // Controlled (not `defaultChecked`) so the prominent "Primary address" card
  // below can show a live `Badge` preview as the checkbox is toggled — same
  // "Primary" badge language `sites-panel.tsx`'s table and the client hero
  // already use elsewhere, echoed live here rather than only after saving.
  const [primaryChecked, setPrimaryChecked] = useState(primaryDefault);

  const allContacts = useMemo(() => {
    const byId = new Map<string, ContactRecord>();
    for (const contact of contacts) byId.set(contact.id, contact);
    for (const contact of addedContacts) byId.set(contact.id, contact);
    return sortContacts(Array.from(byId.values()));
  }, [contacts, addedContacts]);

  const roleById = useMemo(() => new Map(contactRoles.map((item) => [item.id, item])), [contactRoles]);

  function handleContactCreated(contact: ContactRecord) {
    setNewContactOpen(false);
    setAddedContacts((prev) => [...prev, contact]);
  }

  function toggleTick(key: string, checked: boolean) {
    setTicks((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  return (
    <>
      <form action={formAction}>
        {!isEdit && <input type="hidden" name="clientId" value={clientId} />}
        <Dialog.Body>
          <Stack gap="md">
            {state.error && <Text tone="danger">{state.error}</Text>}

            {/* Purely address fields now (issue #42 dropped the site's own
                free-text `name` — a "site", in this domain, IS an address,
                with nothing else to name), so this section is titled
                "Address" rather than the previous "Site" — there's no longer
                a meaningful site-vs-address distinction to hold a separate
                "Site" label over. Postal/city/country share one 3-column row
                (the panel is wide enough) instead of a 2-col grid plus a
                full-width country row underneath it. */}
            <FormSection title="Address" icon={<Building2 />}>
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
              <FormGrid columns={3}>
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
                <FormField
                  label="Country"
                  name="country"
                  defaultValue={textDefault(values?.country, site?.country)}
                  errors={state.fieldErrors?.country}
                />
              </FormGrid>
              <FormField
                label="Phone"
                name="phone"
                defaultValue={textDefault(values?.phone, site?.phone)}
                errors={state.fieldErrors?.phone}
              />
            </FormSection>

            {/* Purpose, then Notes stacked directly beneath it (not side by
                side — the panel's extra width used to invite a 2-col split,
                but Purpose grew a right-hand contact-picker column of its
                own, at which point a *second* side-by-side column for Notes
                stopped reading as related content and just competed for
                attention). Direct FormSection siblings now (no wrapping
                `div`s), which is what lets `.ui-form-section +
                .ui-form-section`'s stacked-sections top divider apply — the
                right call for a genuinely stacked pair, unlike the
                side-by-side layout that divider used to be suppressed for. */}
            <FormSection
              title="Purpose"
              description={
                forcePurpose
                  ? "This client's first site — always the visit, invoice, and delivery address, and the primary address."
                  : "Select what this address is used for."
              }
            >
              {/* Primary address — pulled out of the purpose checkbox list
                  and given its own accent-tinted card so it reads as the
                  standout flag it is, rather than a fourth plain checkbox
                  blending in with Visit/Invoice/Delivery. The live `Badge`
                  mirrors the same "Primary" badge `sites-panel.tsx`'s table
                  and the client hero already show once saved — seeing it
                  here as you check the box is the same fact, just earlier. */}
              <Card tone="accent">
                <Inline justify="between" align="center">
                  <Inline gap="sm" align="center">
                    <Checkbox
                      id="site-is-primary"
                      name="isPrimary"
                      checked={primaryChecked}
                      onChange={(event) => setPrimaryChecked(event.target.checked)}
                      disabled={primaryLocked}
                    />
                    <Label htmlFor="site-is-primary">Primary address for this client</Label>
                  </Inline>
                  {primaryChecked && <Badge variant="accent">Primary</Badge>}
                </Inline>
                {state.fieldErrors?.isPrimary?.map((message) => (
                  <Text key={message} tone="danger">
                    {message}
                  </Text>
                ))}
              </Card>

              <Stack gap="sm">
                <Text tone="muted">Address is suitable for</Text>
                {forcePurpose ? (
                  <Stack gap="xs">
                    {PURPOSE_ROWS.map((row) => (
                      <Inline key={row.key} gap="sm" align="center">
                        <Checkbox id={`site-is-${row.key}-address`} name={row.name} defaultChecked disabled />
                        <Label htmlFor={`site-is-${row.key}-address`}>{row.label}</Label>
                      </Inline>
                    ))}
                  </Stack>
                ) : (
                  <Stack gap="xs">
                    {PURPOSE_ROWS.map((row) => (
                      <Inline key={row.key} gap="sm" align="center">
                        <Checkbox
                          id={`site-is-${row.key}-address`}
                          name={row.name}
                          checked={checkedByPurpose[row.key]}
                          onChange={(event) =>
                            setCheckedByPurpose((prev) => ({ ...prev, [row.key]: event.target.checked }))
                          }
                        />
                        <Label htmlFor={`site-is-${row.key}-address`}>{row.label}</Label>
                      </Inline>
                    ))}
                  </Stack>
                )}
                {state.fieldErrors?.isVisitAddress?.map((message) => (
                  <Text key={message} tone="danger">
                    {message}
                  </Text>
                ))}
              </Stack>
            </FormSection>

            <FormSection title="Contacts" icon={<Users />}>
              <ContactMatrix
                contacts={allContacts}
                roleById={roleById}
                ticks={ticks}
                onToggle={toggleTick}
                fieldErrors={state.fieldErrors}
                onAddContact={() => setNewContactOpen(true)}
              />
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
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <SubmitButton isEdit={isEdit} />
        </Dialog.Footer>
      </form>

      {!forcePurpose && (
        <ContactFormDialog
          open={newContactOpen}
          onOpenChange={setNewContactOpen}
          clientId={clientId}
          contactRoles={contactRoles}
          onCreated={handleContactCreated}
        />
      )}
    </>
  );
}

/** Contact matrix (issue #273): rows = the client's contacts, columns = Visit /
 * Delivery / Invoice / Work receipt. Invoice and Work receipt need an e-mail
 * address, so those cells are disabled (reason in title + aria-label) for a
 * contact without one. Ticked cells submit as repeated "contactTicks" values. */
function ContactMatrix({
  contacts,
  roleById,
  ticks,
  onToggle,
  fieldErrors,
  onAddContact,
}: {
  contacts: ContactRecord[];
  roleById: Map<string, ReferenceListItemRecord>;
  ticks: Set<string>;
  onToggle: (key: string, checked: boolean) => void;
  fieldErrors: Record<string, string[] | undefined> | undefined;
  onAddContact: () => void;
}) {
  const errors = MATRIX_COLUMNS.flatMap((column) =>
    (fieldErrors?.[`contactRoles.${column.role}`] ?? []).map((message) => ({ key: `${column.role}-${message}`, message })),
  );
  return (
    <Stack gap="sm">
      {contacts.length === 0 ? (
        <Text tone="muted">No contacts yet. Add one in the Contacts tab, or here.</Text>
      ) : (
        <Table>
          <Table.Head>
            <Table.Row>
              <Table.HeaderCell>Contact</Table.HeaderCell>
              {MATRIX_COLUMNS.map((column) => (
                <Table.HeaderCell key={column.role} align="center">
                  {column.label}
                </Table.HeaderCell>
              ))}
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {contacts.map((contact) => {
              const role = contact.role_item_id ? roleById.get(contact.role_item_id)?.label : undefined;
              const hasEmail = Boolean(contact.email?.trim());
              return (
                <Table.Row key={contact.id}>
                  <Table.Cell>
                    <Stack gap="xs">
                      <Text>
                        {contact.name}
                        {role ? ` · ${role}` : ""}
                      </Text>
                      <Text tone="muted">{contact.email || "No e-mail"}</Text>
                    </Stack>
                  </Table.Cell>
                  {MATRIX_COLUMNS.map((column) => {
                    const key = tickKey(contact.id, column.role);
                    const blocked = column.needsEmail && !hasEmail;
                    const reason = `${contact.name} has no e-mail address, so ${column.label} is not available`;
                    return (
                      <Table.Cell key={column.role} align="center">
                        <Checkbox
                          name="contactTicks"
                          value={key}
                          checked={!blocked && ticks.has(key)}
                          disabled={blocked}
                          title={blocked ? reason : undefined}
                          aria-label={blocked ? reason : `${column.label}: ${contact.name}`}
                          onChange={(event) => onToggle(key, event.target.checked)}
                        />
                      </Table.Cell>
                    );
                  })}
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table>
      )}
      {errors.map((error) => (
        <Text key={error.key} tone="danger">
          {error.message}
        </Text>
      ))}
      <Button variant="link" size="sm" onClick={onAddContact}>
        <Inline gap="xs" align="center">
          <Plus width={14} height={14} />
          New contact
        </Inline>
      </Button>
    </Stack>
  );
}
