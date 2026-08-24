"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Button, Card, FormGrid, FormSection, Input, Label, Select, Stack, Text, Textarea } from "@yourorg/ui";
import type { QuoteRecord } from "../actions";
import { createQuoteFormAction, updateQuoteFormAction, type QuoteFormState } from "../quote-form-actions";
import { listSites, type ClientRecord, type SiteRecord } from "@/app/(app)/clients/actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";

const initialState: QuoteFormState = { ok: false };

export interface QuoteFormProps {
  mode: "create" | "edit";
  /** Required for `mode: "edit"`. */
  quote?: QuoteRecord;
  /** Org's clients, for the client -> site cascading pickers. Ignored (and
   * the picker hidden entirely) when `lockedClientId` is set. */
  clients: ClientRecord[];
  /**
   * Pre-scopes the quote to a single client and hides the client selector
   * entirely — used when this form is opened in a client-scoped context
   * (`/quotes/new?clientId=...`), where the client is already implied and
   * re-picking it makes no sense. Mirrors `ContractForm`/`WorkOrderForm`'s
   * `lockedClientId`.
   */
  lockedClientId?: string;
  /** This org's `quote_status` picklist values. */
  statuses: ReferenceListItemRecord[];
  /** Where "Cancel" navigates to. */
  cancelHref: string;
}

/**
 * Create/edit form for a quote, rendered as a real page (`/quotes/new`,
 * `/quotes/[id]/edit`) rather than a `Dialog` — per docs/ARCHITECTURE.md
 * "Popup vs. full page — pick by weight, not habit" (Quotes is a top-level
 * module entity, same tier as Clients/Assets/Work Orders/Contracts).
 *
 * Client -> Site cascade mirrors `asset-form.tsx`'s Client -> Site pattern
 * (fetch the client's sites on client change, disabled + "select a client
 * first" placeholder until the client has a value) — the exact same shape
 * `work-order-form.tsx` uses for its own Site picker, minus the further
 * Asset cascade (a quote's header has no `asset_id`; only its line items do,
 * handled separately by `QuoteLineItemDialog`).
 */
export function QuoteForm({ mode, quote, clients, lockedClientId, statuses, cancelHref }: QuoteFormProps) {
  const router = useRouter();
  const action = mode === "edit" && quote ? updateQuoteFormAction.bind(null, quote.id) : createQuoteFormAction;
  const [state, formAction] = useActionState(action, initialState);

  const [selectedClientId, setSelectedClientId] = useState(lockedClientId ?? quote?.client_id ?? "");
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [loadingSites, setLoadingSites] = useState(false);
  const [selectedSiteId, setSelectedSiteId] = useState(quote?.site_id ?? "");

  useEffect(() => {
    if (!selectedClientId) {
      setSites([]);
      return;
    }
    let cancelled = false;
    setLoadingSites(true);
    listSites(selectedClientId)
      .then((result) => {
        if (cancelled) return;
        setSites(result.data?.sites ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoadingSites(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedClientId]);

  useEffect(() => {
    if (state.ok && state.quote) {
      router.push(`/quotes/${state.quote.id}`);
    }
    // Only re-run when the action result actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok, state.quote]);

  function handleClientChange(nextClientId: string) {
    setSelectedClientId(nextClientId);
    // A new client invalidates any previously selected site — same
    // "discard the now-stale child selection" reasoning as
    // `work-order-form.tsx`'s `handleClientChange`.
    setSelectedSiteId("");
  }

  const defaultStatus = statuses.find((item) => item.is_default);

  return (
    <Card>
      <form action={formAction}>
        <Stack gap="lg">
          {state.error && <Text tone="danger">{state.error}</Text>}

          <FormSection title="Quote" description="Who this proposal is for, and what it's called.">
            <Stack gap="md">
              {!lockedClientId && (
                <Stack gap="sm">
                  <Label htmlFor="quote-client">Client</Label>
                  <Select
                    id="quote-client"
                    name="clientId"
                    value={selectedClientId}
                    onChange={(event) => handleClientChange(event.target.value)}
                    required
                  >
                    <option value="" disabled>
                      Select a client…
                    </option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </Select>
                  {state.fieldErrors?.clientId && <Text tone="danger">{state.fieldErrors.clientId[0]}</Text>}
                </Stack>
              )}
              {lockedClientId && <input type="hidden" name="clientId" value={lockedClientId} />}

              <FormGrid columns={2}>
                <Stack gap="sm">
                  <Label htmlFor="quote-site">Site</Label>
                  <Select
                    id="quote-site"
                    name="siteId"
                    value={selectedSiteId}
                    onChange={(event) => setSelectedSiteId(event.target.value)}
                    disabled={!selectedClientId || loadingSites}
                  >
                    <option value="">
                      {!selectedClientId
                        ? "Select a client first…"
                        : loadingSites
                          ? "Loading sites…"
                          : "No specific site"}
                    </option>
                    {sites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                      </option>
                    ))}
                  </Select>
                  {state.fieldErrors?.siteId && <Text tone="danger">{state.fieldErrors.siteId[0]}</Text>}
                </Stack>

                <Stack gap="sm">
                  <Label htmlFor="quote-name">Name</Label>
                  <Input id="quote-name" name="name" defaultValue={quote?.name} required maxLength={200} />
                  {state.fieldErrors?.name && <Text tone="danger">{state.fieldErrors.name[0]}</Text>}
                </Stack>
              </FormGrid>
            </Stack>
          </FormSection>

          <FormSection title="Status & validity" description="Lifecycle stage and how long this pricing stands.">
            <FormGrid columns={2}>
              <Stack gap="sm">
                <Label htmlFor="quote-status">Status</Label>
                <Select id="quote-status" name="statusId" defaultValue={quote?.status_id ?? ""}>
                  <option value="">
                    {defaultStatus ? `Use default (${defaultStatus.label})` : "Use organization default"}
                  </option>
                  {statuses.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </Select>
                {state.fieldErrors?.statusId && <Text tone="danger">{state.fieldErrors.statusId[0]}</Text>}
              </Stack>

              <Stack gap="sm">
                <Label htmlFor="quote-valid-until">Valid until</Label>
                <Input
                  id="quote-valid-until"
                  name="validUntil"
                  type="date"
                  defaultValue={quote?.valid_until ?? ""}
                />
                {state.fieldErrors?.validUntil && <Text tone="danger">{state.fieldErrors.validUntil[0]}</Text>}
              </Stack>
            </FormGrid>
          </FormSection>

          <FormSection title="Notes">
            <Stack gap="sm">
              <Label htmlFor="quote-notes">Notes</Label>
              <Textarea id="quote-notes" name="notes" defaultValue={quote?.notes ?? ""} rows={4} />
              {state.fieldErrors?.notes && <Text tone="danger">{state.fieldErrors.notes[0]}</Text>}
            </Stack>
          </FormSection>

          <div>
            <Button type="button" variant="outline" onClick={() => router.push(cancelHref)}>
              Cancel
            </Button>{" "}
            <SubmitButton mode={mode} />
          </div>
        </Stack>
      </form>
    </Card>
  );
}

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? "Saving…" : mode === "create" ? "Add quote" : "Save changes"}
    </Button>
  );
}
