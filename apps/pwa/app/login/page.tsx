import { Heading, PwaLoginLayout, Stack, Text } from "@yourorg/ui";
import { LoginForm } from "./login-form";

/**
 * Mobile-first single-column login screen (issue #168). Deliberately NOT
 * root's `AuthSplitLayout` (a desktop split-screen-with-illustration shell)
 * — wrong shape for an installed phone PWA. `PwaLoginLayout` centers a large
 * wordmark above a single card with field-readable type (product feedback,
 * 2026-10-10: bigger logo, bigger text).
 *
 * No SSO button / "forgot password" link / "remember email" checkbox —
 * those were explicit product-owner requests for the web app
 * (`app/(auth)/login/page.tsx`), not asked for here.
 */
export default function LoginPage() {
  return (
    <PwaLoginLayout>
      <Stack gap="lg">
        <Stack gap="xs">
          <Heading level={1}>Welcome back</Heading>
          <Text tone="muted">Log in to view today&apos;s work orders.</Text>
        </Stack>

        <LoginForm />
      </Stack>
    </PwaLoginLayout>
  );
}
