import type { MetadataRoute } from 'next'

// PWA manifest (tablet pass, 2026-07-18) — lets staff install CoreDocs on
// tablets so it opens full-screen as an app. Same pattern as CoreSHERQ.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'CoreDocs',
    short_name: 'CoreDocs',
    description: 'Document control & review — Coreflow.',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0B3563',
    icons: [
      { src: '/coreflow/logo/pwa-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/coreflow/logo/pwa-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/coreflow/logo/pwa-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  }
}
