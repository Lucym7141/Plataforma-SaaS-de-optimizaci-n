const { spawn } = require("node:child_process");
const { getE2EEnvironment } = require("./environment");

// Con E2E_CELERY_WORKER=true las pruebas usan Redis y un worker real en lugar
// del modo eager, para cubrir el camino asíncrono completo.
const enabled = process.env.E2E_CELERY_WORKER === "true";
let worker = null;

function startCeleryWorker(python) {
    if (!enabled) return Promise.resolve();

    worker = spawn(
        python,
        [
            "-m", "celery", "-A", "config", "worker",
            "--pool=solo", "--loglevel=info", "--without-gossip",
            "--without-mingle", "--without-heartbeat"
        ],
        {
            cwd: "backend",
            env: {
                ...getE2EEnvironment(),
                CELERY_TASK_ALWAYS_EAGER: "false"
            },
            stdio: ["ignore", "pipe", "pipe"]
        }
    );

    return new Promise((resolve, reject) => {
        let output = "";
        const timer = setTimeout(() => {
            stopCeleryWorker();
            reject(new Error(`El worker de Celery no arrancó a tiempo:\n${output}`));
        }, 60_000);
        const onData = (chunk) => {
            const text = chunk.toString();
            output += text;
            process.stdout.write(`[celery] ${text}`);
            if (/\bready\b/.test(text)) {
                clearTimeout(timer);
                resolve();
            }
        };
        worker.stdout.on("data", onData);
        worker.stderr.on("data", onData);
        worker.once("exit", (code) => {
            clearTimeout(timer);
            reject(new Error(`El worker de Celery terminó con código ${code}:\n${output}`));
        });
        worker.once("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}

function stopCeleryWorker() {
    if (!worker || worker.exitCode !== null) return Promise.resolve();
    const exiting = new Promise((resolve) => worker.once("exit", resolve));
    worker.kill();
    return exiting;
}

module.exports = { celeryWorkerEnabled: enabled, startCeleryWorker, stopCeleryWorker };
