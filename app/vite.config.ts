import path from "path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// Daemon (API) target for dev proxy. Override with VITE_API_PORT.
const API = `http://127.0.0.1:${process.env.VITE_API_PORT || 3892}`
const API_PATHS = ["/events", "/config", "/voices", "/personas", "/speak", "/skip", "/stop", "/play", "/audio", "/history"]
const proxy = Object.fromEntries(API_PATHS.map((p) => [p, { target: API, changeOrigin: true }]))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: { proxy },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        design: path.resolve(__dirname, "design.html"),
      },
    },
  },
})
