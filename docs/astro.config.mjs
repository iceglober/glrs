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
      description: "Unified @glrs-dev ecosystem — agent harness, agentic CLI, SSO credentials.",
      social: {
        github: "https://github.com/iceglober/glrs",
      },
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Overview", slug: "index" },
            { label: "Install", slug: "install" },
          ],
        },
        {
          label: "harness-opencode",
          items: [{ label: "Overview", slug: "harness-opencode" }],
        },
        {
          label: "agentic",
          items: [{ label: "Overview", slug: "agentic" }],
        },
        {
          label: "assume",
          items: [{ label: "Overview", slug: "assume" }],
        },
        {
          label: "cli",
          items: [{ label: "Overview", slug: "cli" }],
        },
      ],
      editLink: {
        baseUrl: "https://github.com/iceglober/glrs/edit/main/docs/",
      },
      lastUpdated: true,
    }),
  ],
});
