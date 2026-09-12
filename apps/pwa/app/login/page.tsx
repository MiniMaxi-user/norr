import { Card, Heading, Logo, Stack, Text } from "@yourorg/ui";
import { LoginForm } from "./login-form";

/**
 * Mobile-first single-column login screen (issue #168). Deliberately NOT
 * root's `AuthSplitLayout` (a desktop split-screen-with-illustration shell)
 * — wrong shape for an installed phone PWA. Just a single `Card`: logo,
 * heading, short copy, the form — no split columns, no illustration.
 *
 * No SSO button / "forgot password" link / "remember email" checkbox —
 * those were explicit product-owner requests for the web app
 * (`app/(auth)/login/page.tsx`), not asked for here.
 */
export default function LoginPage() {
  return (
    <Stack gap="lg">
      <Card>
        <Stack gap="lg">
          <Logo />

          <Stack gap="xs">
            <Heading level={1}>Welkom terug</Heading>
            <Text tone="muted">Log in om je werkorders van vandaag te bekijken.</Text>
          </Stack>

          <LoginForm />
        </Stack>
      </Card>
    </Stack>
  );
}
