"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Button, Card, CompanyLogo, DefinitionList, Heading, Label, Select, Stack, Text } from "@yourorg/ui";
import { Building2 } from "@yourorg/ui/icons";
import {
  updateOrganizationOwnClient,
  type OrganizationOwnClientSettings,
} from "../company-actions";

export interface OrganizationCompanyFormProps {
  initial: OrganizationOwnClientSettings;
  /** `listClientsForOwnClientSelect()`'s result — every client in the org,
   * for the "own Client" `<Select>` below. */
  clients: { id: string; name: string }[];
  /** `can(actor, "settings", "update")` — owner-only, matching
   * `updateOrganizationOwnClient`'s own gate. A non-owner never sees the
   * `<Select>`, only the read-only preview — same "hide, don't just
   * disable" pattern `OrganizationDefaultRateForm` already uses. */
  canWrite: boolean;
}

interface FormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
  saved?: OrganizationOwnClientSettings;
}

const initialState: FormState = {};

/**
 * Org-level "own Client" picker (issue #120) — which of the tenant's own
 * `clients` rows represents the organization itself. Modeled directly on
 * `OrganizationDefaultRateForm` (same `useActionState`/`useFormStatus`
 * shape, same owner-only `<Select>` vs. everyone-else-gets-a-summary split).
 *
 * Per docs/ARCHITECTURE.md's "Relational detail pages" convention, this does
 * NOT duplicate an editable copy of the chosen client's own business fields
 * (name/KvK/VAT/IBAN/logo) here — the read-only preview below links out to
 * that client's own detail page (`/clients/{id}`) for actually editing them,
 * including uploading its logo (issue #120's `ClientLogoUploader`).
 */
export function OrganizationCompanyForm({ initial, clients, canWrite }: OrganizationCompanyFormProps) {
  const [ownClientId, setOwnClientId] = useState(initial.ownClientId ?? "");
  const [preview, setPreview] = useState(initial.ownClient);

  async function action(_prevState: FormState, formData: FormData): Promise<FormState> {
    const input = {
      ownClientId: (formData.get("ownClientId") as string) || null,
    };
    const result = await updateOrganizationOwnClient(input);
    if (result.error || !result.data) {
      return { error: result.error ?? "Could not save the organization's own client.", fieldErrors: result.fieldErrors };
    }
    return { success: true, saved: result.data };
  }

  const [state, formAction] = useActionState(action, initialState);

  useEffect(() => {
    if (state.success && state.saved) {
      setOwnClientId(state.saved.ownClientId ?? "");
      setPreview(state.saved.ownClient);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  if (!canWrite) {
    return (
      <Card>
        <Stack gap="md">
          <OwnClientPreview client={initial.ownClient} />
          <Text tone="muted">Only the organization owner can change this selection.</Text>
        </Stack>
      </Card>
    );
  }

  return (
    <Card>
      <form action={formAction}>
        <Stack gap="lg">
          {state.error && <Text tone="danger">{state.error}</Text>}
          {state.success && <Text tone="success">Company settings saved.</Text>}

          <Stack gap="xs">
            <Label htmlFor="own-client-select">Own client</Label>
            <Select
              id="own-client-select"
              name="ownClientId"
              value={ownClientId}
              onChange={(event) => setOwnClientId(event.target.value)}
            >
              <option value="">Not set</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </Select>
            {state.fieldErrors?.ownClientId?.map((message) => (
              <Text key={message} tone="danger">
                {message}
              </Text>
            ))}
          </Stack>

          <OwnClientPreview client={preview} />

          <div>
            <SubmitButton />
          </div>
        </Stack>
      </form>
    </Card>
  );
}

function OwnClientPreview({ client }: { client: OrganizationOwnClientSettings["ownClient"] }) {
  if (!client) {
    return <Text tone="muted">No client selected yet — pick one above to preview its business details here.</Text>;
  }

  return (
    <Stack gap="sm">
      <Heading level={6}>
        <Link href={`/clients/${client.id}`}>{client.name}</Link>
      </Heading>
      <Stack gap="sm">
        <CompanyLogo logoUrl={client.logoUrl} alt={`${client.name} logo`} fallback={<Building2 />} />
        <DefinitionList
          items={[
            { label: "KvK", value: client.kvkNumber || <Text tone="muted">—</Text> },
            { label: "VAT", value: client.vatNumber || <Text tone="muted">—</Text> },
            { label: "IBAN", value: client.iban || <Text tone="muted">—</Text> },
          ]}
        />
      </Stack>
      <Text tone="muted">
        Edit these details, including the logo, on <Link href={`/clients/${client.id}`}>{client.name}</Link>&rsquo;s
        own client page.
      </Text>
    </Stack>
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
