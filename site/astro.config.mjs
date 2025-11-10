// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import mdx from "@astrojs/mdx";
import react from "@astrojs/react";

import tailwindcss from "@tailwindcss/vite";

// https://astro.build/config
export default defineConfig({
  site: 'https://meta-wiki.leaguetoolkit.dev',

  // Remove 'base' when using custom domain (no subpath needed)
  integrations: [
    starlight({
      title: "LoL Meta Wiki",
      customCss: [
        "./src/styles/global.css",
        "./src/styles/custom.css",
      ],
      editLink: {
        // Enable "Edit this page" linking to GitHub for PRs
        baseUrl: 'https://github.com/LeagueToolkit/lol-meta-wiki/edit/main/site/src/content',
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/LeagueToolkit/lol-meta-wiki",
        },
      ],
      sidebar: [
        {
          label: "Guides",
          autogenerate: { directory: "guides" },
        },
        {
          label: "Reference",
          autogenerate: { directory: "reference" },
        },
        {
          label: "Classes",
          autogenerate: { directory: "classes" },
        },
      ],
    }),
    mdx(),
    react(),
  ],

  vite: {
    // @ts-expect-error - Vite plugin type compatibility issue between dependencies
    plugins: [tailwindcss()],
  },
});