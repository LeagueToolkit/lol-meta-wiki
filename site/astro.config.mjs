// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import mdx from "@astrojs/mdx";
import react from "@astrojs/react";

// https://astro.build/config
export default defineConfig({
  site: 'https://meta-wiki.leaguetoolkit.dev',
  // Remove 'base' when using custom domain (no subpath needed)
  integrations: [
    starlight({
      title: "LoL Meta Wiki",
      logo: {
        src: './src/assets/logo.svg',
      },
      favicon: '/favicon.svg',
      pagefind: true,
      customCss: [
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
});
