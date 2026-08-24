// Simple, hand-drawn line-style SVG glyphs (no icon-library dependency) so
// the nav/command palette read as a real product instead of a wireframe of
// identical placeholder squares. Not pixel-perfect — just clean and distinct
// at the ~16-20px sizes they're actually used at in this app. Pure,
// presentational, no hooks — safe to render from Server or Client Components.
import type { ComponentType, SVGProps } from "react";

export type Icon = ComponentType<SVGProps<SVGSVGElement>>;

function createIcon(name: string, children: React.ReactNode): Icon {
  function IconComponent(props: SVGProps<SVGSVGElement>) {
    return (
      <svg
        width="1em"
        height="1em"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        data-icon={name}
        {...props}
      >
        {children}
      </svg>
    );
  }
  IconComponent.displayName = name;
  return IconComponent;
}

export const Search = createIcon("Search", (
  <>
    <circle cx={11} cy={11} r={7} />
    <line x1={21} y1={21} x2={16.3} y2={16.3} />
  </>
));

export const PanelLeftClose = createIcon("PanelLeftClose", (
  <>
    <rect x={3} y={4} width={18} height={16} rx={2} />
    <line x1={9} y1={4} x2={9} y2={20} />
    <path d="M15 9l-2.5 3 2.5 3" />
  </>
));

export const PanelLeftOpen = createIcon("PanelLeftOpen", (
  <>
    <rect x={3} y={4} width={18} height={16} rx={2} />
    <line x1={9} y1={4} x2={9} y2={20} />
    <path d="M13 9l2.5 3-2.5 3" />
  </>
));

export const Sun = createIcon("Sun", (
  <>
    <circle cx={12} cy={12} r={4} />
    <line x1={12} y1={2} x2={12} y2={4.5} />
    <line x1={12} y1={19.5} x2={12} y2={22} />
    <line x1={2} y1={12} x2={4.5} y2={12} />
    <line x1={19.5} y1={12} x2={22} y2={12} />
    <line x1={4.9} y1={4.9} x2={6.6} y2={6.6} />
    <line x1={17.4} y1={17.4} x2={19.1} y2={19.1} />
    <line x1={4.9} y1={19.1} x2={6.6} y2={17.4} />
    <line x1={17.4} y1={6.6} x2={19.1} y2={4.9} />
  </>
));

export const Moon = createIcon("Moon", (
  <path d="M20 14.3A8 8 0 1 1 9.7 4a6.4 6.4 0 0 0 10.3 10.3z" />
));

export const LayoutDashboard = createIcon("LayoutDashboard", (
  <>
    <rect x={3} y={3} width={8} height={10} rx={1.5} />
    <rect x={13} y={3} width={8} height={6} rx={1.5} />
    <rect x={13} y={11} width={8} height={10} rx={1.5} />
    <rect x={3} y={15} width={8} height={6} rx={1.5} />
  </>
));

export const Users = createIcon("Users", (
  <>
    <circle cx={9} cy={8} r={3.25} />
    <path d="M3 20v-1.2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5V20" />
    <path d="M16.5 4.8a3.25 3.25 0 0 1 0 6.4" />
    <path d="M21 20v-1.2a4.6 4.6 0 0 0-3-4.3" />
  </>
));

export const Boxes = createIcon("Boxes", (
  <>
    <path d="M12 3 4 7.5 12 12l8-4.5z" />
    <path d="M4 7.5v9L12 21v-9z" />
    <path d="M20 7.5v9L12 21v-9z" />
  </>
));

export const FileText = createIcon("FileText", (
  <>
    <path d="M6 2.5h8l5 5V20a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V4A1.5 1.5 0 0 1 6.5 2.5z" />
    <path d="M14 2.5V7a1 1 0 0 0 1 1h4.5" />
    <line x1={8} y1={9.5} x2={11} y2={9.5} />
    <line x1={8} y1={13} x2={16} y2={13} />
    <line x1={8} y1={16.5} x2={16} y2={16.5} />
  </>
));

export const CalendarDays = createIcon("CalendarDays", (
  <>
    <rect x={3} y={5} width={18} height={16} rx={2} />
    <line x1={3} y1={10} x2={21} y2={10} />
    <line x1={8} y1={3} x2={8} y2={7} />
    <line x1={16} y1={3} x2={16} y2={7} />
    <line x1={7.5} y1={14.2} x2={7.5} y2={14.2} />
    <line x1={12} y1={14.2} x2={12} y2={14.2} />
    <line x1={16.5} y1={14.2} x2={16.5} y2={14.2} />
    <line x1={7.5} y1={17.6} x2={7.5} y2={17.6} />
    <line x1={12} y1={17.6} x2={12} y2={17.6} />
  </>
));

export const BarChart3 = createIcon("BarChart3", (
  <>
    <line x1={4} y1={3} x2={4} y2={21} />
    <line x1={4} y1={21} x2={21} y2={21} />
    <rect x={7.5} y={14} width={3} height={7} />
    <rect x={12.5} y={9.5} width={3} height={11.5} />
    <rect x={17.5} y={5.5} width={3} height={15.5} />
  </>
));

export const Receipt = createIcon("Receipt", (
  <>
    <path d="M6 2.5h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z" />
    <line x1={8.5} y1={7.5} x2={15.5} y2={7.5} />
    <line x1={8.5} y1={11} x2={15.5} y2={11} />
    <line x1={8.5} y1={14.5} x2={12.5} y2={14.5} />
  </>
));

// Used for the Quotes module (issue #16) — distinct from `FileText`
// (Contracts, a signed agreement) and `Receipt` (Billing, already-invoiced
// revenue): a clipboard with a checkmark reads as "proposal pending
// approval", the right register for a pre-sale quote.
export const ClipboardList = createIcon("ClipboardList", (
  <>
    <rect x={5} y={4} width={14} height={17} rx={1.5} />
    <rect x={9} y={2.5} width={6} height={3} rx={1} />
    <path d="m8.5 12 1.5 1.5L13 10" />
    <line x1={8.5} y1={16.5} x2={15.5} y2={16.5} />
  </>
));

export const Plus = createIcon("Plus", (
  <>
    <line x1={12} y1={4} x2={12} y2={20} />
    <line x1={4} y1={12} x2={20} y2={12} />
  </>
));

export const Pencil = createIcon("Pencil", (
  <>
    <path d="M4 16.5V20h3.5L18.4 9.1a1.5 1.5 0 0 0 0-2.1l-1.4-1.4a1.5 1.5 0 0 0-2.1 0z" />
    <line x1={13.5} y1={6.5} x2={17.5} y2={10.5} />
  </>
));

export const Trash2 = createIcon("Trash2", (
  <>
    <path d="M3.5 6.5h17" />
    <path d="M6 6.5V19a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V6.5" />
    <path d="M9 6.5V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5v2" />
    <line x1={10} y1={10} x2={10} y2={16.5} />
    <line x1={14} y1={10} x2={14} y2={16.5} />
  </>
));

export const X = createIcon("X", (
  <>
    <line x1={5} y1={5} x2={19} y2={19} />
    <line x1={19} y1={5} x2={5} y2={19} />
  </>
));

export const ChevronLeft = createIcon("ChevronLeft", <path d="M14.5 4.5 7 12l7.5 7.5" />);

export const ChevronRight = createIcon("ChevronRight", <path d="M9.5 4.5 17 12l-7.5 7.5" />);

export const MapPin = createIcon("MapPin", (
  <>
    <path d="M12 21s7-6.6 7-11.5A7 7 0 0 0 5 9.5C5 14.4 12 21 12 21z" />
    <circle cx={12} cy={9.5} r={2.25} />
  </>
));

export const Building2 = createIcon("Building2", (
  <>
    <rect x={4} y={3} width={12} height={18} rx={1} />
    <path d="M16 10h4v11h-4" />
    <line x1={7.5} y1={7} x2={7.5} y2={7} />
    <line x1={12.5} y1={7} x2={12.5} y2={7} />
    <line x1={7.5} y1={11} x2={7.5} y2={11} />
    <line x1={12.5} y1={11} x2={12.5} y2={11} />
    <line x1={7.5} y1={15} x2={7.5} y2={15} />
    <line x1={12.5} y1={15} x2={12.5} y2={15} />
  </>
));

export const Mail = createIcon("Mail", (
  <>
    <rect x={3} y={5} width={18} height={14} rx={2} />
    <path d="M3.5 6.5 12 13l8.5-6.5" />
  </>
));

export const Phone = createIcon("Phone", (
  <path d="M6.5 3.5h2.8l1.2 4-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2 4 1.2v2.8a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 5 5.1a1.5 1.5 0 0 1 1.5-1.6z" />
));

export const AlertTriangle = createIcon("AlertTriangle", (
  <>
    <path d="M12 4 2.5 20h19z" />
    <line x1={12} y1={10} x2={12} y2={14.5} />
    <line x1={12} y1={17.25} x2={12} y2={17.25} />
  </>
));

export const Settings = createIcon("Settings", (
  <>
    <circle cx={12} cy={12} r={3.25} />
    <line x1={12} y1={2.5} x2={12} y2={5.2} />
    <line x1={12} y1={18.8} x2={12} y2={21.5} />
    <line x1={4.4} y1={4.4} x2={6.3} y2={6.3} />
    <line x1={17.7} y1={17.7} x2={19.6} y2={19.6} />
    <line x1={2.5} y1={12} x2={5.2} y2={12} />
    <line x1={18.8} y1={12} x2={21.5} y2={12} />
    <line x1={4.4} y1={19.6} x2={6.3} y2={17.7} />
    <line x1={17.7} y1={6.3} x2={19.6} y2={4.4} />
  </>
));

export const ArrowUp = createIcon("ArrowUp", (
  <>
    <line x1={12} y1={19} x2={12} y2={5} />
    <path d="M6 11l6-6 6 6" />
  </>
));

export const ArrowDown = createIcon("ArrowDown", (
  <>
    <line x1={12} y1={5} x2={12} y2={19} />
    <path d="M6 13l6 6 6-6" />
  </>
));

export const ChevronDown = createIcon("ChevronDown", <path d="M4.5 9.5 12 17l7.5-7.5" />);

// Used on the login screen's SSO button + trust line, and available for any
// future "secured"/"verified" affordance.
export const ShieldCheck = createIcon("ShieldCheck", (
  <>
    <path d="M12 3 5 6v5.5c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6z" />
    <path d="m9 12 2 2 4-4.5" />
  </>
));

// Topbar help affordance (visually present, not wired to anything yet).
export const CircleHelp = createIcon("CircleHelp", (
  <>
    <circle cx={12} cy={12} r={9} />
    <path d="M9.3 9.3a2.7 2.7 0 1 1 3.9 2.4c-.9.5-1.2 1-1.2 2" />
    <line x1={12} y1={16.7} x2={12} y2={16.7} />
  </>
));

// Topbar notifications affordance (visually present, not wired to anything yet).
export const Bell = createIcon("Bell", (
  <>
    <path d="M6 9.5a6 6 0 0 1 12 0c0 4 1.3 5.2 1.3 5.2H4.7S6 13.5 6 9.5z" />
    <path d="M10 18.5a2 2 0 0 0 4 0" />
  </>
));

export const LogOut = createIcon("LogOut", (
  <>
    <path d="M14 4h-3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
    <line x1={20} y1={12} x2={9.5} y2={12} />
    <path d="m16.5 8 4 4-4 4" />
  </>
));

export const UserRound = createIcon("UserRound", (
  <>
    <circle cx={12} cy={8.5} r={3.75} />
    <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
  </>
));

// Row/kebab menu trigger — three vertical dots.
export const MoreVertical = createIcon("MoreVertical", (
  <>
    <circle cx={12} cy={5} r={1.4} fill="currentColor" stroke="none" />
    <circle cx={12} cy={12} r={1.4} fill="currentColor" stroke="none" />
    <circle cx={12} cy={19} r={1.4} fill="currentColor" stroke="none" />
  </>
));

export const CreditCard = createIcon("CreditCard", (
  <>
    <rect x={3} y={5.5} width={18} height={13} rx={2} />
    <line x1={3} y1={10} x2={21} y2={10} />
    <line x1={7} y1={14.5} x2={11} y2={14.5} />
  </>
));
