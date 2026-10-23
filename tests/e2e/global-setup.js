const { spawnSync } = require("node:child_process");
const fs = require("node:fs");

module.exports = async () => {
    const windowsPython = "..\\.venv\\Scripts\\python.exe";
    const python = process.env.PYTHON ||
        (process.platform === "win32" && fs.existsSync(`backend\\${windowsPython}`)
            ? windowsPython
            : "python");
    const result = spawnSync(
        python,
        ["manage.py", "migrate", "--noinput", "--verbosity", "0"],
        {
            cwd: "backend",
            encoding: "utf8",
            stdio: "inherit"
        }
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`Django migrations failed with exit code ${result.status}.`);
    }
    const seed = spawnSync(
        python,
        ["../tests/e2e/seed_user.py"],
        {
            cwd: "backend",
            encoding: "utf8",
            stdio: "inherit",
            env: {
                ...process.env,
                    E2E_TEST_PASSWORD: process.env.E2E_TEST_PASSWORD ||
                        "Local-E2E-Password-947!"
            }
        }
    );
    if (seed.error) throw seed.error;
    if (seed.status !== 0) {
        throw new Error(`E2E user setup failed with exit code ${seed.status}.`);
    }
};
