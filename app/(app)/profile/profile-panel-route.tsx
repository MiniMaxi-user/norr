"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ProfilePanel } from "./profile-panel";
import type { Locale } from "@/lib/profile/locale";

/**
 * Client wrapper that opens `ProfilePanel` pre-opened for the real
 * `/profile` deep-link route (`page.tsx`), independent of the topbar
 * `UserMenu` entry point (`components/shell/user-menu.tsx`) that renders the
 * exact same `ProfilePanel`. Owns just enough local state to satisfy
 * `ProfilePanel`'s `open`/`onOpenChange` contract — the panel itself is
 * unaware it's being deep-linked to.
 *
 * Closing navigates back (this route was reached by an explicit link/URL,
 * not opened over already-loaded page content the way the topbar's panel
 * is), falling back to `/` when there's no meaningful browser history to
 * return to (e.g. `/profile` was the very first page loaded in this tab —
 * a bare `router.back()` there would leave the user stranded on a blank
 * history entry or bounce them out of the app entirely).
 */
export function ProfilePanelRoute({
  email,
  fullName,
  avatarUrl,
  locale,
}: {
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  locale: Locale;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) return;
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  }

  return (
    <ProfilePanel
      open={open}
      onOpenChange={handleOpenChange}
      email={email}
      fullName={fullName}
      avatarUrl={avatarUrl}
      locale={locale}
    />
  );
}
