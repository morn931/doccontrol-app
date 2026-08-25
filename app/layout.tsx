import type { Metadata, Viewport } from 'next'
import { Inter, Geist_Mono } from 'next/font/google'
import './globals.css'

import CoreflowNavSpinner from "@/components/coreflow-nav-spinner";
const inter = Inter({ variable: '--font-inter', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'PPE Tech Document Control',
  description: 'EPCM Document Approval & Retrieval Platform',
  // iOS home-screen install (tablet pass)
  icons: { apple: '/coreflow/logo/pwa-icon-192.png' },
  appleWebApp: { capable: true, title: 'CoreDocs', statusBarStyle: 'default' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0B3563',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        <CoreflowNavSpinner />{children}
        {/*
          CoreSupport — the platform's "Report an issue" widget, served by the
          shell so there is ONE implementation rather than a copy per app.
          Spec: costflow-app/CORESUPPORT-SPEC.md.

          It renders NOTHING unless the coresupport_intake feature flag is on AND
          the visitor is signed in — it asks the shell on load and stays silent
          otherwise, so this tag is inert until the flag is switched on.

          Identity comes from the shared .coreflow.build session cookie, not from
          anything this page tells it.
        */}
        <script defer src="https://coreflow.build/api/support/widget.js" data-app="coredocs" />
      </body>
    </html>
  )
}
