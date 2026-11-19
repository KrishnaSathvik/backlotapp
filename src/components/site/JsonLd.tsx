import { jsonLd } from '@/src/lib/site';

/** Server-rendered Schema.org JSON-LD. Renders nothing when there's no data (SITE_URL unset). */
export function JsonLd({ data }: { data: unknown }) {
  if (!data) return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }} />;
}
