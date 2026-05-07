/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      colors: {
        sf: {
          navy: '#3e5d88',
          blue: '#558fc3',
          indigo: '#4b689d',
        },
      },
      boxShadow: {
        sf: '0 12px 32px rgba(62, 93, 136, 0.42)',
        'sf-lg': '0 18px 48px rgba(62, 93, 136, 0.48)',
        'sf-in': 'inset 0 2px 6px rgba(0, 0, 0, 0.18)',
      },
      fontSize: {
        touch: ['1.35rem', { lineHeight: '1.35' }],
        hero: ['2.75rem', { lineHeight: '1.1' }],
      },
      fontFamily: {
        sans: [
          'Assistant',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
