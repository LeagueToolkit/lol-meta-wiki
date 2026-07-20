// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import mdx from "@astrojs/mdx";

import tailwindcss from "@tailwindcss/vite";
import generateDb from "./integrations/generate-db.mjs";

// https://astro.build/config
export default defineConfig({
  site: 'https://meta-wiki.leaguetoolkit.dev',

  // Astro 7 changed the default to 'jsx', which strips whitespace between
  // inline elements on separate lines. Keep the v6 behavior to avoid subtle
  // spacing regressions across generated pages.
  compressHTML: true,

  // Remove 'base' when using custom domain (no subpath needed)
  integrations: [
    generateDb(),
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
        // (Starlight appends src/content/docs/<page> to this)
        baseUrl: 'https://github.com/LeagueToolkit/lol-meta-wiki/edit/main/site',
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
          items: [{ autogenerate: { directory: "guides" } }],
        },
        {
          label: "Reference",
          items: [{ autogenerate: { directory: "reference" } }],
        },
        {
          label: "API",
          // Ordered by sidebar.order frontmatter: overview, names-and-hashes,
          // endpoints, caching, licensing.
          items: [{ autogenerate: { directory: "api" } }],
        },
        {
          label: "Changelog",
          // Ordered by each page's sidebar.order frontmatter (overview at 0,
          // then patches newest-first) - generate-db assigns it since patch
          // strings don't sort lexicographically.
          items: [{ autogenerate: { directory: "changelog" } }],
        },
        // The ~5,300 "Classes" links are NOT part of the static sidebar:
        // rendering them into every page made each HTML file ~850KB (4.3GB
        // dist) and dominated build time. The Sidebar override
        // (ResizableSidebar.astro) renders the group client-side from
        // /db/classIndex.json instead.
      ],
    }),
    mdx(),
  ],

  vite: {
    plugins: [tailwindcss()],
  },
});