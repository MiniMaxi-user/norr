import { PwaLoginLayout } from "@yourorg/ui";
import { PwaStack } from "@yourorg/ui/web";
import { LoginForm } from "./login-form";

/**
 * Mobile-first single-column login screen (issue #168). Deliberately NOT
 * root's `AuthSplitLayout` (a desktop split-screen-with-illustration shell)
 * — wrong shape for an installed phone PWA. `PwaLoginLayout` puts the wordmark on a
 * navy brand band (same navy as the app bar) above a light form area with
 * field-readable type (product feedback, 2026-10-10: bigger logo, bigger
 * text; restyled issue #222).
 *
 * No SSO button / "forgot password" link / "remember email" checkbox —
 * those were explicit product-owner requests for the web app
 * (`app/(auth)/login/page.tsx`), not asked for here.
 */
export default function LoginPage() {
  return (
    <PwaLoginLayout>
      <PwaStack>
        <PwaStack gap="sm">
          <h1 className="pwa-login-title">Welcome back</h1>
          <p className="pwa-login-intro">Log in to view today&apos;s work orders.</p>
        </PwaStack>

        <LoginForm />
      </PwaStack>
    </PwaLoginLayout>
  );
}
