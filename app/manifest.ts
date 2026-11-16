import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'SlateVault — Content Tracker',
    short_name: 'SlateVault',
    description:
      'Private creator content vault for YouTube videos, Shorts, Reels, Instagram carousels, captions, tags, and ideas.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#09090B',
    theme_color: '#2563EB',
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
      action: '/',
      method: 'GET',
      params: {
        title: 'share_title',
        text: 'share_text',
        url: 'share_url',
      },
    },
  };
}
