import { createStorybookMain } from "@brain-bbqs/config/storybook";

export default createStorybookMain({
  packageJson: new URL("../../package.json", import.meta.url),
});
