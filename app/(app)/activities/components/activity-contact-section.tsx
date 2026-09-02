"use client";

import { useEffect, useState } from "react";
import { FormGrid, Input, Label, SectionHeader, Stack, Text } from "@yourorg/ui";
import { Phone } from "@yourorg/ui/icons";
import type { ActivityDraft } from "./activity-draft";

export interface ActivityContactSectionProps {
  draft: Pick<ActivityDraft, "contactName" | "contactPhone" | "contactEmail">;
  readOnly?: boolean;
  onSave: (
    patch: Pick<ActivityDraft, "contactName" | "contactPhone" | "contactEmail">,
  ) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * "Contact person" section (`.design-handoff/melding_detail/README.md`) —
 * the Name/Phone/Email override fields that used to live inside
 * `ActivityRelationsDialog` (see that component's own doc comment for why
 * they moved here), now directly inline on the page. Controlled `Input`s
 * (NOT `FormField`, which is built for an uncontrolled `defaultValue` + a
 * `name` for a `<form action>` submit — a poor fit for this on-blur-save
 * shape) that save all three fields together on whichever one's blur fires
 * first, reading the current local state of every field — no debounce
 * needed, a blur only fires once per field per visit. Works fine in
 * `mode: "create"` too (routes through the same `commitPatch`, which
 * `ActivityScreen` already makes a local-only draft merge until create).
 */
export function ActivityContactSection({ draft, readOnly, onSave }: ActivityContactSectionProps) {
  const [name, setName] = useState(draft.contactName);
  const [phone, setPhone] = useState(draft.contactPhone);
  const [email, setEmail] = useState(draft.contactEmail);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(draft.contactName);
    setPhone(draft.contactPhone);
    setEmail(draft.contactEmail);
  }, [draft.contactName, draft.contactPhone, draft.contactEmail]);

  async function handleBlur() {
    if (readOnly) return;
    if (name === draft.contactName && phone === draft.contactPhone && email === draft.contactEmail) return;
    setError(null);
    const result = await onSave({ contactName: name, contactPhone: phone, contactEmail: email });
    if (!result.ok) {
      setError(result.error ?? "Could not save the contact person.");
    }
  }

  return (
    <Stack gap="md">
      <SectionHeader icon={Phone} title="Contact person" />
      {error && <Text tone="danger">{error}</Text>}
      <FormGrid columns={3}>
        <Stack gap="xs">
          <Label htmlFor="activity-contact-name">Name</Label>
          <Input
            id="activity-contact-name"
            value={name}
            disabled={readOnly}
            maxLength={200}
            onChange={(event) => setName(event.target.value)}
            onBlur={handleBlur}
          />
        </Stack>
        <Stack gap="xs">
          <Label htmlFor="activity-contact-phone">Phone</Label>
          <Input
            id="activity-contact-phone"
            value={phone}
            disabled={readOnly}
            maxLength={50}
            onChange={(event) => setPhone(event.target.value)}
            onBlur={handleBlur}
          />
        </Stack>
        <Stack gap="xs">
          <Label htmlFor="activity-contact-email">Email</Label>
          <Input
            id="activity-contact-email"
            type="email"
            value={email}
            disabled={readOnly}
            maxLength={320}
            onChange={(event) => setEmail(event.target.value)}
            onBlur={handleBlur}
          />
        </Stack>
      </FormGrid>
      <Text tone="muted" style={{ fontSize: "var(--ui-text-xs)" }}>
        Overgenomen van de contactpersoon bij de client — hier aanpassen geldt alleen voor deze melding.
      </Text>
    </Stack>
  );
}
