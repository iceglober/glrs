// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// https://astro.build/config
export default defineConfig({
  site: "https://glrs.dev",
  output: "static",
  build: {
    format: "directory",
  },
  integrations: [
    starlight({
      title: "glrs",
      description: "Unified @glrs-dev ecosystem — agent harness, worktree CLI, SSO credentials.",
      social: {
        github: "https://github.com/iceglober/glrs",
      },
      sidebar: [
        { label: "Start here", items: [{ label: "Install", slug: "install" }] },
        { label: "assume", autogenerate: { directory: "assume" } },
        { label: "cli", autogenerate: { directory: "cli" } },
        { label: "harness-opencode", autogenerate: { directory: "harness-opencode" } },
      ],
      lastUpdated: true,
    }),
  ],
});
