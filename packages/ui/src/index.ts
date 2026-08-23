// Public entry point for `@yourorg/ui`. The app must only ever import from
// here (or `./icons` / `./styles.css`) — never reach into individual
// component source files.

// Explicit ".js" extensions on these two re-exports are load-bearing, not
// stylistic: `client.tsx` and `tabs.tsx` are the only modules in this
// package with a top-level "use client" directive, and tsup.config.ts
// marks these exact specifiers `external` in the ESM build so esbuild
// leaves them as real `import`s of the sibling `dist/client.js` /
// `dist/tabs.js` files instead of inlining their source into `index.js`.
// Inlined, the directive would end up stripped (esbuild does not hoist/
// preserve "use client" when bundling multiple modules into one file) and
// Next's RSC compiler would no longer see `ThemeProvider`/`useTheme`/`Tabs`
// as client-boundary exports — see tsup.config.ts for the full story.
export { ThemeProvider, useTheme, type ThemeName, type ThemeProviderProps, type ThemeContextValue } from "./client.js";

export { AppLayout, type AppLayoutProps } from "./components/layout";
export { Sidebar, type SidebarProps } from "./components/sidebar";
export { NavList, NavItem, type NavListProps, type NavItemProps } from "./components/nav";
export { Badge, type BadgeProps, type BadgeVariant } from "./components/badge";
export { Logo, type LogoProps } from "./components/logo";
export { BackLink, type BackLinkProps } from "./components/back-link";
export { Toolbar, type ToolbarProps, type ToolbarSectionProps } from "./components/toolbar";
export {
  Button,
  IconButton,
  type ButtonProps,
  type ButtonVariant,
  type ButtonSize,
  type IconButtonProps,
  type IconButtonVariant,
} from "./components/button";
export { Tooltip, type TooltipProps } from "./components/tooltip";
export { Kbd } from "./components/kbd";
export { Card, type CardProps } from "./components/card";
export { Heading, Text, type HeadingProps, type HeadingLevel, type TextProps, type TextTone } from "./components/typography";
export { Stack, Inline, type StackProps, type StackGap, type InlineProps, type InlineAlign } from "./components/stack";
export { Avatar, type AvatarProps, type AvatarSize } from "./components/avatar";
export { Breadcrumbs, type BreadcrumbsProps, type BreadcrumbItem } from "./components/breadcrumbs";
export {
  Label,
  Input,
  Select,
  Textarea,
  Checkbox,
  FormSection,
  FormGrid,
  FormGridFull,
  type LabelProps,
  type InputProps,
  type SelectProps,
  type TextareaProps,
  type CheckboxProps,
  type FormSectionProps,
  type FormGridProps,
  type FormGridFullProps,
} from "./components/form";
export {
  CascadingSelect,
  type CascadingSelectProps,
  type CascadingSelectOption,
} from "./components/cascading-select";
export { Skeleton, type SkeletonProps } from "./components/skeleton";
export {
  CommandPalette,
  CommandGroup,
  CommandItem,
  type CommandPaletteProps,
  type CommandGroupProps,
  type CommandItemProps,
} from "./components/command-palette";
export {
  Table,
  type TableProps,
  type TableAlign,
  type TableHeadProps,
  type TableBodyProps,
  type TableRowProps,
  type TableHeaderCellProps,
  type TableCellProps,
} from "./components/table";
export { Dialog, type DialogProps, type DialogSize, type DialogSectionProps } from "./components/dialog";
export { EmptyState, type EmptyStateProps } from "./components/empty-state";
export {
  Disclosure,
  type DisclosureProps,
  type DisclosureSummaryProps,
  type DisclosureContentProps,
} from "./components/disclosure";
export {
  Tabs,
  // Standalone named exports of `Tabs.List`/`Tabs.Tab`/`Tabs.Panel` — a
  // Server Component composing `Tabs` itself (rather than handing
  // pre-fetched data down to a "use client" wrapper) MUST use these instead
  // of the `Tabs.List` property-access form, which resolves to `undefined`
  // there — see the doc comment on `TabsTab` in `tabs.tsx` for the full
  // "client-reference stub has no static properties" explanation.
  TabsList,
  TabsTab,
  TabsPanel,
  type TabsProps,
  type TabsListProps,
  type TabsTabProps,
  type TabsPanelProps,
} from "./tabs.js";
