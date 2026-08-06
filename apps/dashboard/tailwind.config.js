/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        line: {
          green: '#06C755',
          dark: '#05B34C',
          light: '#E6F9EE'
        }
      }
    },
  },
  plugins: [],
}
