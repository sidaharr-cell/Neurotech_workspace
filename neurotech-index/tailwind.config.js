/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // ── Light editorial palette (Nature / Science News feel) ──────────
        paper: '#FFFFFF',
        canvas: '#F7F6F2',      // warm off-white section background
        ink: '#16181D',         // near-black headline / body
        'ink-soft': '#3D424D',  // secondary body
        muted: '#6B7280',       // metadata / captions
        rule: '#E4E2DC',        // hairline borders
        'rule-soft': '#EEEDE8',
        accent: '#0B5FA6',      // editorial blue (links, category, kicker)
        'accent-dark': '#08477D',
        'accent-soft': '#EAF2FA',
        highlight: '#B3241E',   // reserved red (breaking / lead kicker)
      },
      fontFamily: {
        // Serif for headlines (news), sans for UI/body
        serif: ['Newsreader', 'Georgia', 'Cambria', 'Times New Roman', 'serif'],
        display: ['Newsreader', 'Georgia', 'serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      maxWidth: {
        prose: '46rem',
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out both',
        'slide-down': 'slide-down 0.18s ease-out both',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-down': {
          from: { opacity: '0', transform: 'translateY(-6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
