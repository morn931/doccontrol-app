import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Required for Vercel deployment
  output: undefined,
  // Increase function timeout for AI processing (intake webhook can take 30-60s)
  serverExternalPackages: [],
}

export default nextConfig
