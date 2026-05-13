import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Primary accent — deep violet. base44 uses energetic green; we use a
        // saturated violet to stay distinct while keeping the same single-
        // accent-on-white aesthetic.
        brand: {
          50: '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
          800: '#5b21b6',
          900: '#4c1d95',
        },
        // Warm neutrals (stone-derived) for surfaces, borders, body copy.
        ink: {
          50: '#fafaf9',
          100: '#f5f5f4',
          200: '#e7e5e4',
          300: '#d6d3d1',
          400: '#a8a29e',
          500: '#78716c',
          600: '#57534e',
          700: '#44403c',
          800: '#292524',
          900: '#1c1917',
          950: '#0c0a09',
        },
      },
      fontFamily: {
        sans: ['Inter', 'var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      letterSpacing: {
        tightish: '-0.015em',
        tighter2: '-0.03em',
      },
      borderRadius: {
        DEFAULT: '0.5rem',
        lg: '0.625rem',
        xl: '0.875rem',
        '2xl': '1.125rem',
      },
      boxShadow: {
        soft: '0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.04)',
        card: '0 1px 2px 0 rgb(0 0 0 / 0.03), 0 4px 12px -4px rgb(0 0 0 / 0.06)',
        cardHover: '0 4px 8px -2px rgb(0 0 0 / 0.05), 0 10px 24px -8px rgb(0 0 0 / 0.10)',
        glow: '0 0 0 4px rgb(139 92 246 / 0.12)',
      },
      transitionTimingFunction: {
        snappy: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      },
    },
  },
  plugins: [],
};

export default config;
