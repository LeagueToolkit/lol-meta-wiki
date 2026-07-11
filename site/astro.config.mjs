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
      logo: {
        src: './src/assets/logo.svg',
      },
      favicon: '/favicon.svg',
      pagefind: true,
      head: [
        {
          // Highlight search terms on the destination page when arriving from
          // a search result (?highlight=<term>, set by our Search override).
          // The /pagefind/ bundle only exists in production builds, so the
          // import is guarded and failures are ignored in dev.
          tag: 'script',
          attrs: { type: 'module' },
          content: `
            if (new URLSearchParams(location.search).has('highlight')) {
              try {
                const { default: PagefindHighlight } = await import('/pagefind/pagefind-highlight.js');
                new PagefindHighlight({ highlightParam: 'highlight' });
              } catch {}
            }
          `,
        },
      ],
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
      components: {
        Sidebar: './src/components/starlight/ResizableSidebar.astro',
        PageTitle: './src/components/starlight/PageTitle.astro',
        // Copy of Starlight's Search with highlightParam enabled
        Search: './src/components/starlight/Search.astro',
      },
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