"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Checkbox, Inline, Input, Label, Stack, Text } from "@yourorg/ui";
import { logInAction, type AuthActionState } from "@/lib/auth/actions";

const initialState: AuthActionState = {};

// Client-only convenience: remembers the typed e-mail address (never the
// password) across visits so a returning user doesn't have to retype it.
// Purely a `localStorage` prefill — no server/session semantics attached.
const REMEMBERED_EMAIL_KEY = "norr:rememberedEmail";

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState(logInAction, initialState);
  const [email, setEmail] = useState("");
  const [rememberEmail, setRememberEmail] = useState(false);

  // Read on mount only — `localStorage` doesn't exist during SSR.
  useEffect(() => {
    const stored = window.localStorage.getItem(REMEMBERED_EMAIL_KEY);
    if (stored) {
      setEmail(stored);
      setRememberEmail(true);
    }
  }, []);

  function handleSubmit() {
    if (rememberEmail) {
      window.localStorage.setItem(REMEMBERED_EMAIL_KEY, email);
    } else {
      window.localStorage.removeItem(REMEMBERED_EMAIL_KEY);
    }
  }

  return (
    <form action={formAction} onSubmit={handleSubmit}>
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
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Stack>

        <Stack gap="sm">
          <Inline justify="between" align="center">
            <Label htmlFor="password">Wachtwoord</Label>
            {/* No password-reset flow exists yet (lib/auth/actions.ts) —
                kept visually present but inert per the product owner's
                explicit note that non-functional chrome is fine for now.
                Excluded from the Tab sequence (issue #111): reachable by
                mouse/pointer only, so Tab goes straight from e-mail to
                password. */}
            <Button type="button" variant="link" size="sm" tabIndex={-1}>
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

        {/* Remembers only the e-mail address in localStorage (see
            REMEMBERED_EMAIL_KEY above) — never the password, and no
            persistent-session behavior. Also excluded from the Tab
            sequence (issue #111), same reasoning as the link above. */}
        <Inline gap="sm" align="center">
          <Checkbox
            id="remember-email"
            name="rememberEmail"
            tabIndex={-1}
            checked={rememberEmail}
            onChange={(event) => setRememberEmail(event.target.checked)}
          />
          <Label htmlFor="remember-email">Onthoud mijn gegevens</Label>
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
