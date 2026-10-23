const { defineConfig, devices } = require("@playwright/test");
const fs = require("node:fs");

const windowsPython = "..\\.venv\\Scripts\\python.exe";
const python = process.env.PYTHON ||
    (process.platform === "win32" && fs.existsSync(`backend\\${windowsPython}`)
        ? windowsPython
        : "python");

module.exports = defineConfig({
    testDir: "./tests/e2e",
    fullyParallel: false,
    workers: 1,
    reporter: "list",
    use: {
        baseURL: "http://127.0.0.1:8000",
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        ...devices["Desktop Chrome"]
    },
    webServer: {
        command: `"${python}" manage.py runserver 127.0.0.1:8000 --noreload`,
        cwd: "backend",
        url: "http://127.0.0.1:8000/health/",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
            ...process.env,
            DJANGO_DEBUG: "true"
        }
    },
    globalSetup: "./tests/e2e/global-setup.js",
    globalTeardown: "./tests/e2e/global-teardown.js"
});
