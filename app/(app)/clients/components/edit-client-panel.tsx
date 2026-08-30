"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Button, Dialog, FormField, FormGrid, FormSection, FormSelectField, Heading, Label, Stack, Text, Textarea, useEscapeToClose } from "@yourorg/ui";
import { BarChart3, CreditCard, FileText, Receipt, Users } from "@yourorg/ui/icons";
import type { AccountManagerRecord } from "@/lib/account-managers/actions";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import { RateSettingsSection } from "@/lib/rate-overrides/rate-settings-section";
import { updateClient, updateClientRateSettings, type ClientRecord } from "../actions";
import { CLIENT_STATUS_OPTIONS } from "../kanban";

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
  articles,
  open,
  onOpenChange,
}: {
  client: ClientRecord;
  /** Fetched once in `clients-board.tsx`, passed down — populates the
   * "Account manager" `<Select>` below (issue #58), same as
   * `NewClientPanel`. */
  accountManagers: AccountManagerRecord[];
  /** `listArticlesForSelect()`'s result (issue #93) — populates the "Custom
   * rate" section's Travel-time/Work-time article pickers, same "fetch once,
   * pass down" convention as `accountManagers`. */
  articles: ArticleSelectOption[];
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

    // Sequential second call, same "one form, multiple Server Action calls"
    // shape `NewClientPanel` uses for `createClient` then `createSite` — see
    // this panel's own "Rate" section below and `RateSettingsSection`'s doc
    // comment for why `hasCustomRate` needs this manual boolean fix.
    const rateInput = {
      ...input,
      hasCustomRate: formData.get("hasCustomRate") === "on",
    };
    const rateResult = await updateClientRateSettings(client.id, rateInput);
    if (rateResult.error || !rateResult.data) {
      // The client's own fields already saved successfully above — same
      // partial-failure tolerance `NewClientPanel` documents for its own
      // two-call submit: keep the panel open with the rate error surfaced,
      // rather than silently discarding it or double-reporting success.
      return { error: rateResult.error ?? "The client was saved, but its rate settings could not be saved.", fieldErrors: rateResult.fieldErrors };
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
                <FormSelectField
                  label="Status"
                  name="status"
                  defaultValue={client.status}
                  errors={state.fieldErrors?.status}
                >
                  {CLIENT_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </FormSelectField>
                <FormSelectField
                  label="Account manager"
                  name="accountManagerId"
                  defaultValue={client.account_manager_id ?? ""}
                  errors={state.fieldErrors?.accountManagerId}
                >
                  <option value="">No account manager</option>
                  {accountManagers.map((manager) => (
                    <option key={manager.id} value={manager.id}>
                      {manager.first_name} {manager.last_name}
                    </option>
                  ))}
                </FormSelectField>
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

            {/* Issue #93, "Reistijd en werktijd artikelen beheren": a
                client-level Travel-time/Work-time billing override. See
                `RateSettingsSection`'s own doc comment — shared verbatim with
                the Engineer edit dialog (`EditTeamMemberDialog`). */}
            <FormSection title="Rate" icon={<Receipt />}>
              <RateSettingsSection
                idPrefix="client-rate"
                initial={{
                  hasCustomRate: client.has_custom_rate,
                  travelArticleId: client.travel_article_id,
                  workArticleId: client.work_article_id,
                  travelSalePrice: client.travel_sale_price,
                  workSalePrice: client.work_sale_price,
                }}
                articles={articles}
                subjectLabel="client"
                errors={{
                  travelArticleId: state.fieldErrors?.travelArticleId,
                  workArticleId: state.fieldErrors?.workArticleId,
                  travelSalePrice: state.fieldErrors?.travelSalePrice,
                  workSalePrice: state.fieldErrors?.workSalePrice,
                }}
              />
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
