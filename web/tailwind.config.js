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
        xs: '0 1px 2px 0 rgb(15 23 42 / 0.06)',
      },
      borderRadius: {
        base: '0.5rem',
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
