import devServer from "@hono/vite-dev-server"
import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"

export default defineConfig(({ mode }) => {
  // Vite loads .env into import.meta.env (VITE_ prefix only) but does NOT push
  // arbitrary .env keys into process.env for the Hono server module. The server
  // (api/lib/env.ts) reads process.env in dev, so bridge .env → process.env here.
  // Empty prefix loads ALL .env vars (not just VITE_*) and .env.local.
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
    build: {
      outDir: path.resolve(__dirname, "dist/public"),
      emptyOutDir: true,
      // Split the ~930KB single bundle into parallel vendor chunks so the app
      // downloads faster and the "chunk > 500KB" build warning clears. The
      // heavy, stable deps get their own chunks; app code stays together.
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
