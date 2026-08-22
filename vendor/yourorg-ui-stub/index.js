// TEMPORARY stub — see package.json description. Plain, minimally-styled
// components (classes come from ./styles.css) so app/(app) shell code can
// actually render, build, and deploy for manual testing while the real
// @yourorg/ui package doesn't exist yet. Not a design system: no theming
// depth, no accessibility polish beyond basics, no animation. Delete this
// whole vendor/ directory and swap back to the real npm dependency once
// the design-system repo publishes v0.1 (see docs/DEPLOYMENT.md).

const React = require("react");
const Link = require("next/link").default;
const { ThemeProvider, useTheme } = require("./client.js");

function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

function AppLayout({ sidebar, topbar, children }) {
  return React.createElement(
    "div",
    { className: "ui-app-layout" },
    sidebar,
    React.createElement(
      "div",
      { className: "ui-app-layout-main" },
      topbar,
      React.createElement("main", { className: "ui-app-layout-content" }, children)
    )
  );
}

function Sidebar({ collapsed, header, footer, children }) {
  return React.createElement(
    "aside",
    { className: cx("ui-sidebar", collapsed && "ui-sidebar-collapsed") },
    header && React.createElement("div", { className: "ui-sidebar-header" }, header),
    React.createElement("div", { className: "ui-sidebar-body" }, children),
    footer && React.createElement("div", { className: "ui-sidebar-footer" }, footer)
  );
}

function NavList({ children, ...rest }) {
  return React.createElement("nav", rest, React.createElement("ul", { className: "ui-nav-list" }, children));
}

function NavItem({ href, icon, disabled, trailing, children }) {
  const content = [
    icon && React.createElement("span", { className: "ui-nav-item-icon", key: "icon" }, icon),
    React.createElement("span", { className: "ui-nav-item-label", key: "label" }, children),
    trailing && React.createElement("span", { className: "ui-nav-item-trailing", key: "trailing" }, trailing),
  ];
  return React.createElement(
    "li",
    null,
    disabled
      ? React.createElement("span", { className: "ui-nav-item ui-nav-item-disabled", "aria-disabled": true }, content)
      : React.createElement(Link, { href, className: "ui-nav-item" }, content)
  );
}

function Badge({ variant, children }) {
  return React.createElement("span", { className: cx("ui-badge", variant && `ui-badge-${variant}`) }, children);
}

function Logo() {
  return React.createElement(
    "span",
    { className: "ui-logo" },
    React.createElement("span", { className: "ui-logo-mark", "aria-hidden": true }),
    React.createElement("span", { className: "ui-logo-text" }, "Norr")
  );
}

function Toolbar({ children }) {
  return React.createElement("header", { className: "ui-toolbar" }, children);
}
Toolbar.Section = function ToolbarSection({ align, children }) {
  return React.createElement("div", { className: cx("ui-toolbar-section", align === "end" && "ui-toolbar-section-end") }, children);
};

function IconButton({ variant, onClick, children, ...rest }) {
  return React.createElement(
    "button",
    Object.assign({ type: "button", className: cx("ui-icon-button", variant && `ui-icon-button-${variant}`), onClick }, rest),
    children
  );
}

function Tooltip({ content, children }) {
  // No hover popup in the stub — native `title` gets the same information
  // to the user (and to assistive tech) without needing client-side state.
  return React.cloneElement(children, { title: content });
}

function Button({ variant, size, onClick, children, ...rest }) {
  return React.createElement(
    "button",
    Object.assign(
      { type: "button", className: cx("ui-button", variant && `ui-button-${variant}`, size && `ui-button-${size}`), onClick },
      rest
    ),
    children
  );
}

function Kbd({ children }) {
  return React.createElement("kbd", { className: "ui-kbd" }, children);
}

function Card({ children }) {
  return React.createElement("div", { className: "ui-card" }, children);
}

function Heading({ level, children }) {
  const lvl = level || 2;
  return React.createElement(`h${lvl}`, { className: cx("ui-heading", `ui-heading-${lvl}`) }, children);
}

function Text({ tone, children }) {
  return React.createElement("p", { className: cx("ui-text", tone && `ui-text-${tone}`) }, children);
}

function Stack({ gap, children, ...rest }) {
  return React.createElement("div", Object.assign({ className: cx("ui-stack", gap && `ui-stack-${gap}`) }, rest), children);
}

function Label({ children, ...rest }) {
  return React.createElement("label", Object.assign({ className: "ui-label" }, rest), children);
}

function Input(props) {
  return React.createElement("input", Object.assign({ className: "ui-input" }, props));
}

function Skeleton({ height, width }) {
  return React.createElement("div", { className: "ui-skeleton", style: { height, width } });
}

function CommandPalette({ open, onOpenChange, placeholder, children }) {
  if (!open) return null;
  return React.createElement(
    "div",
    { className: "ui-command-overlay", onClick: () => onOpenChange(false) },
    React.createElement(
      "div",
      { className: "ui-command-dialog", onClick: (e) => e.stopPropagation() },
      React.createElement("input", { className: "ui-command-input", placeholder, autoFocus: true }),
      React.createElement("div", { className: "ui-command-list" }, children)
    )
  );
}

function CommandGroup({ heading, children }) {
  return React.createElement(
    "div",
    { className: "ui-command-group" },
    heading && React.createElement("div", { className: "ui-command-group-heading" }, heading),
    children
  );
}

function CommandItem({ onSelect, children }) {
  return React.createElement(
    "button",
    { type: "button", className: "ui-command-item", onClick: onSelect },
    children
  );
}

/**
 * Table — compound API: `Table` renders a horizontally-scrollable, bordered
 * wrapper around a plain `<table>`; `Table.Head`/`Table.Body`/`Table.Row`
 * render `<thead>`/`<tbody>`/`<tr>`; `Table.HeaderCell`/`Table.Cell` render
 * `<th>`/`<td>`. `Table.Row` accepts an optional `onClick` (renders as a
 * clickable/hoverable row) and `selected` (tinted background). `align` on
 * header/body cells accepts "start" (default) | "center" | "end".
 */
function Table({ children }) {
  return React.createElement(
    "div",
    { className: "ui-table-wrap" },
    React.createElement("table", { className: "ui-table" }, children)
  );
}
Table.Head = function TableHead({ children }) {
  return React.createElement("thead", { className: "ui-table-head" }, children);
};
Table.Body = function TableBody({ children }) {
  return React.createElement("tbody", { className: "ui-table-body" }, children);
};
Table.Row = function TableRow({ children, onClick, selected, ...rest }) {
  return React.createElement(
    "tr",
    Object.assign(
      {
        className: cx("ui-table-row", onClick && "ui-table-row-clickable", selected && "ui-table-row-selected"),
        onClick,
      },
      rest
    ),
    children
  );
};
Table.HeaderCell = function TableHeaderCell({ children, align, width, ...rest }) {
  return React.createElement(
    "th",
    Object.assign(
      { className: cx("ui-table-header-cell", align && `ui-table-align-${align}`), style: width ? { width } : undefined },
      rest
    ),
    children
  );
};
Table.Cell = function TableCell({ children, align, ...rest }) {
  return React.createElement(
    "td",
    Object.assign({ className: cx("ui-table-cell", align && `ui-table-align-${align}`) }, rest),
    children
  );
};

/** Select — native `<select>` styled to match Input, with a decorative
 * chevron. Pass `<option>` elements as `children`, same as plain HTML. */
function Select({ children, ...rest }) {
  return React.createElement(
    "div",
    { className: "ui-select-wrap" },
    React.createElement("select", Object.assign({ className: "ui-select" }, rest), children),
    React.createElement(
      "svg",
      {
        className: "ui-select-caret",
        width: 16,
        height: 16,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 2,
        "aria-hidden": true,
      },
      React.createElement("path", { d: "M6 9l6 6 6-6", strokeLinecap: "round", strokeLinejoin: "round" })
    )
  );
}

/** Textarea — same styling contract as Input; all native props pass through. */
function Textarea(props) {
  return React.createElement("textarea", Object.assign({ className: "ui-textarea" }, props));
}

/**
 * Dialog / Modal — same `open`/`onOpenChange` contract as `CommandPalette`:
 * clicking the overlay calls `onOpenChange(false)`; there is no built-in
 * Escape-key handling or close button (same as `CommandPalette`) — compose
 * one into `Dialog.Header` yourself (e.g. an `IconButton` calling
 * `onOpenChange(false)`) if the call site needs it. `size` is
 * "sm" | undefined (default, ~480px) | "lg".
 */
function Dialog({ open, onOpenChange, size, children }) {
  if (!open) return null;
  return React.createElement(
    "div",
    { className: "ui-dialog-overlay", onClick: () => onOpenChange(false) },
    React.createElement(
      "div",
      {
        className: cx("ui-dialog", size && `ui-dialog-${size}`),
        role: "dialog",
        "aria-modal": true,
        onClick: (e) => e.stopPropagation(),
      },
      children
    )
  );
}
Dialog.Header = function DialogHeader({ children }) {
  return React.createElement("div", { className: "ui-dialog-header" }, children);
};
Dialog.Body = function DialogBody({ children }) {
  return React.createElement("div", { className: "ui-dialog-body" }, children);
};
Dialog.Footer = function DialogFooter({ children }) {
  return React.createElement("div", { className: "ui-dialog-footer" }, children);
};

/** EmptyState — for "no clients yet" type screens. All slots optional except
 * `heading`. */
function EmptyState({ icon, heading, text, action }) {
  return React.createElement(
    "div",
    { className: "ui-empty-state" },
    icon && React.createElement("div", { className: "ui-empty-state-icon" }, icon),
    heading && React.createElement("div", { className: "ui-empty-state-heading" }, heading),
    text && React.createElement("div", { className: "ui-empty-state-text" }, text),
    action && React.createElement("div", { className: "ui-empty-state-action" }, action)
  );
}

module.exports = {
  ThemeProvider,
  useTheme,
  AppLayout,
  Sidebar,
  NavList,
  NavItem,
  Badge,
  Logo,
  Toolbar,
  IconButton,
  Tooltip,
  Button,
  Kbd,
  Card,
  Heading,
  Text,
  Label,
  Input,
  Stack,
  Skeleton,
  CommandPalette,
  CommandGroup,
  CommandItem,
  Table,
  Select,
  Textarea,
  Dialog,
  EmptyState,
};
