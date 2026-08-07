import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Tixtron — Smart Ticketing. Seamless Experiences.',
    short_name: 'Tixtron',
    description: 'Sell tickets and manage events with smart, reliable, fast tools.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0F1115',
    theme_color: '#FF6A00',
    icons: [
      { src: '/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
