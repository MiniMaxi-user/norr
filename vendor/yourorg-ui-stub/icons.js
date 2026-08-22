// TEMPORARY stub — see package.json description. Every icon is the same
// generic placeholder glyph; only the name differs, since visual identity
// isn't the point of this stub (unblocking a deployable build is).
const React = require("react");

function createIcon(name) {
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
          strokeWidth: "2",
          "data-icon": name,
        },
        props
      ),
      React.createElement("rect", { x: 4, y: 4, width: 16, height: 16, rx: 3 })
    );
  }
  Icon.displayName = name;
  return Icon;
}

module.exports = {
  Search: createIcon("Search"),
  PanelLeftClose: createIcon("PanelLeftClose"),
  PanelLeftOpen: createIcon("PanelLeftOpen"),
  Sun: createIcon("Sun"),
  Moon: createIcon("Moon"),
  LayoutDashboard: createIcon("LayoutDashboard"),
  Users: createIcon("Users"),
  Boxes: createIcon("Boxes"),
  FileText: createIcon("FileText"),
  CalendarDays: createIcon("CalendarDays"),
  BarChart3: createIcon("BarChart3"),
  Receipt: createIcon("Receipt"),
};
