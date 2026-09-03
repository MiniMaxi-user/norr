"use client";

import { useEffect, useState } from "react";
import { FormGrid, Input, Label, SectionHeader, Stack, Text } from "@yourorg/ui";
import { Phone } from "@yourorg/ui/icons";
import type { ActivityDraft } from "./activity-draft";

export interface ActivityContactSectionProps {
  mode: "create" | "edit";
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
 * `ActivityScreen` already makes a local-only draft merge until create) —
 * EXCEPT that in `mode: "create"` each field's own `onChange` also commits
 * immediately (see `handleFieldChange` below), the same "no separate Save
 * button" pattern `ActivityTypeSection`/`ActivityAssignmentSection`'s
 * description field use for create-time fields. Name/Phone are conditionally
 * required server-side for a "Bel activiteit" activity (`schema.ts`'s own
 * comment) but never re-checked client-side here — deferring their commit to
 * blur alone risked the exact same "typed it, but the draft the Create
 * button reads is still stale" gap `ActivityAssignmentSection`'s description
 * field had (issue: description required error despite text visibly typed).
 * `mode: "edit"` keeps the blur-only commit (a real `updateActivity` network
 * call there — one write per edit visit, not one per keystroke).
 */
export function ActivityContactSection({ mode, draft, readOnly, onSave }: ActivityContactSectionProps) {
  const [name, setName] = useState(draft.contactName);
  const [phone, setPhone] = useState(draft.contactPhone);
  const [email, setEmail] = useState(draft.contactEmail);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(draft.contactName);
    setPhone(draft.contactPhone);
    setEmail(draft.contactEmail);
  }, [draft.contactName, draft.contactPhone, draft.contactEmail]);

  async function commitContact(next: { name: string; phone: string; email: string }) {
    setError(null);
    const result = await onSave({ contactName: next.name, contactPhone: next.phone, contactEmail: next.email });
    if (!result.ok) {
      setError(result.error ?? "Could not save the contact person.");
    }
  }

  function handleFieldChange(next: { name: string; phone: string; email: string }) {
    setName(next.name);
    setPhone(next.phone);
    setEmail(next.email);
    if (mode === "create") void commitContact(next);
  }

  async function handleBlur() {
    if (readOnly || mode === "create") return;
    if (name === draft.contactName && phone === draft.contactPhone && email === draft.contactEmail) return;
    await commitContact({ name, phone, email });
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
            onChange={(event) => handleFieldChange({ name: event.target.value, phone, email })}
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
            onChange={(event) => handleFieldChange({ name, phone: event.target.value, email })}
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
            onChange={(event) => handleFieldChange({ name, phone, email: event.target.value })}
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
