import type { ReactNode } from "react";
import { Stack } from "@yourorg/ui";

// Auth pages (login, signup, invite acceptance) render without the
// authenticated app chrome (sidebar/topbar) — see the comment in
// app/(app)/layout.tsx. This is a plain nested layout under the root
// app/layout.tsx (which already provides <html>/<body>/ThemeProvider), so
// it only needs to arrange its own children.
//
// Deliberately minimal: no page-centering/max-width container, because the
// current @yourorg/ui stub (vendor/yourorg-ui-stub) has no such layout
// primitive and CLAUDE.md rule 4 forbids ad-hoc CSS in this repo to fake
// one. Real visual polish for these pages is frontend-ui-engineer /
// design-system territory once the real package ships.
export default function AuthRouteLayout({ children }: { children: ReactNode }) {
  return <Stack gap="lg">{children}</Stack>;
}
