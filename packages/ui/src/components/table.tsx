import type { CSSProperties, HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cx } from "../cx";

export type TableAlign = "start" | "center" | "end";

export interface TableProps {
  children?: ReactNode;
  /**
   * Caps the table wrapper's own height and makes it independently
   * scrollable (rows scroll under the header, page scroll is untouched) —
   * pass a CSS length (`"60vh"`, `"480px"`, ...). Omit for the default,
   * backward-compatible behavior: no height cap, the table grows with its
   * content and scrolls with the surrounding page/content area.
   */
  maxHeight?: string;
  /**
   * Pins `Table.Head`'s cells to the top of the table's scrolling context
   * (the table wrapper itself when `maxHeight` is set, otherwise the
   * nearest scrollable ancestor — e.g. `AppLayout`'s content area) so long
   * lists read as "rows scroll under a fixed header" instead of the header
   * disappearing. Defaults to `false`, matching every existing call site's
   * current rendering exactly.
   */
  stickyHeader?: boolean;
}

/**
 * Table — compound API: `Table` renders a bordered, horizontally-scrollable
 * wrapper around a plain `<table>`; `Table.Head`/`Table.Body`/`Table.Row`
 * render `<thead>`/`<tbody>`/`<tr>`; `Table.HeaderCell`/`Table.Cell` render
 * `<th>`/`<td>`. `Table.Row` accepts an optional `onClick` (renders as a
 * clickable/hoverable row) and `selected` (tinted background). `align` on
 * header/body cells accepts "start" (default) | "center" | "end".
 */
export function Table({ children, maxHeight, stickyHeader }: TableProps) {
  const style: CSSProperties | undefined = maxHeight ? { maxHeight, overflowY: "auto" } : undefined;
  return (
    <div className={cx("ui-table-wrap", stickyHeader && "ui-table-sticky-header")} style={style}>
      <table className="ui-table">{children}</table>
    </div>
  );
}

export interface TableHeadProps {
  children?: ReactNode;
}

function TableHead({ children }: TableHeadProps) {
  return <thead className="ui-table-head">{children}</thead>;
}

export interface TableBodyProps {
  children?: ReactNode;
}

function TableBody({ children }: TableBodyProps) {
  return <tbody className="ui-table-body">{children}</tbody>;
}

export interface TableRowProps extends Omit<HTMLAttributes<HTMLTableRowElement>, "onClick"> {
  children?: ReactNode;
  onClick?: () => void;
  selected?: boolean;
}

function TableRow({ children, onClick, selected, className, ...rest }: TableRowProps) {
  return (
    <tr
      className={cx("ui-table-row", onClick && "ui-table-row-clickable", selected && "ui-table-row-selected", className)}
      onClick={onClick}
      {...rest}
    >
      {children}
    </tr>
  );
}

export interface TableHeaderCellProps extends Omit<ThHTMLAttributes<HTMLTableCellElement>, "align"> {
  align?: TableAlign;
  width?: string | number;
  children?: ReactNode;
}

function TableHeaderCell({ children, align, width, className, style, ...rest }: TableHeaderCellProps) {
  return (
    <th
      className={cx("ui-table-header-cell", align && `ui-table-align-${align}`, className)}
      style={width ? { width, ...style } : style}
      {...rest}
    >
      {children}
    </th>
  );
}

export interface TableCellProps extends Omit<TdHTMLAttributes<HTMLTableCellElement>, "align"> {
  align?: TableAlign;
  children?: ReactNode;
}

function TableCell({ children, align, className, ...rest }: TableCellProps) {
  return (
    <td className={cx("ui-table-cell", align && `ui-table-align-${align}`, className)} {...rest}>
      {children}
    </td>
  );
}

Table.Head = TableHead;
Table.Body = TableBody;
Table.Row = TableRow;
Table.HeaderCell = TableHeaderCell;
Table.Cell = TableCell;
