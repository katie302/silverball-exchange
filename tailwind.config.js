/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#14101F',
        surface: '#1E1830',
        line: '#352C52',
        ivory: '#F5F0FF',
        muted: '#B0A8CC',
        dim: '#8A7DB8',
        pink: '#F25C9F',
        mint: '#4FD8BE',
        amber: '#FF9F5A',
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
        sans: ['"Hanken Grotesk"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
