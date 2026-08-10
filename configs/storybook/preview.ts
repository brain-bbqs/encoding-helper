import "../../src/style.css";

// The app stylesheet themes <body> itself (light by default, dark via data-theme or the OS
// preference), so Storybook's own background layer is disabled rather than painted over it.
// The toolbar switch below pins data-theme explicitly, which also keeps Chromatic snapshots
// deterministic regardless of the runner's OS color-scheme preference.
const preview = {
  parameters: {
    backgrounds: { disable: true },
  },
  globalTypes: {
    theme: {
      description: "App color theme",
      toolbar: {
        title: "Theme",
        icon: "circlehollow",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: "light",
  },
  decorators: [
    (story: () => HTMLElement, context: { globals: { theme?: string } }): HTMLElement => {
      document.documentElement.dataset.theme = context.globals.theme ?? "light";
      return story();
    },
  ],
};

export default preview;
