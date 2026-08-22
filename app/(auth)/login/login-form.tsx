"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Input, Label, Stack, Text } from "@yourorg/ui";
import { logInAction, type AuthActionState } from "@/lib/auth/actions";

const initialState: AuthActionState = {};

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState(logInAction, initialState);

  return (
    <form action={formAction}>
      <Stack gap="md">
        <input type="hidden" name="next" value={next ?? ""} />

        <Stack gap="sm">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Stack>

        <Stack gap="sm">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
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
    <Button type="submit" disabled={pending}>
      {pending ? "Logging in…" : "Log in"}
    </Button>
  );
}
