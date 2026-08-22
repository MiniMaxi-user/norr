/**
 * Swappable persistence contract for per-user UX preferences (collapsed
 * nav, last-used view per module, etc. — see docs/ARCHITECTURE.md
 * "Premium UX requirements").
 *
 * There is no `user_preferences` table yet, so Phase 0 ships a cookie-backed
 * implementation (see `cookie-store.ts`). Every read/write is keyed by
 * `userId` from day one — even though the cookie store ignores it — so
 * swapping in a Supabase-backed implementation later (keyed by
 * `auth.uid()`, scoped by `organization_id` per CLAUDE.md rule 1) is a
 * drop-in change behind this interface, not a call-site rewrite.
 *
 * TODO(auth-rbac-engineer): once session/user resolution lands (issues
 * #3/#4), pass the real `userId` (or `null` when signed out) into these
 * calls instead of the `null` placeholder used by the shell today.
 */
export interface PreferencesStore {
  getSidebarCollapsed(userId: string | null): Promise<boolean>;
  setSidebarCollapsed(userId: string | null, collapsed: boolean): Promise<void>;

  /**
   * Generic seam for "last-used view per module" (list/kanban/calendar/map)
   * called out in docs/ARCHITECTURE.md. Not wired to any UI yet since no
   * module with a view-switcher exists before Phase 1 — kept here so the
   * first module to add one (Assets or Planning) reuses this contract
   * instead of inventing per-module storage.
   */
  getLastUsedView(userId: string | null, moduleKey: string): Promise<string | null>;
  setLastUsedView(userId: string | null, moduleKey: string, view: string): Promise<void>;
}
