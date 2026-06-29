/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // ── Bold / futuristic dark palette ──────────────────────────────
        deep: '#04060D',
        background: '#070A14',
        surface: '#0D1220',
        'surface-2': '#141B2D',
        divider: '#1E2740',
        ink: '#E8ECF8',
        muted: '#8B95B2',
        primary: '#4F7CFF',
        'primary-dark': '#3A5FE0',
        'primary-light': '#7DA0FF',
        accent: '#A855F7',
        cyan: '#22D3EE',
        mint: '#34D399',
      },
      fontFamily: {
        display: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        serif: ['"Cormorant Garamond"', 'serif'],
        body: ['"Inter"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        '2.5xl': '1.25rem',
        '4xl': '2rem',
      },
      boxShadow: {
        glow: '0 0 28px -6px rgba(79,124,255,0.55)',
        'glow-cyan': '0 0 28px -6px rgba(34,211,238,0.5)',
        'glow-accent': '0 0 28px -6px rgba(168,85,247,0.5)',
        panel: '0 8px 40px -12px rgba(0,0,0,0.6)',
      },
      animation: {
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'fade-in': 'fade-in 0.4s ease-out both',
        'slide-up': 'slide-up 0.45s cubic-bezier(0.16,1,0.3,1) both',
        'slide-in-right': 'slide-in-right 0.4s cubic-bezier(0.16,1,0.3,1) both',
        'gradient': 'gradient 8s ease infinite',
        'glow-pulse': 'glow-pulse 3.5s ease-in-out infinite',
        'aurora': 'aurora 18s ease infinite',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(18px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(28px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'gradient': {
          '0%,100%': { 'background-position': '0% 50%' },
          '50%': { 'background-position': '100% 50%' },
        },
        'glow-pulse': {
          '0%,100%': { opacity: '0.5' },
          '50%': { opacity: '1' },
        },
        'aurora': {
          '0%,100%': { transform: 'translate(0,0) scale(1)' },
          '33%': { transform: 'translate(4%,-6%) scale(1.1)' },
          '66%': { transform: 'translate(-4%,4%) scale(0.95)' },
        },
      },
    },
  },
  plugins: [],
}
