import Link from "next/link";
import { Card, Heading, Text, Stack } from "@yourorg/ui";
import { SignUpForm } from "./signup-form";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ inviteToken?: string; email?: string }>;
}) {
  const { inviteToken, email } = await searchParams;

  return (
    <Stack gap="lg">
      <Stack gap="sm">
        <Heading level={1}>Create your account</Heading>
        <Text tone="muted">
          {inviteToken
            ? "Create an account to accept your invitation."
            : "This creates a new organization with you as its owner."}
        </Text>
      </Stack>

      <Card>
        <SignUpForm inviteToken={inviteToken} defaultEmail={email} />
      </Card>

      <Text tone="muted">
        Already have an account? <Link href="/login">Log in</Link>.
      </Text>
    </Stack>
  );
}
