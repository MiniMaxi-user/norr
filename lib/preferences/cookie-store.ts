import "server-only";

import { cookies } from "next/headers";
import type { PreferencesStore } from "./types";
import {
  LAST_USED_VIEW_COOKIE_PREFIX,
  PREFERENCE_COOKIE_MAX_AGE,
  SIDEBAR_COLLAPSED_COOKIE,
} from "./constants";

/**
 * Phase 0 implementation of `PreferencesStore`: persists to a first-party
 * cookie instead of a real per-user backend. `userId` is intentionally
 * unused here (the cookie is already scoped to the browser/session) — it
 * exists on the interface so call sites don't change when this is swapped
 * for a Supabase-backed store keyed by user + organization.
 *
 * Cookie writes only work from Server Actions / Route Handlers (there's no
 * response to attach to from a plain Server Component render) — callers in
 * this codebase use the Server Actions in `actions.ts`.
 */
export const cookiePreferencesStore: PreferencesStore = {
  async getSidebarCollapsed() {
    const store = await cookies();
    return store.get(SIDEBAR_COLLAPSED_COOKIE)?.value === "1";
  },

  async setSidebarCollapsed(_userId, collapsed) {
    const store = await cookies();
    store.set(SIDEBAR_COLLAPSED_COOKIE, collapsed ? "1" : "0", {
      path: "/",
      maxAge: PREFERENCE_COOKIE_MAX_AGE,
      sameSite: "lax",
    });
  },

  async getLastUsedView(_userId, moduleKey) {
    const store = await cookies();
    return store.get(`${LAST_USED_VIEW_COOKIE_PREFIX}${moduleKey}`)?.value ?? null;
  },

  async setLastUsedView(_userId, moduleKey, view) {
    const store = await cookies();
    store.set(`${LAST_USED_VIEW_COOKIE_PREFIX}${moduleKey}`, view, {
      path: "/",
      maxAge: PREFERENCE_COOKIE_MAX_AGE,
      sameSite: "lax",
    });
  },
};

/**
 * Currently-active preferences store. Swap this binding (not the call
 * sites) when a real backend exists:
 *
 *   export const preferencesStore: PreferencesStore = supabasePreferencesStore;
 */
export const preferencesStore: PreferencesStore = cookiePreferencesStore;
