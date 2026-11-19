import type { MetadataRoute } from 'next';
import { AI_TRAINING_AGENTS, ROBOTS_DISALLOW, absoluteUrl, disallowAiTraining } from '@/src/lib/site';

export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  const sitemap = absoluteUrl('/sitemap.xml');
  const disallow = [...ROBOTS_DISALLOW];
  const rules: MetadataRoute.Robots['rules'] = [{ userAgent: '*', allow: '/', disallow }];
  if (disallowAiTraining()) {
    rules.push({ userAgent: AI_TRAINING_AGENTS, disallow: '/' });
  }
  return { rules, ...(sitemap ? { sitemap } : {}) };
}
