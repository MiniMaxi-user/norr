"use client";
// New primitive (added for the upcoming Clients detail redesign — Sites and
// Assets shown together on one page). Genuinely interactive (owns which tab
// is active), so it's its own "use client" entry — see tsup.config.ts's
// top-of-file comment for why that's a physically separate build entry
// rather than inlined into index.ts, same reasoning as client.tsx.

import {
  createContext,
  useContext,
  useId,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cx } from "./cx";

interface TabsContextValue {
  value: string;
  setValue: (value: string) => void;
  baseId: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(component: string): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    throw new Error(`<Tabs.${component}> must be rendered inside <Tabs>.`);
  }
  return ctx;
}

export interface TabsProps {
  /** Uncontrolled initial active tab — ignored once `value` is provided. */
  defaultValue?: string;
  /** Controlled active tab value. Pair with `onValueChange`. */
  value?: string;
  onValueChange?: (value: string) => void;
  children?: ReactNode;
  className?: string;
}

/**
 * Tabs — compound API: `Tabs` owns the active-tab state (controlled via
 * `value`/`onValueChange`, or uncontrolled via `defaultValue`);
 * `Tabs.List` wraps the tab buttons (`role="tablist"`); `Tabs.Tab` is a
 * single tab button, matched to a `Tabs.Panel` by `value`. Full roving-focus
 * keyboard support (Left/Right/Home/End) per the WAI-ARIA tabs pattern.
 *
 * ```tsx
 * <Tabs defaultValue="sites">
 *   <Tabs.List aria-label="Client detail">
 *     <Tabs.Tab value="sites">Sites</Tabs.Tab>
 *     <Tabs.Tab value="assets">Assets</Tabs.Tab>
 *   </Tabs.List>
 *   <Tabs.Panel value="sites">...</Tabs.Panel>
 *   <Tabs.Panel value="assets">...</Tabs.Panel>
 * </Tabs>
 * ```
 */
export function Tabs({ defaultValue, value, onValueChange, children, className }: TabsProps) {
  const baseId = useId();
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const isControlled = value !== undefined;
  const activeValue = isControlled ? (value as string) : internalValue;

  function setValue(next: string) {
    if (!isControlled) setInternalValue(next);
    onValueChange?.(next);
  }

  return (
    <TabsContext.Provider value={{ value: activeValue, setValue, baseId }}>
      <div className={cx("ui-tabs", className)}>{children}</div>
    </TabsContext.Provider>
  );
}

export interface TabsListProps {
  children?: ReactNode;
  "aria-label"?: string;
}

/**
 * Also exported standalone (not just as `Tabs.List`) — see the note above
 * `TabsTab`/`TabsPanel` below for why a Server Component composing `Tabs`
 * must import this named export rather than write `Tabs.List`.
 */
export function TabsList({ children, ...rest }: TabsListProps) {
  return (
    <div className="ui-tabs-list" role="tablist" {...rest}>
      {children}
    </div>
  );
}

export interface TabsTabProps {
  value: string;
  disabled?: boolean;
  children?: ReactNode;
}

function focusAndActivate(tab: HTMLButtonElement | null | undefined) {
  if (!tab) return;
  tab.focus();
  tab.click();
}

/**
 * Also exported standalone (not just as `Tabs.Tab`) — **required** when
 * composing `Tabs` from a Server Component (e.g. an `async function` page
 * that fetches data and lays out `<Tabs>` itself, rather than handing
 * pre-fetched data down as props to a "use client" wrapper). Real,
 * empirically-discovered gotcha: `Tabs` is this package's only compound
 * component that's also a Client Component boundary (top-of-file "use
 * client" — see the module comment). From a Server Component, `import {
 * Tabs } from "@yourorg/ui"` binds `Tabs` to a client-reference stub object
 * (Next's RSC wiring for "this element type crosses into client code"), NOT
 * the real function — a stub that has no `.List`/`.Tab`/`.Panel` properties
 * attached, so `Tabs.List` etc. silently evaluate to `undefined` there and
 * React throws "Element type is invalid ... got: undefined" the moment that
 * `undefined` is used as a JSX element type. Using the plain `<Tabs.List>`
 * property-access form is only safe from *within* another "use client"
 * module (there, the import resolves to the real bundled function with its
 * static properties intact) — which is why `Table`'s equivalent compound
 * properties (`Table.Head` etc.) don't have this problem at all: `Table`
 * itself carries no "use client" directive, so it's never a stub. Import
 * `TabsList`/`TabsTab`/`TabsPanel` directly instead when a Server Component
 * needs to compose `Tabs` itself.
 */
export function TabsTab({ value, disabled, children }: TabsTabProps) {
  const { value: activeValue, setValue, baseId } = useTabsContext("Tab");
  const selected = value === activeValue;

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    const tablist = event.currentTarget.closest('[role="tablist"]');
    if (!tablist) return;
    const tabs = Array.from(tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'));
    const currentIndex = tabs.indexOf(event.currentTarget);
    if (currentIndex === -1) return;

    event.preventDefault();
    if (event.key === "ArrowRight") focusAndActivate(tabs[(currentIndex + 1) % tabs.length]);
    else if (event.key === "ArrowLeft") focusAndActivate(tabs[(currentIndex - 1 + tabs.length) % tabs.length]);
    else if (event.key === "Home") focusAndActivate(tabs[0]);
    else if (event.key === "End") focusAndActivate(tabs[tabs.length - 1]);
  }

  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-tab-${value}`}
      aria-selected={selected}
      aria-controls={`${baseId}-panel-${value}`}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      className={cx("ui-tabs-tab", selected && "ui-tabs-tab-active")}
      onClick={() => setValue(value)}
      onKeyDown={onKeyDown}
    >
      {children}
    </button>
  );
}

export interface TabsPanelProps {
  value: string;
  children?: ReactNode;
}

/** Also exported standalone (not just as `Tabs.Panel`) — see the note above
 * `TabsTab` for why. */
export function TabsPanel({ value, children }: TabsPanelProps) {
  const { value: activeValue, baseId } = useTabsContext("Panel");
  if (value !== activeValue) return null;
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${value}`}
      aria-labelledby={`${baseId}-tab-${value}`}
      className="ui-tabs-panel"
      tabIndex={0}
    >
      {children}
    </div>
  );
}

Tabs.List = TabsList;
Tabs.Tab = TabsTab;
Tabs.Panel = TabsPanel;
