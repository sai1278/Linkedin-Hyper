import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./src/pages/**/*.{js,ts,jsx,tsx,mdx}","./src/components/**/*.{js,ts,jsx,tsx,mdx}","./src/app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#0EA5E9", dark: "#0369A1" },
        surface: { DEFAULT: "#0F172A", elevated: "#1E293B", border: "#334155" },
        text: { primary: "#F1F5F9", secondary: "#94A3B8", muted: "#475569" }
      }
    },
  },
  plugins: [],
};
export default config;
