import Link from "next/link";
import { Card, Heading, Text, Stack } from "@yourorg/ui";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <Stack gap="lg">
      <Stack gap="sm">
        <Heading level={1}>Log in</Heading>
        <Text tone="muted">Sign in to your Norr account.</Text>
      </Stack>

      <Card>
        <LoginForm next={next} />
      </Card>

      <Text tone="muted">
        No account yet? <Link href="/signup">Create one</Link>.
      </Text>
    </Stack>
  );
}
