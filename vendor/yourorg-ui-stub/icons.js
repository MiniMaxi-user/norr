// TEMPORARY stub — see package.json description. Simple, hand-drawn
// line-style SVG glyphs (no icon-library dependency) so the nav/command
// palette read as a real product instead of a wireframe of identical
// placeholder squares. Not pixel-perfect — just clean and distinct at the
// ~16-20px sizes they're actually used at in this app.
const React = require("react");

function el(tag, props) {
  return React.createElement(tag, props);
}

function createIcon(name, children) {
  function Icon(props) {
    return React.createElement(
      "svg",
      Object.assign(
        {
          width: "1em",
          height: "1em",
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.75,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "data-icon": name,
        },
        props
      ),
      children
    );
  }
  Icon.displayName = name;
  return Icon;
}

const Search = createIcon("Search", [
  el("circle", { key: "c", cx: 11, cy: 11, r: 7 }),
  el("line", { key: "l", x1: 21, y1: 21, x2: 16.3, y2: 16.3 }),
]);

const PanelLeftClose = createIcon("PanelLeftClose", [
  el("rect", { key: "r", x: 3, y: 4, width: 18, height: 16, rx: 2 }),
  el("line", { key: "d", x1: 9, y1: 4, x2: 9, y2: 20 }),
  el("path", { key: "p", d: "M15 9l-2.5 3 2.5 3" }),
]);

const PanelLeftOpen = createIcon("PanelLeftOpen", [
  el("rect", { key: "r", x: 3, y: 4, width: 18, height: 16, rx: 2 }),
  el("line", { key: "d", x1: 9, y1: 4, x2: 9, y2: 20 }),
  el("path", { key: "p", d: "M13 9l2.5 3-2.5 3" }),
]);

const Sun = createIcon("Sun", [
  el("circle", { key: "c", cx: 12, cy: 12, r: 4 }),
  el("line", { key: "l1", x1: 12, y1: 2, x2: 12, y2: 4.5 }),
  el("line", { key: "l2", x1: 12, y1: 19.5, x2: 12, y2: 22 }),
  el("line", { key: "l3", x1: 2, y1: 12, x2: 4.5, y2: 12 }),
  el("line", { key: "l4", x1: 19.5, y1: 12, x2: 22, y2: 12 }),
  el("line", { key: "l5", x1: 4.9, y1: 4.9, x2: 6.6, y2: 6.6 }),
  el("line", { key: "l6", x1: 17.4, y1: 17.4, x2: 19.1, y2: 19.1 }),
  el("line", { key: "l7", x1: 4.9, y1: 19.1, x2: 6.6, y2: 17.4 }),
  el("line", { key: "l8", x1: 17.4, y1: 6.6, x2: 19.1, y2: 4.9 }),
]);

const Moon = createIcon("Moon", [
  el("path", { key: "p", d: "M20 14.3A8 8 0 1 1 9.7 4a6.4 6.4 0 0 0 10.3 10.3z" }),
]);

const LayoutDashboard = createIcon("LayoutDashboard", [
  el("rect", { key: "a", x: 3, y: 3, width: 8, height: 10, rx: 1.5 }),
  el("rect", { key: "b", x: 13, y: 3, width: 8, height: 6, rx: 1.5 }),
  el("rect", { key: "c", x: 13, y: 11, width: 8, height: 10, rx: 1.5 }),
  el("rect", { key: "d", x: 3, y: 15, width: 8, height: 6, rx: 1.5 }),
]);

const Users = createIcon("Users", [
  el("circle", { key: "h1", cx: 9, cy: 8, r: 3.25 }),
  el("path", { key: "b1", d: "M3 20v-1.2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5V20" }),
  el("path", { key: "h2", d: "M16.5 4.8a3.25 3.25 0 0 1 0 6.4" }),
  el("path", { key: "b2", d: "M21 20v-1.2a4.6 4.6 0 0 0-3-4.3" }),
]);

const Boxes = createIcon("Boxes", [
  el("path", { key: "top", d: "M12 3 4 7.5 12 12l8-4.5z" }),
  el("path", { key: "left", d: "M4 7.5v9L12 21v-9z" }),
  el("path", { key: "right", d: "M20 7.5v9L12 21v-9z" }),
]);

const FileText = createIcon("FileText", [
  el("path", { key: "outline", d: "M6 2.5h8l5 5V20a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V4A1.5 1.5 0 0 1 6.5 2.5z" }),
  el("path", { key: "fold", d: "M14 2.5V7a1 1 0 0 0 1 1h4.5" }),
  el("line", { key: "t1", x1: 8, y1: 9.5, x2: 11, y2: 9.5 }),
  el("line", { key: "t2", x1: 8, y1: 13, x2: 16, y2: 13 }),
  el("line", { key: "t3", x1: 8, y1: 16.5, x2: 16, y2: 16.5 }),
]);

const CalendarDays = createIcon("CalendarDays", [
  el("rect", { key: "body", x: 3, y: 5, width: 18, height: 16, rx: 2 }),
  el("line", { key: "div", x1: 3, y1: 10, x2: 21, y2: 10 }),
  el("line", { key: "tab1", x1: 8, y1: 3, x2: 8, y2: 7 }),
  el("line", { key: "tab2", x1: 16, y1: 3, x2: 16, y2: 7 }),
  el("line", { key: "d1", x1: 7.5, y1: 14.2, x2: 7.5, y2: 14.2 }),
  el("line", { key: "d2", x1: 12, y1: 14.2, x2: 12, y2: 14.2 }),
  el("line", { key: "d3", x1: 16.5, y1: 14.2, x2: 16.5, y2: 14.2 }),
  el("line", { key: "d4", x1: 7.5, y1: 17.6, x2: 7.5, y2: 17.6 }),
  el("line", { key: "d5", x1: 12, y1: 17.6, x2: 12, y2: 17.6 }),
]);

const BarChart3 = createIcon("BarChart3", [
  el("line", { key: "axisY", x1: 4, y1: 3, x2: 4, y2: 21 }),
  el("line", { key: "axisX", x1: 4, y1: 21, x2: 21, y2: 21 }),
  el("rect", { key: "b1", x: 7.5, y: 14, width: 3, height: 7 }),
  el("rect", { key: "b2", x: 12.5, y: 9.5, width: 3, height: 11.5 }),
  el("rect", { key: "b3", x: 17.5, y: 5.5, width: 3, height: 15.5 }),
]);

const Receipt = createIcon("Receipt", [
  el("path", {
    key: "outline",
    d: "M6 2.5h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z",
  }),
  el("line", { key: "l1", x1: 8.5, y1: 7.5, x2: 15.5, y2: 7.5 }),
  el("line", { key: "l2", x1: 8.5, y1: 11, x2: 15.5, y2: 11 }),
  el("line", { key: "l3", x1: 8.5, y1: 14.5, x2: 12.5, y2: 14.5 }),
]);

const Plus = createIcon("Plus", [
  el("line", { key: "v", x1: 12, y1: 4, x2: 12, y2: 20 }),
  el("line", { key: "h", x1: 4, y1: 12, x2: 20, y2: 12 }),
]);

const Pencil = createIcon("Pencil", [
  el("path", { key: "body", d: "M4 16.5V20h3.5L18.4 9.1a1.5 1.5 0 0 0 0-2.1l-1.4-1.4a1.5 1.5 0 0 0-2.1 0z" }),
  el("line", { key: "tip", x1: 13.5, y1: 6.5, x2: 17.5, y2: 10.5 }),
]);

const Trash2 = createIcon("Trash2", [
  el("path", { key: "lid", d: "M3.5 6.5h17" }),
  el("path", { key: "body", d: "M6 6.5V19a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V6.5" }),
  el("path", { key: "handle", d: "M9 6.5V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5v2" }),
  el("line", { key: "s1", x1: 10, y1: 10, x2: 10, y2: 16.5 }),
  el("line", { key: "s2", x1: 14, y1: 10, x2: 14, y2: 16.5 }),
]);

const X = createIcon("X", [
  el("line", { key: "l1", x1: 5, y1: 5, x2: 19, y2: 19 }),
  el("line", { key: "l2", x1: 19, y1: 5, x2: 5, y2: 19 }),
]);

const ChevronLeft = createIcon("ChevronLeft", [
  el("path", { key: "p", d: "M14.5 4.5 7 12l7.5 7.5" }),
]);

const ChevronRight = createIcon("ChevronRight", [
  el("path", { key: "p", d: "M9.5 4.5 17 12l-7.5 7.5" }),
]);

const MapPin = createIcon("MapPin", [
  el("path", { key: "pin", d: "M12 21s7-6.6 7-11.5A7 7 0 0 0 5 9.5C5 14.4 12 21 12 21z" }),
  el("circle", { key: "dot", cx: 12, cy: 9.5, r: 2.25 }),
]);

const Building2 = createIcon("Building2", [
  el("rect", { key: "body", x: 4, y: 3, width: 12, height: 18, rx: 1 }),
  el("path", { key: "wing", d: "M16 10h4v11h-4" }),
  el("line", { key: "w1", x1: 7.5, y1: 7, x2: 7.5, y2: 7 }),
  el("line", { key: "w2", x1: 12.5, y1: 7, x2: 12.5, y2: 7 }),
  el("line", { key: "w3", x1: 7.5, y1: 11, x2: 7.5, y2: 11 }),
  el("line", { key: "w4", x1: 12.5, y1: 11, x2: 12.5, y2: 11 }),
  el("line", { key: "w5", x1: 7.5, y1: 15, x2: 7.5, y2: 15 }),
  el("line", { key: "w6", x1: 12.5, y1: 15, x2: 12.5, y2: 15 }),
]);

const Mail = createIcon("Mail", [
  el("rect", { key: "body", x: 3, y: 5, width: 18, height: 14, rx: 2 }),
  el("path", { key: "flap", d: "M3.5 6.5 12 13l8.5-6.5" }),
]);

const Phone = createIcon("Phone", [
  el("path", {
    key: "p",
    d: "M6.5 3.5h2.8l1.2 4-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2 4 1.2v2.8a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 5 5.1a1.5 1.5 0 0 1 1.5-1.6z",
  }),
]);

const AlertTriangle = createIcon("AlertTriangle", [
  el("path", { key: "tri", d: "M12 4 2.5 20h19z" }),
  el("line", { key: "stem", x1: 12, y1: 10, x2: 12, y2: 14.5 }),
  el("line", { key: "dot", x1: 12, y1: 17.25, x2: 12, y2: 17.25 }),
]);

module.exports = {
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Moon,
  LayoutDashboard,
  Users,
  Boxes,
  FileText,
  CalendarDays,
  BarChart3,
  Receipt,
  Plus,
  Pencil,
  Trash2,
  X,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Building2,
  Mail,
  Phone,
  AlertTriangle,
};
