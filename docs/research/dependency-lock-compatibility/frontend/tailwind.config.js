/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        white: "#FBFAF7",
        neutral: {
          50: "#F7F5F1",
          100: "#F0EEE9",
          200: "#E2DED5",
          300: "#CFC9BF",
          400: "#9A948B",
          500: "#75706A",
          600: "#585450",
          700: "#433F3C",
          800: "#2F2C29",
          900: "#232120",
        },
        emerald: {
          50: "#EAF1EE",
          200: "#C1D7D0",
          600: "#3C7A72",
          700: "#2F6159",
        },
        red: {
          50: "#F6EBEA",
          200: "#E2C7C6",
          600: "#9B3B41",
          700: "#7D2F34",
        },
        amber: {
          50: "#F7F1E4",
          200: "#E3D3B6",
          600: "#A9714B",
          700: "#8A5C3D",
          800: "#6F4A31",
        },
      },
      spacing: {
        5.5: "1.375rem",
      },
    },
  },
  plugins: [],
};
