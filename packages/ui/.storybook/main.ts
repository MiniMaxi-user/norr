import type { StorybookConfig } from "@storybook/react-vite";
import { fileURLToPath } from "node:url";

const config: StorybookConfig = {
  stories: ["../stories/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-essentials"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  async viteFinal(config) {
    const { mergeConfig } = await import("vite");
    return mergeConfig(config, {
      resolve: {
        alias: {
          // This package's stories render its components directly from
          // source (not through the built `@yourorg/ui` package entry), so
          // `next/link` never runs inside a real Next.js app — swap in a
          // plain-`<a>` stand-in with the same default-export shape instead
          // of pulling in all of Next just for Storybook.
          "next/link": fileURLToPath(new URL("./mocks/next-link.tsx", import.meta.url)),
        },
      },
    });
  },
};

export default config;
