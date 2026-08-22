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
  return React.createElement("span", { className: "ui-logo" }, "Norr");
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
  return React.createElement(`h${level || 2}`, { className: "ui-heading" }, children);
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
};
