import type { StorybookConfig } from "@storybook/html-vite";
import { resolveAppVersion } from "../appVersion";

const config: StorybookConfig = {
  stories: ["../../stories/**/*.stories.@(ts|js)"],
  addons: [],
  framework: {
    name: "@storybook/html-vite",
    options: {},
  },
  viteFinal(config) {
    config.define = {
      ...config.define,
      __APP_VERSION__: JSON.stringify(resolveAppVersion()),
    };
    return config;
  },
};

export default config;
