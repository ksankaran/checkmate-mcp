import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "path";

const isDev = process.env.NODE_ENV === "development";
const input = process.env.INPUT;

if (!input) {
  throw new Error("INPUT environment variable is required");
}

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    outDir: "ui",
    emptyOutDir: false,
    sourcemap: isDev ? "inline" : false,
    minify: !isDev,
    cssMinify: !isDev,
    rollupOptions: {
      input: resolve(__dirname, input),
      output: {
        // Force flat output structure
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name].[ext]",
      },
    },
  },
});
