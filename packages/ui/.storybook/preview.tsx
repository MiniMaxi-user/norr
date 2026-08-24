import type { Preview } from "@storybook/react";
import "../src/styles.css";

/**
 * Loads the package's one CSS file (design tokens + every `.ui-*` class)
 * once, and exposes a Light/Dark toolbar toggle — this package's dark mode
 * is `html.dark` (see styles.css), not a `data-theme` attribute, so the
 * decorator toggles that class directly rather than following norrdesign's
 * Storybook setup verbatim.
 */
const preview: Preview = {
  parameters: {
    layout: "fullscreen",
  },
  globalTypes: {
    theme: {
      description: "Theme",
      defaultValue: "light",
      toolbar: {
        title: "Theme",
        icon: "mirror",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      document.documentElement.classList.toggle("dark", context.globals.theme === "dark");
      return Story();
    },
  ],
};

export default preview;
