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
export {
  ToastProvider,
  useToast,
  toast,
  type ToastTone,
  type ToastOptions,
  type ToastProviderProps,
} from "./toast.js";

export { AppLayout, type AppLayoutProps } from "./components/layout";
export { Sidebar, type SidebarProps } from "./components/sidebar";
export {
  NavList,
  NavItem,
  NavGroupLabel,
  type NavListProps,
  type NavItemProps,
  type NavGroupLabelProps,
} from "./components/nav";
export { Badge, type BadgeProps, type BadgeVariant } from "./components/badge";
export { Logo, type LogoProps, Logomark, type LogomarkProps } from "./components/logo";
export { NordicScene, type NordicSceneProps } from "./components/nordic-scene";
export { BackLink, type BackLinkProps } from "./components/back-link";
export { Separator, type SeparatorProps } from "./components/separator";
export {
  DropdownMenu,
  type DropdownMenuProps,
  type DropdownMenuTriggerProps,
  type DropdownMenuContentProps,
  type DropdownMenuLabelProps,
  type DropdownMenuItemProps,
} from "./components/dropdown-menu";
export {
  AuthSplitLayout,
  type AuthSplitLayoutProps,
  type AuthSplitPanelProps,
  type AuthSplitFormAreaProps,
  type AuthSplitIllustrationProps,
} from "./components/auth-split-layout";
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
export { Card, type CardProps, type CardTone } from "./components/card";
export { Heading, Text, type HeadingProps, type HeadingLevel, type TextProps, type TextTone } from "./components/typography";
export { Stack, Inline, type StackProps, type StackGap, type InlineProps, type InlineAlign } from "./components/stack";
export { Avatar, type AvatarProps, type AvatarSize } from "./components/avatar";
export { Breadcrumbs, type BreadcrumbsProps, type BreadcrumbItem } from "./components/breadcrumbs";
export { DetailHero, type DetailHeroProps } from "./components/detail-hero";
export {
  DetailLayout,
  DefinitionList,
  type DetailLayoutProps,
  type DefinitionListProps,
  type DefinitionListItem,
} from "./components/detail-layout";
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
export { FormField, FormSelectField } from "./components/form-field";
export {
  CascadingSelect,
  type CascadingSelectProps,
  type CascadingSelectOption,
} from "./components/cascading-select";
export {
  IconTileSelect,
  type IconTileSelectProps,
  type IconTileOption,
} from "./components/icon-tile-select";
// Combobox (issue #54) has real interactive state (open/query/highlighted-
// index) — its own dedicated "use client" build entry, same reasoning and
// same ".js" re-export requirement as ThemeProvider/Tabs above (see
// tsup.config.ts's top-of-file comment).
export { Combobox, type ComboboxProps, type ComboboxOption } from "./combobox.js";
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
// useEscapeToClose has real hook state (useEffect/useRef) — its own
// dedicated "use client" build entry, same reasoning and same ".js"
// re-export requirement as ThemeProvider/Tabs above (see tsup.config.ts's
// top-of-file comment).
export { useEscapeToClose } from "./use-escape-to-close.js";
// ConfirmDeleteDialog (issue #77) has real interactive state (checking/
// error/deleting) — its own dedicated "use client" build entry, same
// reasoning and same ".js" re-export requirement as ThemeProvider/Tabs
// above (see tsup.config.ts's top-of-file comment).
export { ConfirmDeleteDialog, type ConfirmDeleteDialogProps } from "./confirm-delete-dialog.js";
export { Board, type BoardProps, type BoardColumnProps, type BoardCardProps } from "./components/board";
export { EmptyState, type EmptyStateProps } from "./components/empty-state";
export {
  LinkedRecordsTable,
  type LinkedRecordsTableProps,
  type LinkedRecordsColumn,
} from "./components/linked-records-table";
export {
  Disclosure,
  type DisclosureProps,
  type DisclosureSummaryProps,
  type DisclosureContentProps,
} from "./components/disclosure";
export { Switch, type SwitchProps } from "./components/switch";
export { Slider, type SliderProps } from "./components/slider";
export {
  RadioGroup,
  RadioGroupItem,
  type RadioGroupProps,
  type RadioGroupItemProps,
} from "./components/radio-group";
export { Progress, type ProgressProps, type ProgressTone } from "./components/progress";
export { StatCard, type StatCardProps, type StatCardTrend, type StatCardTone } from "./components/stat-card";
export { StatStrip, type StatStripProps, type StatStripItem } from "./components/stat-strip";
export { SectionHeader, type SectionHeaderProps } from "./components/section-header";
export { RelationCard, type RelationCardProps } from "./components/relation-card";
export { RowCard, type RowCardProps, type RowCardTone } from "./components/row-card";
export { SummaryRow, type SummaryRowProps, type SummaryRowItem } from "./components/summary-row";
export { RecordHeroBand, type RecordHeroBandProps } from "./components/record-hero-band";
export { KeyValueList, type KeyValueListProps, type KeyValueListItem } from "./components/key-value-list";
export { Callout, type CalloutProps } from "./components/callout";
export { Timeline, type TimelineProps, type TimelineRowProps, type TimelineBlockProps } from "./components/timeline";
export {
  MapSurface,
  MapPinPopup,
  type MapSurfaceProps,
  type MapSurfacePinProps,
  type MapPinPopupProps,
  type MapPinPopupRow,
} from "./components/map-surface";
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
