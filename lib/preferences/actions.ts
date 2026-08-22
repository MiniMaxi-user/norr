"use server";

import { preferencesStore } from "./cookie-store";

// TODO(auth-rbac-engineer): resolve the signed-in user id from the session
// (see lib/supabase/server.ts) and pass it through instead of `null` once
// auth lands. Preferences are stored per-browser (via cookie) until then.
export async function setSidebarCollapsed(collapsed: boolean): Promise<void> {
  await preferencesStore.setSidebarCollapsed(null, collapsed);
}

export async function setLastUsedView(moduleKey: string, view: string): Promise<void> {
  await preferencesStore.setLastUsedView(null, moduleKey, view);
}
