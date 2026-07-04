/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        black: '#0A0A0A',
        void: '#111111',
        surface: '#1A1A1A',
        'surface-hover': '#222222',
        'red-primary': '#FF1A1A',
        'red-glow': '#FF3333',
        'red-dim': '#CC0000',
        'red-dark': '#660000',
        'text-primary': '#E8E8E8',
        'text-secondary': '#888888',
        'text-muted': '#555555',
        'text-dim': '#333333',
        success: '#00FF66',
        warning: '#FFAA00',
        error: '#FF1A1A',
        info: '#00CCFF',
        nexus: '#FF9500',
        goldmine: '#0088FF',
        sara: '#00DD77',
        gapclaw: '#00CCFF',
      },
      fontFamily: {
        display: ['Orbitron', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
        body: ['Inter', 'sans-serif'],
      },
      animation: {
        'scan-down': 'scan-down 8s linear infinite',
        'status-pulse': 'status-pulse 2s ease-in-out infinite',
        'cursor-blink': 'cursor-blink 1s step-end infinite',
        'ticker-scroll': 'ticker-scroll 30s linear infinite',
        'glitch': 'glitch 0.5s ease-in-out',
        'fade-up': 'fade-up 0.4s ease-out',
      },
    },
  },
  plugins: [],
}
