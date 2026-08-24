import { Fragment, type ReactNode } from "react";
import { AppLayout } from "../../src/components/layout";
import { Sidebar } from "../../src/components/sidebar";
import { NavList, NavItem, NavGroupLabel } from "../../src/components/nav";
import { Logo } from "../../src/components/logo";
import { Avatar } from "../../src/components/avatar";
import { Inline } from "../../src/components/stack";
import { Text } from "../../src/components/typography";
import { LayoutDashboard, CalendarDays, ClipboardList, Boxes, Building2, Users } from "../../src/icons";
import { currentUser } from "./fixtures";

const navItems = [
  { href: "#dashboard", label: "Dashboard", icon: LayoutDashboard, group: "Overview" },
  { href: "#planning", label: "Planning", icon: CalendarDays, group: "Operations" },
  { href: "#jobs", label: "Jobs", icon: ClipboardList, group: "Operations" },
  { href: "#assets", label: "Assets", icon: Boxes, group: "Operations" },
  { href: "#clients", label: "Clients", icon: Building2, group: "Operations" },
  { href: "#technicians", label: "Technicians", icon: Users, group: "Admin" },
];

/**
 * Shared sidebar + shell wrapper for the FSM example stories — not part of
 * the published package (lives under `stories/`, same rule as
 * `lib/fixtures.ts`). Saves each page story from repeating the same
 * `AppLayout`/`Sidebar`/`NavList` boilerplate four times.
 *
 * `active` mirrors the real app shell's `components/shell/active-nav-item.tsx`
 * (a pathname match there, a plain prop here since these stories have no
 * router) so the stories actually demonstrate the active-item accent + group
 * labels rather than shipping a flat, unstyled nav that no longer matches
 * what `components/shell` renders.
 */
export function AppChrome({
  toolbar,
  active,
  children,
}: {
  toolbar?: ReactNode;
  active?: string;
  children: ReactNode;
}) {
  let lastGroup: string | undefined;
  return (
    <AppLayout
      sidebar={
        <Sidebar
          header={<Logo />}
          footer={
            <Inline gap="sm">
              <Avatar name={currentUser.name} size="sm" />
              <Text style={{ margin: 0 }}>{currentUser.name}</Text>
            </Inline>
          }
        >
          <NavList aria-label="Main">
            {navItems.map(({ href, label, icon: Icon, group }) => {
              const showGroupLabel = group !== lastGroup;
              lastGroup = group;
              return (
                <Fragment key={href}>
                  {showGroupLabel && <NavGroupLabel>{group}</NavGroupLabel>}
                  <NavItem href={href} icon={<Icon />} active={href === active}>
                    {label}
                  </NavItem>
                </Fragment>
              );
            })}
          </NavList>
        </Sidebar>
      }
      topbar={toolbar}
    >
      {children}
    </AppLayout>
  );
}
