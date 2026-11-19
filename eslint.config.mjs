import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
    globalIgnores([
        ".venv/",
        "frontend/vendor/",
        "frontend/react-build/",
        "frontend-vite/",
        "playwright-report/",
        "test-results/"
    ]),
    {
        files: ["frontend/**/*.js"],
        extends: [js.configs.recommended],
        languageOptions: {
            sourceType: "script",
            globals: { ...globals.browser, Chart: "readonly" }
        }
    },
    {
        files: ["frontend/react/**/*.jsx"],
        extends: [js.configs.recommended, reactHooks.configs.flat.recommended],
        languageOptions: {
            globals: globals.browser,
            parserOptions: { ecmaFeatures: { jsx: true } }
        }
    },
    {
        files: ["tests/e2e/**/*.js", "*.config.js"],
        extends: [js.configs.recommended],
        languageOptions: {
            sourceType: "commonjs",
            // Las pruebas E2E ejecutan funciones en el navegador con page.evaluate.
            globals: { ...globals.node, ...globals.browser }
        }
    }
]);
