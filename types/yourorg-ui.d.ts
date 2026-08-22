// Ambient type declarations for the TEMPORARY local stub backing
// `@yourorg/ui` (see vendor/yourorg-ui-stub/package.json). Loose but
// shaped to match what the app shell actually calls, so `tsc --noEmit`
// still catches real misuse. Delete this file along with vendor/ once the
// real design-system package ships its own types.
declare module "@yourorg/ui" {
  import type {
  ReactNode,
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactElement,
} from "react";

  export function ThemeProvider(props: {
    attribute?: string;
    defaultTheme?: string;
    enableSystem?: boolean;
    children?: ReactNode;
  }): ReactElement;

  export function useTheme(): { theme: string; setTheme: (theme: string) => void };

  export function AppLayout(props: { sidebar?: ReactNode; topbar?: ReactNode; children?: ReactNode }): ReactElement;

  export function Sidebar(props: {
    collapsed?: boolean;
    header?: ReactNode;
    footer?: ReactNode;
    children?: ReactNode;
  }): ReactElement;

  export function NavList(props: { "aria-label"?: string; children?: ReactNode }): ReactElement;

  export function NavItem(props: {
    href: string;
    icon?: ReactNode;
    disabled?: boolean;
    trailing?: ReactNode;
    children?: ReactNode;
  }): ReactElement;

  export function Badge(props: { variant?: string; children?: ReactNode }): ReactElement;

  export function Logo(): ReactElement;

  interface ToolbarComponent {
    (props: { children?: ReactNode }): ReactElement;
    Section: (props: { align?: "start" | "end"; children?: ReactNode }) => ReactElement;
  }
  export const Toolbar: ToolbarComponent;

  export function IconButton(
    props: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }
  ): ReactElement;

  export function Tooltip(props: { content?: ReactNode; children: ReactElement }): ReactElement;

  export function Button(
    props: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }
  ): ReactElement;

  export function Kbd(props: { children?: ReactNode }): ReactElement;

  export function Card(props: { children?: ReactNode }): ReactElement;

  export function Heading(props: { level?: number; children?: ReactNode }): ReactElement;

  export function Text(props: { tone?: string; children?: ReactNode }): ReactElement;

  export function Stack(props: {
    gap?: string;
    "aria-hidden"?: boolean;
    children?: ReactNode;
  }): ReactElement;

  export function Label(
    props: LabelHTMLAttributes<HTMLLabelElement> & { children?: ReactNode }
  ): ReactElement;

  export function Input(props: InputHTMLAttributes<HTMLInputElement>): ReactElement;

  export function Skeleton(props: { height?: string; width?: string }): ReactElement;

  export function CommandPalette(props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    placeholder?: string;
    children?: ReactNode;
  }): ReactElement | null;

  export function CommandGroup(props: { heading?: string; children?: ReactNode }): ReactElement;

  export function CommandItem(props: { onSelect?: () => void; children?: ReactNode }): ReactElement;
}

declare module "@yourorg/ui/icons" {
  import type { ComponentType, SVGProps } from "react";

  type Icon = ComponentType<SVGProps<SVGSVGElement>>;

  export const Search: Icon;
  export const PanelLeftClose: Icon;
  export const PanelLeftOpen: Icon;
  export const Sun: Icon;
  export const Moon: Icon;
  export const LayoutDashboard: Icon;
  export const Users: Icon;
  export const Boxes: Icon;
  export const FileText: Icon;
  export const CalendarDays: Icon;
  export const BarChart3: Icon;
  export const Receipt: Icon;
}

declare module "@yourorg/ui/styles.css";
