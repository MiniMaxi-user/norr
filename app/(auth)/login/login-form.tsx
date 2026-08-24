"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Checkbox, Inline, Input, Label, Stack, Text } from "@yourorg/ui";
import { logInAction, type AuthActionState } from "@/lib/auth/actions";

const initialState: AuthActionState = {};

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState(logInAction, initialState);

  return (
    <form action={formAction}>
      <Stack gap="md">
        <input type="hidden" name="next" value={next ?? ""} />

        <Stack gap="sm">
          <Label htmlFor="email">E-mailadres</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="jij@bedrijf.nl"
            autoComplete="email"
            required
          />
        </Stack>

        <Stack gap="sm">
          <Inline justify="between" align="center">
            <Label htmlFor="password">Wachtwoord</Label>
            {/* No password-reset flow exists yet (lib/auth/actions.ts) —
                kept visually present but inert per the product owner's
                explicit note that non-functional chrome is fine for now. */}
            <Button type="button" variant="link" size="sm">
              Wachtwoord vergeten?
            </Button>
          </Inline>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />
        </Stack>

        {/* "Remember this device" has no persistence behind it yet — the
            checkbox posts as part of the form but logInAction doesn't read
            it. Kept visually present per the product owner's note. */}
        <Inline gap="sm" align="center">
          <Checkbox id="remember" name="remember" defaultChecked />
          <Label htmlFor="remember">Onthoud dit apparaat</Label>
        </Inline>

        {state.error && <Text tone="danger">{state.error}</Text>}

        <SubmitButton />
      </Stack>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" fullWidth disabled={pending}>
      {pending ? "Inloggen…" : "Inloggen"}
    </Button>
  );
}
