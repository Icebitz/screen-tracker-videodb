/** @type {import('tailwindcss').Config} */
const config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          base: "#0c0f14",
          raised: "#141821",
          muted: "#1b212c",
          border: "#343b48",
        },
        signal: {
          red: "#ef4444",
          cyan: "#22d3ee",
          green: "#34d399",
        },
      },
      boxShadow: {
        panel: "0 20px 70px rgba(0, 0, 0, 0.28)",
      },
    },
  },
  plugins: [],
};

module.exports = config;
