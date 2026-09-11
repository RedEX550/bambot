/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#e9fbf0",
          100: "#c8f5da",
          200: "#92ebb8",
          300: "#54dc92",
          400: "#20c56f",
          500: "#00ae42",
          600: "#009038",
          700: "#00722d",
          800: "#045a26",
          900: "#064a21",
        },
        ink: {
          950: "#070b14",
          900: "#0b1120",
          850: "#0f172a",
          800: "#141e33",
          700: "#1e293b",
          600: "#334155",
          500: "#475569",
          400: "#64748b",
          300: "#94a3b8",
          200: "#cbd5e1",
          100: "#e2e8f0",
        },
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Consolas", "monospace"],
      },
      boxShadow: {
        panel: "0 1px 3px rgba(0,0,0,0.35), 0 12px 32px -12px rgba(0,0,0,0.6)",
        glow: "0 0 0 1px rgba(0,174,66,0.35), 0 8px 30px -12px rgba(0,174,66,0.5)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "none" } },
        "slide-up": { from: { opacity: "0", transform: "translateY(12px)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: {
        "fade-in": "fade-in 0.18s ease-out",
        "slide-up": "slide-up 0.22s cubic-bezier(0.22,1,0.36,1)",
      },
    },
  },
  plugins: [],
};
