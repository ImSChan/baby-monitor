/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        appBg: "#0B1020",
        cardBg: "#151B2E",
        cardBorder: "#26304A",
        primary: "#6C8CFF",
        softBlue: "#7DA7FF",
        softPurple: "#A78BFA",
      },
      boxShadow: {
        card: "0 10px 30px rgba(0, 0, 0, 0.25)",
      },
    },
  },
  plugins: [],
}