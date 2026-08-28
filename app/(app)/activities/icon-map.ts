import { AlertTriangle, Bell, CalendarDays, Mail, Phone, Settings, type Icon } from "@yourorg/ui/icons";

/**
 * Resolves an `activity_type` reference item's `icon` column (a plain string
 * — see `supabase/migrations/20260828090000_activities_core.sql`'s design
 * note 3: "must be an exact `@yourorg/ui/icons` export name") to the real
 * icon component. Only the 5 seeded `activity_type` icons are mapped today
 * (Phone/AlertTriangle/Settings/CalendarDays/Mail); `Bell` (this module's own
 * nav icon) is the fallback for a future tenant-added type this map hasn't
 * been extended for yet, or a `null`/unrecognized value — never a hard
 * failure over a cosmetic icon lookup.
 */
const ACTIVITY_TYPE_ICONS: Record<string, Icon> = {
  Phone,
  AlertTriangle,
  Settings,
  CalendarDays,
  Mail,
};

export function resolveActivityTypeIcon(iconName: string | null | undefined): Icon {
  if (iconName && ACTIVITY_TYPE_ICONS[iconName]) {
    return ACTIVITY_TYPE_ICONS[iconName];
  }
  return Bell;
}
