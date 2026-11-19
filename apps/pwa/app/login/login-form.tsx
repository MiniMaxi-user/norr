"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Input, Label } from "@yourorg/ui";
import { PwaNote, WebButton } from "@yourorg/ui/web";
import { logInAction, type AuthActionState } from "@/lib/auth/actions";

const initialState: AuthActionState = {};

/**
 * Login form for the engineer app (issue #168). Deliberately minimal
 * compared to the root web app's `LoginForm`
 * (`app/(auth)/login/login-form.tsx`): no SSO button, no "forgot password"
 * link, no "remember email" checkbox — those were explicit product-owner
 * requests for the web app only.
 */
export function LoginForm() {
  const [state, formAction] = useActionState(logInAction, initialState);

  return (
    <form action={formAction} className="pwa-login-form">
      <div className="pwa-field">
        <Label htmlFor="email">Email address</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="you@company.com"
          autoComplete="email"
          required
        />
      </div>

      <div className="pwa-field">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          placeholder="••••••••"
          autoComplete="current-password"
          required
        />
      </div>

      {state.error && <PwaNote tone="danger">{state.error}</PwaNote>}

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <WebButton type="submit" variant="primary" size="touch" block disabled={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </WebButton>
  );
}
