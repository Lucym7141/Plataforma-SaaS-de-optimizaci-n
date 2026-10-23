const { spawnSync } = require("node:child_process");
const fs = require("node:fs");

module.exports = async () => {
    const windowsPython = "..\\.venv\\Scripts\\python.exe";
    const python = process.env.PYTHON ||
        (process.platform === "win32" && fs.existsSync(`backend\\${windowsPython}`)
            ? windowsPython
            : "python");
    const cleanup = spawnSync(
        python,
        ["../tests/e2e/cleanup_user.py"],
        {
            cwd: "backend",
            encoding: "utf8",
            stdio: "inherit"
        }
    );
    if (cleanup.error) throw cleanup.error;
    if (cleanup.status !== 0) {
        throw new Error(`E2E fixture cleanup failed with exit code ${cleanup.status}.`);
    }
};
