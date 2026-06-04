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
        // PPE Tech brand palette
        navy: {
          50:  '#EEF2F8',
          100: '#D5E0EF',
          200: '#ABBFDF',
          300: '#7F9ECE',
          400: '#547DBE',
          500: '#2A5CAD',
          600: '#1E4A8F',
          700: '#163A72',
          800: '#0E2B55',
          900: '#071C38',
        },
        brand: {
          DEFAULT: '#1E4A8F',
          light:   '#2A5CAD',
          dark:    '#163A72',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
  ],
}

export default config
