const { defineConfig, devices } = require("@playwright/test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const windowsPython = "..\\.venv\\Scripts\\python.exe";
const e2ePort = process.env.E2E_PORT || "8001";
const e2eDatabasePath = path.join(
    os.tmpdir(),
    `vertice-e2e-${process.pid}.sqlite3`
);
process.env.E2E_DATABASE_PATH = e2eDatabasePath;
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
        baseURL: `http://127.0.0.1:${e2ePort}`,
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        ...devices["Desktop Chrome"]
    },
    webServer: {
        command: `"${python}" manage.py runserver 127.0.0.1:${e2ePort} --noreload`,
        cwd: "backend",
        url: `http://127.0.0.1:${e2ePort}/health/`,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
            ...process.env,
            DATABASE_URL: "",
            DJANGO_SQLITE_PATH: e2eDatabasePath,
            DJANGO_DEBUG: "true",
            // The serial E2E suite signs in repeatedly from the same IP.
            AUTH_LOGIN_LIMIT: "100/m"
        }
    },
    globalSetup: "./tests/e2e/global-setup.js",
    globalTeardown: "./tests/e2e/global-teardown.js"
});
