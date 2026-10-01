import devServer from "@hono/vite-dev-server"
import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"

export default defineConfig(({ mode }) => {
  const envVars = loadEnv(mode, process.cwd(), "");
  for (const [k, v] of Object.entries(envVars)) {
    if (!(k in process.env)) process.env[k] = v;
  }
  return {
    base: './',
    plugins: [
      devServer({ entry: "api/boot.ts", exclude: [/^\/(?!api\/).*$/] }),
      react()
    ],
    server: { port: 3000 },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@contracts": path.resolve(__dirname, "./contracts"),
        "@db": path.resolve(__dirname, "./db"),
        "db": path.resolve(__dirname, "./db"),
      },
    },
    envDir: path.resolve(__dirname),
    // Cut log noise on Cloudflare Pages (hundreds of font lines truncated the deploy log).
    logLevel: mode === "production" ? "warn" : "info",
    build: {
      outDir: path.resolve(__dirname, "dist/public"),
      emptyOutDir: true,
      reportCompressedSize: false,
      rollupOptions: {
        output: {
          manualChunks: {
            "react-vendor": ["react", "react-dom", "react-router-dom"],
            "trpc-vendor": ["@trpc/client", "@trpc/react-query", "@trpc/server", "superjson", "@tanstack/react-query"],
            "chart-vendor": ["recharts"],
            "motion-vendor": ["framer-motion"],
            "icon-vendor": ["lucide-react"],
          },
        },
      },
      chunkSizeWarningLimit: 600,
    },
  }
})
