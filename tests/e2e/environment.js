const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function getE2EDatabasePath() {
    const databasePath = process.env.E2E_DATABASE_PATH;
    const resolvedPath = databasePath && path.resolve(databasePath);

    if (
        !resolvedPath ||
        path.dirname(resolvedPath) !== path.resolve(os.tmpdir()) ||
        !path.basename(resolvedPath).startsWith("vertice-e2e-")
    ) {
        throw new Error("E2E_DATABASE_PATH must target the isolated temp database.");
    }

    return resolvedPath;
}

function getE2EEnvironment() {
    return {
        ...process.env,
        DATABASE_URL: "",
        DJANGO_DEBUG: "true",
        DJANGO_SQLITE_PATH: getE2EDatabasePath()
    };
}

function removeE2EDatabase() {
    const databasePath = getE2EDatabasePath();
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
        fs.rmSync(`${databasePath}${suffix}`, { force: true });
    }
}

module.exports = { getE2EEnvironment, removeE2EDatabase };
