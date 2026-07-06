import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Coreflow brand navy (#0B3563), matching CoreTime/coreflow-shell. Previously
        // this scale was aliased to teal values (a past shortcut, not real navy) —
        // corrected so `navy-*` classes actually render navy. Teal accent stays on
        // Tailwind's built-in `teal-*` scale (already used ~60x across the app, close
        // enough to Coreflow teal #00B8C4 that remapping it is a separate decision).
        // Neutrals use Tailwind's built-in `slate` (matching CoreTime).
        navy: {
          50:  '#eef2f7',
          100: '#dde6ef',
          200: '#b8c9dc',
          300: '#93adc9',
          400: '#4d6f9c',
          500: '#1e4570',
          600: '#0B3563',
          700: '#092a4f',
          800: '#071f3b',
          900: '#051627',
        },
        brand: {
          DEFAULT: '#00B8C4', // Coreflow teal
          light:   '#33c7d1',
          dark:    '#0097A3',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
  ],
}

export default config
