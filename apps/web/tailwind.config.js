/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        graphite: {
          DEFAULT: "#0b0b0d",
          panel: "#1c1c1e",
        },
        bubble: {
          assistant: "#3a3a3c",
          user: "#0a84ff",
        },
        accent: {
          confirm: "#30d158",
        },
        danger: {
          DEFAULT: "#ff453a",
        },
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "Inter", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
};
