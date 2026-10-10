"use client";

import { useState } from "react";
import { initialsOf } from "./profile-sheet";

/**
 * The engineer's own profile photo inside the topbar avatar button and the
 * profile sheet header, falling back to their initials when no photo was
 * uploaded or it fails to load (e.g. offline — the photo lives in Supabase
 * Storage and isn't cached by the service worker).
 */
export function ProfilePhoto({
  avatarUrl,
  fullName,
  email,
}: {
  avatarUrl: string | null;
  fullName: string | null;
  email: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!avatarUrl || failed) return <>{initialsOf(fullName, email)}</>;

  return <img className="ui-pwa-avatar-photo" src={avatarUrl} alt="" onError={() => setFailed(true)} />;
}
