"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Stack, Text } from "@yourorg/ui";
import { redeemInviteAction, type AuthActionState } from "@/lib/auth/actions";

const initialState: AuthActionState = {};

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, formAction] = useActionState(redeemInviteAction, initialState);

  return (
    <form action={formAction}>
      <Stack gap="md">
        <input type="hidden" name="token" value={token} />
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
      {pending ? "Joining…" : "Accept invite"}
    </Button>
  );
}
