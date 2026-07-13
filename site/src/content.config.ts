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
			}),
		}),
	}),
};
