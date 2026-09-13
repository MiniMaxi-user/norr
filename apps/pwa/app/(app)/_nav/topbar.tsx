"use client";

import { useEffect, useState } from "react";
import { Logo } from "@yourorg/ui";
import { initialsOf, ProfileSheet } from "./profile-sheet";

/**
 * The field PWA's other permanent nav chrome (product feedback, 2026-09-13),
 * sibling to `BottomBar` — the Norr wordmark on the left and the profile
 * avatar on the right, mounted once in `app/(app)/layout.tsx` so it's
 * visible on every screen, not just Today (where the avatar used to live,
 * as part of `today-screen.tsx`). A normal flex child of `.ui-pwa-shell`
 * (`flex-shrink: 0`, same as `BottomBar`), not `position: fixed` — see
 * `.ui-bottom-bar`'s own doc comment for why that shell shape is what
 * actually keeps chrome from ever running behind/under page content.
 *
 * `useOnlineStatus` below is a plain `navigator.onLine` + online/offline
 * event listener, not `today-screen.tsx`'s old `isOnline` (which tracked
 * whether ITS OWN `/api/workitems/today` fetch last succeeded) — this
 * sheet's now reachable from every screen, so it needs a source of truth
 * that isn't tied to one screen's fetch.
 */
export function Topbar({
  fullName,
  email,
  currentUserId,
}: {
  fullName: string | null;
  email: string;
  currentUserId: string;
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const isOnline = useOnlineStatus();

  return (
    <>
      <div className="ui-pwa-topbar">
        <Logo />
        <button
          type="button"
          aria-label="Open profile"
          onClick={() => setProfileOpen(true)}
          className="ui-pwa-topbar-avatar"
        >
          {initialsOf(fullName, email)}
        </button>
      </div>

      <ProfileSheet
        open={profileOpen}
        onOpenChange={setProfileOpen}
        fullName={fullName}
        email={email}
        currentUserId={currentUserId}
        isOnline={isOnline}
      />
    </>
  );
}

function useOnlineStatus(): boolean {
  // Starts `true` (SSR/first paint has no `navigator`) — corrected on mount
  // and kept live via the standard online/offline events, same idiom as
  // every other "no network yet" state in this app.
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    function handleOnline() {
      setOnline(true);
    }
    function handleOffline() {
      setOnline(false);
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return online;
}
