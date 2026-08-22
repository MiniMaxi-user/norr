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
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
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

  /**
   * Table — compound API for the upcoming Clients/Assets list screens.
   * `Table` renders a bordered, horizontally-scrollable wrapper around a
   * plain `<table>`. Compose it as:
   *
   * ```tsx
   * <Table>
   *   <Table.Head>
   *     <Table.Row>
   *       <Table.HeaderCell>Name</Table.HeaderCell>
   *       <Table.HeaderCell align="end">Status</Table.HeaderCell>
   *     </Table.Row>
   *   </Table.Head>
   *   <Table.Body>
   *     <Table.Row onClick={() => ...}>
   *       <Table.Cell>Acme BV</Table.Cell>
   *       <Table.Cell align="end"><Badge>Active</Badge></Table.Cell>
   *     </Table.Row>
   *   </Table.Body>
   * </Table>
   * ```
   */
  interface TableComponent {
    (props: { children?: ReactNode }): ReactElement;
    Head: (props: { children?: ReactNode }) => ReactElement;
    Body: (props: { children?: ReactNode }) => ReactElement;
    Row: (props: {
      children?: ReactNode;
      onClick?: () => void;
      selected?: boolean;
    }) => ReactElement;
    HeaderCell: (
      props: Omit<ThHTMLAttributes<HTMLTableCellElement>, "align"> & {
        align?: "start" | "center" | "end";
        width?: string | number;
        children?: ReactNode;
      }
    ) => ReactElement;
    Cell: (
      props: Omit<TdHTMLAttributes<HTMLTableCellElement>, "align"> & {
        align?: "start" | "center" | "end";
        children?: ReactNode;
      }
    ) => ReactElement;
  }
  export const Table: TableComponent;

  /** Native-backed `<select>`, styled to match `Input`. Pass `<option>`
   * elements as children, same as plain HTML. */
  export function Select(
    props: SelectHTMLAttributes<HTMLSelectElement> & { children?: ReactNode }
  ): ReactElement;

  /** Same styling contract as `Input`, for multi-line text. */
  export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>): ReactElement;

  /**
   * Dialog / Modal — same `open`/`onOpenChange` contract as
   * `CommandPalette`: clicking the overlay calls `onOpenChange(false)`.
   * There is no built-in Escape-key handling or close button (same as
   * `CommandPalette`) — compose one into `Dialog.Header` yourself (e.g. an
   * `IconButton` calling `onOpenChange(false)`) if the call site needs it.
   */
  interface DialogComponent {
    (props: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      size?: "sm" | "lg";
      children?: ReactNode;
    }): ReactElement | null;
    Header: (props: { children?: ReactNode }) => ReactElement;
    Body: (props: { children?: ReactNode }) => ReactElement;
    Footer: (props: { children?: ReactNode }) => ReactElement;
  }
  export const Dialog: DialogComponent;

  /** For "no clients yet" / "no assets yet" type screens. All slots are
   * optional except `heading`. */
  export function EmptyState(props: {
    icon?: ReactNode;
    heading: ReactNode;
    text?: ReactNode;
    action?: ReactNode;
  }): ReactElement;
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
  export const Plus: Icon;
  export const Pencil: Icon;
  export const Trash2: Icon;
  export const X: Icon;
  export const ChevronLeft: Icon;
  export const ChevronRight: Icon;
  export const MapPin: Icon;
  export const Building2: Icon;
  export const Mail: Icon;
  export const Phone: Icon;
  export const AlertTriangle: Icon;
}

declare module "@yourorg/ui/styles.css";
