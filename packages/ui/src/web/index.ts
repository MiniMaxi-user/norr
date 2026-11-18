// Server-safe half of the web design system (issue #222) — exported as
// `@yourorg/ui/web`. Interactive pieces (PageHeader, KeyValueCard,
// useEditMode, menus, dialogs) are in `@yourorg/ui/web-client`. Neither entry
// is re-exported from the package's main `index.ts`, so the PWA's bundle is
// unaffected by this layer.
export {
  WebBadge,
  WebBreadcrumb,
  WebButton,
  WebCard,
  WebCardPair,
  WebCardStack,
  WebDataTable,
  WebDataTableEmpty,
  WebField,
  WebInput,
  WebFigures,
  WebLinkButton,
} from "./primitives";
export type {
  WebBadgeProps,
  WebBadgeVariant,
  WebBreadcrumbItem,
  WebButtonProps,
  WebButtonVariant,
  WebCardProps,
  WebFieldProps,
  WebFigure,
  WebLinkButtonProps,
} from "./primitives";
export {
  SidebarNotice,
  SidebarProgress,
  SidebarRows,
  SidebarSection,
  Timeline,
  WebDetailLayout,
  WebListPage,
  WebListSkeleton,
  WebCardGrid,
  WebCardSkeleton,
  WebHint,
  WebLinkRow,
  WebSettingsHeader,
  WebSettingsMain,
  WebSettingsNav,
  WebSettingsPage,
  WebPage,
} from "./layout";
export type {
  SidebarRow,
  SidebarSectionProps,
  TimelineItem,
  TimelineProps,
  TimelineStatus,
  WebDetailLayoutProps,
  WebListPageProps,
  WebListSkeletonProps,
  WebSettingsHeaderProps,
  WebSettingsNavGroup,
  WebSettingsPageProps,
} from "./layout";
