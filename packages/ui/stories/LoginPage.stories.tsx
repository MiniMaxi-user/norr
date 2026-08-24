import type { Meta, StoryObj } from "@storybook/react";
import { AuthSplitLayout } from "../src/components/auth-split-layout";
import { NordicScene } from "../src/components/nordic-scene";
import { Logo, Logomark } from "../src/components/logo";
import { Label, Input } from "../src/components/form";
import { Button } from "../src/components/button";
import { Separator } from "../src/components/separator";
import { Text } from "../src/components/typography";
import { Stack } from "../src/components/stack";

function LoginPage() {
  return (
    <AuthSplitLayout>
      <AuthSplitLayout.Panel>
        <Logo />
        <AuthSplitLayout.FormArea>
          <Stack gap="lg">
            <Stack gap="xs">
              <Text style={{ margin: 0, fontSize: "1.375rem", fontWeight: 650, color: "var(--ui-fg)" }}>Welcome back</Text>
              <Text tone="muted" style={{ margin: 0 }}>
                Sign in to your Norr workspace
              </Text>
            </Stack>
            <form onSubmit={(e) => e.preventDefault()}>
              <Stack gap="md">
                <Stack gap="xs">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" placeholder="you@company.com" autoComplete="email" />
                </Stack>
                <Stack gap="xs">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" autoComplete="current-password" />
                </Stack>
                <Button type="submit" fullWidth>
                  Sign in
                </Button>
              </Stack>
            </form>
            <Separator />
            <Text tone="muted" style={{ margin: 0, textAlign: "center" }}>
              Secured with enterprise-grade encryption
            </Text>
          </Stack>
        </AuthSplitLayout.FormArea>
      </AuthSplitLayout.Panel>
      <AuthSplitLayout.Illustration
        cornerMark={<Logomark size={22} style={{ color: "var(--ui-brand-snow)" }} />}
        tagline="Field service, given direction."
        description="Dispatch, schedule, and track every job from one workspace built for the crews doing the work."
      >
        <NordicScene />
      </AuthSplitLayout.Illustration>
    </AuthSplitLayout>
  );
}

const meta: Meta<typeof LoginPage> = {
  title: "FSM/Login",
  component: LoginPage,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof LoginPage>;

export const Default: Story = {};
