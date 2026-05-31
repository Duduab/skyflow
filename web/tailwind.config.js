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
        sf: 'rgba(0, 0, 0, 0.1) 0px 4px 12px',
        'sf-lg': 'rgba(0, 0, 0, 0.1) 0px 4px 12px',
        'sf-in': 'inset rgba(0, 0, 0, 0.1) 0px 4px 12px',
        xs: 'rgba(0, 0, 0, 0.1) 0px 4px 12px',
      },
      borderRadius: {
        DEFAULT: '1rem',
        none: '0',
        sm: '1rem',
        md: '1rem',
        lg: '1rem',
        xl: '1rem',
        '2xl': '1rem',
        '3xl': '1rem',
        base: '1rem',
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
