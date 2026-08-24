import type { ReactNode } from "react";
import { Stack } from "@yourorg/ui";

// Auth pages (login, signup, invite acceptance) render without the
// authenticated app chrome (sidebar/topbar) — see the comment in
// app/(app)/layout.tsx. This is a plain nested layout under the root
// app/layout.tsx (which already provides <html>/<body>/ThemeProvider), so
// it only needs to arrange its own children.
//
// Deliberately thin: `/login` now owns a full-bleed split-screen shell of
// its own (`AuthSplitLayout`, packages/ui) that must fill the viewport, not
// get padded/centered by a shared wrapper here — this `<Stack>` is a no-op
// around it (a single-child flex column has no visible effect). Signup and
// invite-accept still render their own simple `<Stack gap="lg">` content
// directly (see their page.tsx files) since they haven't had the same visual
// pass yet; giving this route group's layout a real centered/max-width
// treatment for THEM is follow-up frontend-ui-engineer work, not done here.
export default function AuthRouteLayout({ children }: { children: ReactNode }) {
  return <Stack gap="lg">{children}</Stack>;
}
