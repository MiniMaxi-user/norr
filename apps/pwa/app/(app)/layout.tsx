import type { ReactNode } from "react";
import { requireEngineerSession } from "@/lib/auth/session";

/**
 * Protected route group for the monteur-app (issue #168). Gates every route
 * under it on `requireEngineerSession()` — signed-out or non-`engineer`
 * roles are redirected to `/login` there.
 *
 * No nav chrome yet (sidebar/topbar) — that's later work once there's more
 * than one screen (`/workitems` is the only route today).
 */
export default async function AppRouteLayout({ children }: { children: ReactNode }) {
  await requireEngineerSession();
  return children;
}
