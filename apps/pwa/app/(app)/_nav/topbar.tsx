"use client";

import { useEffect, useState } from "react";
import { Logo } from "@yourorg/ui";
import { ProfileSheet } from "./profile-sheet";
import { ProfilePhoto } from "./profile-photo";

/**
 * The field PWA's app bar (DS 08 section 2): 56px, `header-bg` navy, the Norr logo
 * (white wordmark, gold detail) on the left, the 36px profile avatar on the right
 * (opens the profile sheet) — nothing else. Product feedback, 2026-09-13:
 * visible on every screen, not just Today. Mounted once in
 * `app/(app)/layout.tsx`, a normal flex child of `.pwa-shell`
 * (`flex: none`, same as `BottomBar`), not `position: fixed` — see
 * `.pwa-shell` in pwa.css for why that shell shape is what actually keeps
 * chrome from ever running behind/under page content.
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
  avatarUrl,
  currentUserId,
}: {
  fullName: string | null;
  email: string;
  avatarUrl: string | null;
  currentUserId: string;
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const isOnline = useOnlineStatus();

  return (
    <>
      <div className="pwa-appbar">
        <p className="pwa-appbar-title">
          <Logo />
        </p>
        <button
          type="button"
          aria-label="Open profile"
          onClick={() => setProfileOpen(true)}
          className="pwa-avatar"
        >
          <ProfilePhoto avatarUrl={avatarUrl} fullName={fullName} email={email} />
        </button>
      </div>

      <ProfileSheet
        open={profileOpen}
        onOpenChange={setProfileOpen}
        fullName={fullName}
        email={email}
        avatarUrl={avatarUrl}
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
