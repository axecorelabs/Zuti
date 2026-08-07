/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx}',
    '../../packages/ui/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-poppins)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        brand: ['var(--font-poppins)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        logo: ['var(--font-poppins)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Tixtron brand palette — neutrals ramp from Off White to Charcoal, both exact brand hexes.
        zinc: {
          50: '#FAFAFB',  // Off White
          100: '#F0F1F3',
          200: '#E6E8EB', // Light Gray
          300: '#C7CBD1',
          400: '#9CA1A8',
          500: '#687177', // Steel Gray
          600: '#4B5257',
          700: '#33383C',
          800: '#1D2023',
          900: '#14161A',
          950: '#0F1115', // Charcoal
        },
        // Primary accent — replaces the old blue-* accent app-wide (bg-brand-600, hover:bg-brand-500, etc.)
        brand: {
          200: '#FFD9B8',
          300: '#FFC08A',
          400: '#FF9955',
          500: '#FF8534',
          600: '#FF6A00', // Tixtron Orange
          700: '#E65F00',
          800: '#B34B00',
        },
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.5rem',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.7s cubic-bezier(.16,1,.3,1) both',
      },
    },
  },
  plugins: [],
};
