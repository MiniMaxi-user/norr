"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Input, Label, Stack, Text } from "@yourorg/ui";
import { signUpAction, type AuthActionState } from "@/lib/auth/actions";

const initialState: AuthActionState = {};

export function SignUpForm({
  inviteToken,
  defaultEmail,
}: {
  inviteToken?: string;
  defaultEmail?: string;
}) {
  const [state, formAction] = useActionState(signUpAction, initialState);

  return (
    <form action={formAction}>
      <Stack gap="md">
        {inviteToken && <input type="hidden" name="inviteToken" value={inviteToken} />}

        <Stack gap="sm">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={defaultEmail}
            // An invite already names the email it was sent to — don't let
            // signing up under a different address silently desync from
            // the invite (redeem_invite would reject it server-side anyway,
            // but this avoids the confusing round trip).
            readOnly={Boolean(inviteToken && defaultEmail)}
          />
        </Stack>

        <Stack gap="sm">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
          />
        </Stack>

        {!inviteToken && (
          <Stack gap="sm">
            <Label htmlFor="organizationName">Organization name</Label>
            <Input id="organizationName" name="organizationName" type="text" required />
          </Stack>
        )}

        {state.error && <Text tone="danger">{state.error}</Text>}
        {state.info && <Text tone="success">{state.info}</Text>}

        <SubmitButton />
      </Stack>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Creating account…" : "Create account"}
    </Button>
  );
}
