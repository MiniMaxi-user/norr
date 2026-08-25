"use client";

import { useEffect, useState } from "react";
import { Avatar, DropdownMenu, Stack, Text } from "@yourorg/ui";
import { ChevronDown, CreditCard, LogOut, Settings as SettingsIcon, UserRound } from "@yourorg/ui/icons";
import { logOutAction } from "@/lib/auth/actions";

/**
 * Topbar avatar + dropdown menu. Owns its own open state (Escape-to-close +
 * outside-click, the latter via `DropdownMenu.Content`'s transparent
 * backdrop — same `open`/`onClose` contract as `Dialog`) since that's
 * genuinely interactive; `name`/`role` are plain server-resolved strings
 * passed down from `Topbar` (itself fed by `lib/auth/session.ts`'s
 * `CurrentSession`), not fetched here.
 *
 * "Profiel" and "Facturatie" have no real destination yet (no such pages
 * exist under app/(app) — `billing` isn't even in `SHIPPED_FEATURES`, see
 * lib/rbac/features.ts) — rendered disabled/inert per the product owner's
 * note that non-functional chrome is fine for now. "Instellingen" links to
 * the real `/settings` route. "Uitloggen" posts the real `logOutAction`.
 */
export function UserMenu({ name, role }: { name: string; role?: string | null }) {
  const [open, setOpen] = useState(false);
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
          <Avatar name={name} size="md" />
          <span className="ui-user-menu-trigger-meta">
            <span className="ui-user-menu-trigger-name">{name}</span>
            {roleLabel && <span className="ui-user-menu-trigger-role">{roleLabel}</span>}
          </span>
          <ChevronDown aria-hidden className="ui-user-menu-trigger-chevron" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Content open={open} onClose={() => setOpen(false)} align="end">
        <DropdownMenu.Label>
          <Stack gap="xs">
            <span>{name}</span>
            {roleLabel && <Text tone="muted">{roleLabel}</Text>}
          </Stack>
        </DropdownMenu.Label>
        <DropdownMenu.Separator />
        <DropdownMenu.Item icon={<UserRound aria-hidden />} disabled>
          Profiel
        </DropdownMenu.Item>
        <DropdownMenu.Item icon={<CreditCard aria-hidden />} disabled>
          Facturatie
        </DropdownMenu.Item>
        <DropdownMenu.Item icon={<SettingsIcon aria-hidden />} href="/settings" onClick={() => setOpen(false)}>
          Instellingen
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
        <form action={logOutAction}>
          <DropdownMenu.Item icon={<LogOut aria-hidden />} type="submit" danger onClick={() => setOpen(false)}>
            Uitloggen
          </DropdownMenu.Item>
        </form>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}
