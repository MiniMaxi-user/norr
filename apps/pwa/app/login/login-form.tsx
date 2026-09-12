"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Input, Label, Stack, Text } from "@yourorg/ui";
import { logInAction, type AuthActionState } from "@/lib/auth/actions";

const initialState: AuthActionState = {};

/**
 * Login form for the monteur-app (issue #168). Deliberately minimal
 * compared to the root web app's `LoginForm`
 * (`app/(auth)/login/login-form.tsx`): no SSO button, no "forgot password"
 * link, no "remember email" checkbox — those were explicit product-owner
 * requests for the web app only.
 */
export function LoginForm() {
  const [state, formAction] = useActionState(logInAction, initialState);

  return (
    <form action={formAction}>
      <Stack gap="md">
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
          <Label htmlFor="password">Wachtwoord</Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />
        </Stack>

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
