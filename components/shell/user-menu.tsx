"use client";

import type { ReactNode } from "react";
import { WebBadge } from "@yourorg/ui/web";
import { WebMenu, type WebMenuItem } from "@yourorg/ui/web-client";
import { LogOut, UserRound } from "@yourorg/ui/icons";
import { logOutAction } from "@/lib/auth/actions";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

/**
 * Avatar menu of the topbar (design system "Topbar", issue #222): a 28px round
 * avatar that opens profile, settings, platform settings (platform admins),
 * the role / "Platform Admin" badge and log out. The theme toggle is NOT here
 * — web is light-only.
 *
 * `menuLinks` are the Settings / Platform settings nav entries (already
 * entitlement- and RBAC-resolved server-side by `splitTopbarItems`), so this
 * menu can't offer a module the tenant doesn't have. "Profile" (issue #49) is
 * identity-level and open to every authenticated user.
 *
 * "Log out" is a real `<form action={logOutAction}>` rendered as a custom
 * menu entry: the menu must NOT close on click, because unmounting the form
 * before the browser's native submit fires would silently cancel the logout
 * (`logOutAction` redirects to /login, which unmounts everything anyway).
 */
export function UserMenu({
  name,
  role,
  avatarUrl,
  isPlatformAdmin,
  menuLinks,
}: {
  name: string;
  role?: string | null;
  avatarUrl: string | null;
  isPlatformAdmin: boolean;
  menuLinks: { href: string; label: string; icon: ReactNode }[];
}) {
  const roleLabel = role ? role.charAt(0).toUpperCase() + role.slice(1) : null;

  const items: WebMenuItem[] = [
    {
      type: "label",
      key: "who",
      node: (
        <>
          {name}
          {roleLabel ? <span className="web-menu-sublabel">{roleLabel}</span> : null}
          {isPlatformAdmin ? (
            <span className="web-menu-sublabel">
              <WebBadge variant="warning">Platform Admin</WebBadge>
            </span>
          ) : null}
        </>
      ),
    },
    { type: "separator", key: "sep-1" },
    {
      key: "profile",
      label: "Profile",
      icon: <UserRound aria-hidden />,
      href: "/profile",
    },
    ...menuLinks.map((link) => ({
      key: link.href,
      label: link.label,
      icon: link.icon,
      href: link.href,
    })),
    { type: "separator", key: "sep-2" },
    {
      type: "custom",
      key: "logout",
      node: (
        <form action={logOutAction}>
          <button type="submit" role="menuitem" className="web-menu-item" data-danger="true">
            <LogOut aria-hidden />
            Log out
          </button>
        </form>
      ),
    },
  ];

  return (
    <>
      <WebMenu
        label="Account menu"
        triggerClassName="web-avatar-button"
        trigger={
          avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" />
          ) : (
            initials(name)
          )
        }
        items={items}
      />
    </>
  );
}
