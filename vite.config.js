const { defineConfig } = require("vite");
const path = require("node:path");

module.exports = defineConfig({
    configFile: false,
    build: {
        outDir: path.resolve(__dirname, "frontend/react-build"),
        emptyOutDir: true,
        rollupOptions: {
            input: path.resolve(__dirname, "frontend/react/main.jsx"),
            output: {
                entryFileNames: "react-app.js",
                assetFileNames: "[name][extname]"
            }
        }
    }
});
