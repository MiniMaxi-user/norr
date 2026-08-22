"use server";

import { preferencesStore } from "./cookie-store";
import { getCurrentSession } from "@/lib/auth/session";

// Resolves the real signed-in user id (issue #3/#4) instead of the `null`
// placeholder the shell scaffold shipped with. `getCurrentSession()`
// returns `null` when signed out; the cookie-backed store below still
// accepts `null` there (see PreferencesStore), so this degrades gracefully
// rather than throwing — though in practice these actions are only ever
// invoked from within the authenticated app shell.
export async function setSidebarCollapsed(collapsed: boolean): Promise<void> {
  const session = await getCurrentSession();
  await preferencesStore.setSidebarCollapsed(session?.userId ?? null, collapsed);
}

export async function setLastUsedView(moduleKey: string, view: string): Promise<void> {
  const session = await getCurrentSession();
  await preferencesStore.setLastUsedView(session?.userId ?? null, moduleKey, view);
}
