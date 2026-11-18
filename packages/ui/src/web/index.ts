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
} from "./layout";
