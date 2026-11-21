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
        "@": path.resolve(import.meta.dirname, "./src"),
        "@contracts": path.resolve(import.meta.dirname, "./contracts"),
        "@db": path.resolve(import.meta.dirname, "./db"),
        "db": path.resolve(import.meta.dirname, "./db"),
      },
    },
    envDir: path.resolve(import.meta.dirname),
    // Cut log noise on Cloudflare Pages (hundreds of font lines truncated the deploy log).
    logLevel: mode === "production" ? "warn" : "info",
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
      reportCompressedSize: false,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: "react-vendor", test: /node_modules[\\/](react|react-dom|react-router)/ },
              { name: "chart-vendor", test: /node_modules[\\/]recharts/ },
            ],
          },
        },
      },
      chunkSizeWarningLimit: 600,
    },
  }
})
