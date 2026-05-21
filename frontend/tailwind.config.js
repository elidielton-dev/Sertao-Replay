/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        "neon-green": "#9DFF00",
        "dark-bg": "#050505",
        "card-bg": "rgba(255, 255, 255, 0.03)",
        "card-border": "rgba(157, 255, 0, 0.3)",
        pitch: {
          950: "#020806",
          900: "#07110d",
          800: "#0b1a14",
          700: "#123326",
        },
        neon: {
          300: "#b9ff67",
          400: "#87ff3f",
          500: "#64e62e",
        },
      },
      boxShadow: {
        glow: "0 0 28px rgba(135, 255, 63, 0.22)",
        card: "0 18px 50px rgba(0, 0, 0, 0.32)",
      },
      fontFamily: {
        sans: ["Inter", "Arial", "Helvetica", "sans-serif"],
        heading: ["Montserrat", "Inter", "Arial", "Helvetica", "sans-serif"],
        anybody: ["Anybody", "Inter", "Arial", "Helvetica", "sans-serif"],
      },
    },
  },
  plugins: [],
};
