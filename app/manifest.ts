import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Content Vault',
    short_name: 'Content Vault',
    description:
      'Private creator content vault for YouTube videos, Shorts, Reels, Instagram carousels, captions, tags, and ideas.',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    background_color: '#07080C',
    theme_color: '#1A4DFF',
    icons: [
      {
        src: '/pwa-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/pwa-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/pwa-maskable-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    share_target: {
      action: '/app',
      method: 'GET',
      params: {
        title: 'share_title',
        text: 'share_text',
        url: 'share_url',
      },
    },
  };
}
