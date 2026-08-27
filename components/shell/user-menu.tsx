"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Avatar, DropdownMenu, Inline, Stack, Text } from "@yourorg/ui";
import { ChevronDown, CreditCard, LogOut, Settings as SettingsIcon, UserRound } from "@yourorg/ui/icons";
import { logOutAction } from "@/lib/auth/actions";
import { ProfilePanel } from "@/app/(app)/profile/profile-panel";
import type { Locale } from "@/lib/profile/locale";

/**
 * Topbar avatar + dropdown menu. Owns its own open state (Escape-to-close +
 * outside-click, the latter via `DropdownMenu.Content`'s transparent
 * backdrop — same `open`/`onClose` contract as `Dialog`) since that's
 * genuinely interactive; `name`/`role`/`email`/`fullName`/`avatarUrl`/
 * `locale` are plain server-resolved values passed down from `Topbar`
 * (itself fed by `lib/auth/session.ts`'s `CurrentSession`), not fetched
 * here.
 *
 * "Facturatie" has no real destination yet (`billing` isn't even in
 * `SHIPPED_FEATURES`, see lib/rbac/features.ts) — still rendered
 * disabled/inert per the product owner's note that non-functional chrome is
 * fine for now. "Profiel" (issue #49) used to be disabled for the same
 * reason but now opens `ProfilePanel` — identity-level personal settings,
 * deliberately NOT gated by `hasFeature()` (every authenticated user has
 * one, regardless of role/org entitlements). "Instellingen" links to the
 * real `/settings` route (org-level module settings — a different surface
 * from "Profiel"). "Uitloggen" posts the real `logOutAction`.
 *
 * The "Platform Admin" indicator (issue #45, `session.isPlatformAdmin`)
 * lives in `Topbar` itself now, to the left of the search bar — not here —
 * per explicit product feedback moving it out of this menu.
 */
export function UserMenu({
  name,
  role,
  email,
  fullName,
  avatarUrl,
  locale,
}: {
  name: string;
  role?: string | null;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  locale: Locale;
}) {
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const roleLabel = role ? role.charAt(0).toUpperCase() + role.slice(1) : null;

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <DropdownMenu>
      <DropdownMenu.Trigger>
        <button
          type="button"
          className="ui-user-menu-trigger"
          onClick={() => setOpen((value) => !value)}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <Avatar name={name} size="md" photoUrl={avatarUrl} />
          <span className="ui-user-menu-trigger-meta">
            <span className="ui-user-menu-trigger-name">{name}</span>
            {roleLabel && <span className="ui-user-menu-trigger-role">{roleLabel}</span>}
          </span>
          <ChevronDown aria-hidden className="ui-user-menu-trigger-chevron" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Content open={open} onClose={() => setOpen(false)} align="end">
        <DropdownMenu.Label>
          <Inline gap="sm" align="center">
            <Avatar name={name} size="sm" photoUrl={avatarUrl} />
            <Stack gap="xs">
              <span>{name}</span>
              {roleLabel && <Text tone="muted">{roleLabel}</Text>}
            </Stack>
          </Inline>
        </DropdownMenu.Label>
        <DropdownMenu.Separator />
        <DropdownMenu.Item
          icon={<UserRound aria-hidden />}
          onClick={() => {
            setOpen(false);
            setProfileOpen(true);
          }}
        >
          Profiel
        </DropdownMenu.Item>
        <DropdownMenu.Item icon={<CreditCard aria-hidden />} disabled>
          Facturatie
        </DropdownMenu.Item>
        <DropdownMenu.Item icon={<SettingsIcon aria-hidden />} href="/settings" onClick={() => setOpen(false)}>
          Instellingen
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
        {/* No `onClick={() => setOpen(false)}` here (unlike "Instellingen"
            above) — this is a `type="submit"` button inside a real `<form>`.
            Synchronously closing the dropdown on click unmounts the form
            before the browser's native `submit` event can fire on it,
            silently cancelling the logout action entirely. `logOutAction`
            redirects to `/login` server-side on success, which unmounts
            this whole tree anyway, so there's nothing to manually close. */}
        <form action={logOutAction}>
          <DropdownMenu.Item icon={<LogOut aria-hidden />} type="submit" danger>
            Uitloggen
          </DropdownMenu.Item>
        </form>
      </DropdownMenu.Content>

      {/* Portalled to `document.body`, same reason `DropdownMenu.Content`'s
          own backdrop is (see that component's doc comment): `ProfilePanel`
          is a `Dialog size="panel"`, `position: fixed`, and this whole tree
          sits inside `Topbar`'s `.ui-toolbar`, which has
          `backdrop-filter: blur(10px)` for its glass effect — an ancestor
          with `backdrop-filter` establishes a new containing block for
          `position: fixed` descendants, which would otherwise size/anchor
          the panel to the toolbar's own short box instead of the full
          viewport. `typeof document` guards the SSR pass, where there is no
          `document` (this is never actually hit with real content since
          `profileOpen` starts `false` and `Dialog` itself returns `null`
          while closed — the guard exists purely so `document.body` is never
          evaluated during SSR). */}
      {typeof document !== "undefined" &&
        createPortal(
          <ProfilePanel
            open={profileOpen}
            onOpenChange={setProfileOpen}
            email={email}
            fullName={fullName}
            avatarUrl={avatarUrl}
            locale={locale}
          />,
          document.body,
        )}
    </DropdownMenu>
  );
}
