import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
	docs: defineCollection({
		loader: docsLoader(),
		schema: docsSchema({
			extend: z.object({
				// Patches in which a class was added/removed; rendered as pills
				// under the page title (see components/starlight/PageTitle)
				since: z.string().optional(),
				removedIn: z.string().optional(),
				hash: z.string().optional(),
				// Class pages: how the game registers the class, and where the
				// categoriser put it (see scripts/categorize.ts). `domain` alone
				// is also set on a domain's own browse page.
				kind: z.enum(['class', 'interface', 'value']).optional(),
				domain: z.string().optional(),
				via: z.enum(['pin', 'seed', 'prefix', 'usage', 'shared', 'none']).optional(),
				family: z.string().optional(),
			}),
		}),
	}),
};
