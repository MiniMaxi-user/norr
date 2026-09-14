import {
  AuthSplitLayout,
  Button,
  Heading,
  Inline,
  Logo,
  Logomark,
  NordicScene,
  Separator,
  Stack,
  Text,
} from "@yourorg/ui";
import { ShieldCheck } from "@yourorg/ui/icons";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <AuthSplitLayout>
      <AuthSplitLayout.Panel>
        <Logo />

        <AuthSplitLayout.FormArea>
          <Stack gap="lg">
            <Stack gap="xs">
              <Heading level={1}>Welcome back</Heading>
              <Text tone="muted">Log in to manage your planning and teams.</Text>
            </Stack>

            <LoginForm next={next} />

            <Stack gap="lg">
              <Inline gap="sm" align="center">
                <Separator />
                <Text tone="muted">or</Text>
                <Separator />
              </Inline>

              {/* No SSO provider is configured yet (lib/auth/actions.ts) —
                  kept visually present but inert per the product owner's
                  explicit note that non-functional chrome is fine for now. */}
              <Button type="button" variant="outline" fullWidth>
                <ShieldCheck aria-hidden /> Continue with SSO
              </Button>
            </Stack>
          </Stack>
        </AuthSplitLayout.FormArea>

        <Inline gap="xs" align="center">
          <ShieldCheck aria-hidden />
          <Text tone="muted">Secured with enterprise-grade encryption</Text>
        </Inline>
      </AuthSplitLayout.Panel>

      <AuthSplitLayout.Illustration
        cornerMark={<Logomark />}
        tagline="We give direction."
        description="From first activity to last mile — norr steers every team in the field the right way."
      >
        <NordicScene />
      </AuthSplitLayout.Illustration>
    </AuthSplitLayout>
  );
}
