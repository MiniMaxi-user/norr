import Link from "next/link";
import { Logo } from "@yourorg/ui";
import { CommandPalette } from "./command-palette";
import { TopbarNav } from "./topbar-nav";
import { UserMenu } from "./user-menu";
import { splitTopbarItems, type ResolvedNavItem } from "./nav-items";
import { memberDisplayName } from "@/lib/members/format";
import type { CurrentSession } from "@/lib/auth/session";

/**
 * A component *function* cannot cross the server/client boundary as a prop —
 * only already-rendered elements can (see the crash documented in
 * `command-palette.tsx`). Rendering `<Icon />` here, in this Server
 * Component, is what makes the nav entries safe to hand to client leaves.
 */
function toClientEntries(items: ResolvedNavItem[]) {
  return items.map(({ icon: Icon, href, label }) => ({ href, label, icon: <Icon aria-hidden /> }));
}

/**
 * Web topbar (design system "Topbar", issue #222): navy, 50px, sticky. Logo
 * on the left, module menu (max 7 + "More"), the search field that opens the
 * command palette, and the avatar menu (profile, settings, platform admin,
 * log out). No breadcrumb or page title lives here — those are the page
 * header's job.
 *
 * Server Component; the interactive leaves are `TopbarNav` (active state,
 * More menu), `CommandPalette` (Ctrl/Cmd+K) and `UserMenu`.
 */
export function Topbar({
  navItems,
  user,
  isPlatformAdmin,
}: {
  navItems: ResolvedNavItem[];
  user: Pick<CurrentSession, "email" | "fullName" | "role" | "avatarUrl" | "locale">;
  isPlatformAdmin: boolean;
}) {
  const displayName = memberDisplayName({ email: user.email, full_name: user.fullName });
  const { primary, more, menu } = splitTopbarItems(navItems);

  return (
    <header className="web-topbar">
      <Link className="web-topbar-brand" href="/" aria-label="Norr — home">
        <Logo />
      </Link>
      <TopbarNav primary={toClientEntries(primary)} more={toClientEntries(more)} />
      <div className="web-topbar-right">
        <CommandPalette navItems={toClientEntries(navItems.filter((item) => item.enabled))} />
        <UserMenu
          name={displayName}
          role={user.role}
          email={user.email}
          fullName={user.fullName}
          avatarUrl={user.avatarUrl}
          locale={user.locale}
          isPlatformAdmin={isPlatformAdmin}
          menuLinks={toClientEntries(menu)}
        />
      </div>
    </header>
  );
}
