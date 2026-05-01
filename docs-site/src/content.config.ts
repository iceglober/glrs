import { glrsContentLoader } from "./loader";
import { docsSchema } from "@astrojs/starlight/schema";
import { defineCollection } from "astro:content";

export const collections = {
  docs: defineCollection({
    loader: glrsContentLoader([
      { base: "src/content/docs", slugPrefix: "/", include: ["*.md"] },
      { base: "../docs", slugPrefix: "/", include: ["**/*.md"] },
      {
        base: "../packages/cli",
        slugPrefix: "/cli/",
        singleFile: "README.md",
        titleFallback: "@glrs-dev/cli",
      },
      { base: "../packages/cli/docs", slugPrefix: "/cli/", include: ["**/*.md"] },
      {
        base: "../packages/harness-opencode",
        slugPrefix: "/harness-opencode/",
        singleFile: "README.md",
        titleFallback: "@glrs-dev/harness-plugin-opencode",
      },
      {
        base: "../packages/harness-opencode/docs",
        slugPrefix: "/harness-opencode/",
        include: ["**/*.md"],
        ignore: ["pilot/spikes/**", "archive/**", "spike-results.md"],
      },
      {
        base: "../packages/assume",
        slugPrefix: "/assume/",
        singleFile: "README.md",
        titleFallback: "@glrs-dev/assume",
      },
      { base: "../packages/assume/docs", slugPrefix: "/assume/", include: ["**/*.md"] },
    ]),
    schema: docsSchema(),
  }),
};
