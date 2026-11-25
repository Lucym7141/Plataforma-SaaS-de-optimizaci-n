
const API_URL = "/api";

const authPanel = document.getElementById("auth-panel");
const authMessage = document.getElementById("auth-message");
const authTabs = document.querySelector(".auth-tabs");
const loginTab = document.getElementById("login-tab");
const registerTab = document.getElementById("register-tab");
const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const authTitle = document.getElementById("auth-title");
const authSubtitle = document.getElementById("auth-subtitle");
const authHelpActions = document.getElementById("auth-help-actions");
const appContent = document.getElementById("app-content");
const statusLabel = document.getElementById("status-label");
const problemsList = document.getElementById("problems-list");
const refreshButton = document.getElementById("refresh-button");
const emptyState = document.getElementById("empty-state");
const problemContent = document.getElementById("problem-content");
const solveButton = document.getElementById("solve-button");
const errorMessage = document.getElementById("error-message");
const resultsSection = document.getElementById("results-section");

let selectedProblemId = null;
let selectedPortfolioId = null;
let editingPortfolioId = null;
let lastProblemExecutionId = null;
let lastPortfolioExecutionId = null;
let portfolioComparisonExecution = null;
let resetCredentials = null;
let showArchivedProblems = false;
let showArchivedPortfolios = false;
let dashboardCharts = {};
let notificationAccount = "";
let notificationRead = new Set();
let currentNotifications = [];
let notificationStorageWarning = false;
const DASHBOARD_CACHE_MS = 15000;
const dashboardState = {
    data: null,
    lastLoadedAt: 0,
    dirty: true,
    inFlight: null,
    pendingRefresh: false,
    chartSignature: null,
    generation: 0
};

async function requestJSON(url, options = {}) {
    const headers = new Headers(options.headers || {});
    const method = (options.method || "GET").toUpperCase();

    if (method !== "GET" && method !== "HEAD") {
        const csrfToken = document.cookie
            .split("; ")
            .find((cookie) => cookie.startsWith("csrftoken="))
            ?.slice("csrftoken=".length);

        if (csrfToken) {
            headers.set("X-CSRFToken", csrfToken);
        }
    }

    const response = await fetch(url, {
        ...options,
        headers,
        credentials: "same-origin"
    });

    if (response.status === 204) {
        return null;
    }

    let data;

    try {
        data = await response.json();
    } catch {
        throw new Error("El servidor no devolvió una respuesta JSON válida.");
    }

    if (!response.ok) {
        const detail = data.detail || data.error || data.mensaje;
        const message = typeof detail === "string"
            ? detail
            : Object.keys(data).length
                ? JSON.stringify(data)
                : `La solicitud falló con el código ${response.status}.`;
        const error = new Error(message);
        error.status = response.status;
        error.data = data;
        throw error;
    }

    return data;
}

async function waitForOptimizationJob(submission, onUpdate = () => {}) {
    const deadline = Date.now() + 16 * 60 * 1000;
    let delay = 750;
    loadRecentJobs();

    try {
        while (Date.now() < deadline) {
            const job = await requestJSON(submission.status_url);
            if (job.status === "completed") return job.result;
            if (job.status === "failed") {
                throw new Error(job.error || "El cálculo no pudo completarse.");
            }

            onUpdate(job.status);
            await new Promise((resolve) => setTimeout(resolve, delay));
            delay = Math.min(Math.round(delay * 1.5), 2500);
        }
    } finally {
        loadRecentJobs();
    }

    throw new Error(
        "El cálculo sigue en proceso. Consulta Cálculos recientes más tarde."
    );
}

const EXPLAINABLE_STATUSES = new Set(["OPT", "INF", "UNB", "TIME"]);

function explanationElements(target) {
    return {
        section: document.querySelector(`[data-explanation-section="${target}"]`),
        button: document.querySelector(`[data-explain-target="${target}"]`),
        message: document.querySelector(`[data-explanation-message="${target}"]`),
        body: document.querySelector(`[data-explanation-body="${target}"]`)
    };
}

function renderExplanation(target, explanation) {
    const { button, message, body } = explanationElements(target);
    body.replaceChildren();
    const summary = document.createElement("p");
    summary.className = "ai-explanation-summary";
    summary.textContent = explanation.resumen;
    body.append(summary);
    [
        ["Puntos clave", explanation.puntos_clave],
        ["Qué revisar en el modelo", explanation.sugerencias]
    ].forEach(([title, items]) => {
        if (!Array.isArray(items) || !items.length) return;
        const heading = document.createElement("h4");
        heading.textContent = title;
        const list = document.createElement("ul");
        items.forEach((text) => {
            const item = document.createElement("li");
            item.textContent = text;
            list.append(item);
        });
        body.append(heading, list);
    });
    const note = document.createElement("p");
    note.className = "ai-explanation-note";
    note.textContent = target === "portfolio"
        ? "Generado con IA a partir de los resultados calculados. No es asesoría financiera: depende por completo de los supuestos que ingresaste."
        : "Generado con IA a partir de los resultados calculados. Revísalo antes de tomar decisiones.";
    body.append(note);
    body.hidden = false;
    message.hidden = true;
    button.hidden = true;
}

function resetExplanation(target, result) {
    const { section, button, message, body } = explanationElements(target);
    section.hidden = target === "problem" && !EXPLAINABLE_STATUSES.has(result?.estado);
    button.hidden = false;
    button.disabled = false;
    button.textContent = "Explicar con IA";
    message.hidden = true;
    body.hidden = true;
    body.replaceChildren();
    if (result?.explicacion_ia) renderExplanation(target, result.explicacion_ia);
}

async function requestExplanation(target) {
    const { button, message } = explanationElements(target);
    const [segment, parentId, executionId] = target === "problem"
        ? ["problemas", selectedProblemId, lastProblemExecutionId]
        : ["portafolios", selectedPortfolioId, lastPortfolioExecutionId];
    if (parentId === null || executionId === null) {
        message.textContent = "Primero obtén un resultado para explicar.";
        message.classList.add("error-message");
        message.hidden = false;
        return;
    }
    button.disabled = true;
    button.textContent = "Generando explicación...";
    message.hidden = true;
    try {
        const explanation = await requestJSON(
            `${API_URL}/${segment}/${encodeURIComponent(parentId)}/ejecuciones/${encodeURIComponent(executionId)}/explicar/`,
            { method: "POST" }
        );
        renderExplanation(target, explanation);
        refreshPlanSummary();
    } catch (error) {
        message.textContent = `No se pudo explicar el resultado: ${error.message}`;
        message.classList.add("error-message");
        message.hidden = false;
    } finally {
        button.disabled = false;
        button.textContent = "Explicar con IA";
    }
}

document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-explain-target]");
    if (!button) return;
    requestExplanation(button.dataset.explainTarget);
});

const JOB_TYPE_LABELS = {
    problem: "Resolver modelo",
    portfolio: "Optimizar portafolio",
    frontier: "Frontera eficiente"
};
const JOB_STATUS_LABELS = {
    queued: "En cola",
    running: "Calculando",
    completed: "Completado",
    failed: "Fallido"
};
let recentJobsTimer = null;

function renderRecentJobs(jobs) {
    const target = document.getElementById("dashboard-jobs");
    if (!jobs.length) {
        target.innerHTML = `<tr><td class="dashboard-history-empty" colspan="5">
            <span>Aún no hay cálculos. Cuando resuelvas un modelo u optimices un portafolio, aparecerán aquí.</span>
        </td></tr>`;
        return;
    }
    target.innerHTML = jobs.map((job) => {
        const statusLabel = JOB_STATUS_LABELS[job.status] || job.status;
        const action = job.status === "completed" && job.target
            ? `<button class="secondary-button" type="button" data-job-open="${escapeHTML(job.id)}">Ver resultado</button>`
            : "";
        const error = job.status === "failed" && job.error
            ? `<span class="job-error">${escapeHTML(job.error)}</span>`
            : "";
        return `
            <tr data-job-id="${escapeHTML(job.id)}">
                <td><span class="dashboard-history-type">${escapeHTML(JOB_TYPE_LABELS[job.type] || job.type)}</span></td>
                <td>${escapeHTML(job.target?.name || "Eliminado")}</td>
                <td>
                    <span class="job-status job-status-${escapeHTML(job.status)}">${escapeHTML(statusLabel)}</span>
                    ${error}
                </td>
                <td>${escapeHTML(formatDashboardDate(job.completed_at || job.created_at))}</td>
                <td class="job-actions">${action}</td>
            </tr>`;
    }).join("");
}

async function loadRecentJobs() {
    clearTimeout(recentJobsTimer);
    recentJobsTimer = null;
    if (appContent.hidden) return;
    const message = document.getElementById("dashboard-jobs-message");
    try {
        const jobs = await requestJSON(`${API_URL}/trabajos-optimizacion/`);
        if (appContent.hidden) return;
        message.hidden = true;
        renderRecentJobs(jobs);
        // Mientras haya cálculos pendientes, la lista se actualiza sola.
        if (jobs.some((job) => job.status === "queued" || job.status === "running")) {
            recentJobsTimer = setTimeout(loadRecentJobs, 3000);
        }
    } catch (error) {
        if (appContent.hidden) return;
        message.textContent = `No se pudieron cargar los cálculos: ${error.message}`;
        message.classList.add("error-message");
        message.hidden = false;
    }
}

async function openRecentJob(jobId, button) {
    const message = document.getElementById("dashboard-jobs-message");
    button.disabled = true;
    try {
        const job = await requestJSON(
            `${API_URL}/trabajos-optimizacion/${encodeURIComponent(jobId)}/`
        );
        if (job.status !== "completed" || !job.target) {
            throw new Error("Este cálculo no tiene un resultado disponible.");
        }
        if (job.type === "problem") {
            await loadProblem(job.target.id);
            renderProblemResult(job.result);
            document.querySelector(".details-panel")?.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
            return;
        }
        navigateAppView("#portfolio-panel");
        if (job.type === "portfolio") {
            await renderPortfolioResult(job.result, job.target.id);
            document.getElementById("portfolio-result").scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
        } else {
            renderFrontier(job.result);
            document.getElementById("frontier-chart").scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
        }
    } catch (error) {
        message.textContent = `No se pudo abrir el resultado: ${error.message}`;
        message.classList.add("error-message");
        message.hidden = false;
    } finally {
        button.disabled = false;
    }
}

async function downloadExecutionReport(target, format, button) {
    const message = document.querySelector(
        `[data-report-message="${target}"]`
    );
    const executionId = target === "problem"
        ? lastProblemExecutionId
        : lastPortfolioExecutionId;
    const resourceId = target === "problem"
        ? selectedProblemId
        : selectedPortfolioId;
    if (executionId === null || resourceId === null) return;

    const resourcePath = target === "problem" ? "problemas" : "portafolios";
    const resourceKey = target === "problem" ? "problema" : "portafolio";
    const url = `${API_URL}/${resourcePath}/${encodeURIComponent(resourceId)}` +
        `/ejecuciones/${encodeURIComponent(executionId)}/reporte/${format}/`;
    button.disabled = true;
    message.hidden = true;
    try {
        const response = await fetch(url, { credentials: "same-origin" });
        if (!response.ok) {
            let detail = `No se pudo generar el reporte (${response.status}).`;
            try {
                const data = await response.json();
                if (typeof data.detail === "string") detail = data.detail;
            } catch {
                // Keep the HTTP error if the response is not JSON.
            }
            throw new Error(detail);
        }

        const blob = await response.blob();
        const contentDisposition = response.headers.get("Content-Disposition") || "";
        const filename = contentDisposition.match(/filename="([^"]+)"/i)?.[1] ||
            `reporte-${resourceKey}-${executionId}.${format}`;
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = filename;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    } catch (error) {
        message.textContent = error.message;
        message.classList.add("error-message");
        message.hidden = false;
    } finally {
        button.disabled = false;
    }
}

document.querySelectorAll("[data-report-format]").forEach((button) => {
    button.addEventListener("click", () => downloadExecutionReport(
        button.dataset.reportTarget,
        button.dataset.reportFormat,
        button
    ));
});

// Frontera eficiente interactiva: cada punto es una cartera; al pasar el
// cursor, tocar o mover el control se muestra su riesgo, su rendimiento y
// cómo se reparte. Los activos solos y la cartera óptima sirven de referencia.
function niceTicks(min, max, count = 5) {
    const span = max - min || 1;
    const rough = span / count;
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude)
        .find((candidate) => span / candidate <= count) || 10 * magnitude;
    const ticks = [];
    for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-9; value += step) {
        ticks.push(Number(value.toFixed(10)));
    }
    return ticks;
}

function renderFrontier(result) {
    const rawPoints = result.puntos || [];
    if (!rawPoints.length) {
        throw new Error("No se recibieron puntos para la frontera eficiente.");
    }
    const periods = Number(result.periodos_por_anio) || 1;
    const annualReturn = (value) => Number(value) * periods;
    const annualRisk = (value) => Number(value) * Math.sqrt(periods);
    const names = result.activos || [];
    const points = rawPoints.map((point) => ({
        risk: annualRisk(point.volatilidad_portafolio),
        ret: annualReturn(point.rendimientos_portafolio),
        weights: (point.ponderaciones || []).map(Number)
    }));
    const references = (result.referencias_activos || []).map((asset) => ({
        name: asset.nombre,
        risk: annualRisk(asset.volatilidad),
        ret: annualReturn(asset.rendimiento)
    }));
    const optimum = result.cartera_optima
        ? {
            risk: annualRisk(result.cartera_optima.volatilidad_portafolio),
            ret: annualReturn(result.cartera_optima.rendimientos_portafolio),
            weights: (result.cartera_optima.ponderaciones || []).map(Number)
        }
        : null;

    const all = [...points, ...references, ...(optimum ? [optimum] : [])];
    const width = 820;
    const height = 440;
    const pad = { left: 76, right: 28, top: 24, bottom: 64 };
    const riskMax = Math.max(...all.map((item) => item.risk)) * 1.08;
    const retValues = all.map((item) => item.ret);
    const retSpan = Math.max(...retValues) - Math.min(...retValues) || 0.01;
    const retMin = Math.min(0, Math.min(...retValues) - retSpan * 0.08);
    const retMax = Math.max(...retValues) + retSpan * 0.12;
    const x = (value) => pad.left + (value / riskMax) * (width - pad.left - pad.right);
    const y = (value) => height - pad.bottom -
        ((value - retMin) / (retMax - retMin)) * (height - pad.top - pad.bottom);
    const percent = (value) => formatPercent(value, 1);

    const xTicks = niceTicks(0, riskMax);
    const yTicks = niceTicks(retMin, retMax);
    const grid = [
        ...xTicks.map((tick) => `
            <line class="frontier-grid" x1="${x(tick)}" y1="${pad.top}" x2="${x(tick)}" y2="${height - pad.bottom}"></line>
            <text class="chart-tick" x="${x(tick)}" y="${height - pad.bottom + 22}" text-anchor="middle">${escapeHTML(percent(tick))}</text>`),
        ...yTicks.map((tick) => `
            <line class="frontier-grid" x1="${pad.left}" y1="${y(tick)}" x2="${width - pad.right}" y2="${y(tick)}"></line>
            <text class="chart-tick" x="${pad.left - 10}" y="${y(tick) + 4}" text-anchor="end">${escapeHTML(percent(tick))}</text>`)
    ].join("");
    const curve = points.map((point) => `${x(point.risk).toFixed(1)},${y(point.ret).toFixed(1)}`).join(" ");
    const area = `M${x(points[0].risk).toFixed(1)},${(height - pad.bottom).toFixed(1)} L${curve.replace(/ /g, " L")} L${x(points[points.length - 1].risk).toFixed(1)},${(height - pad.bottom).toFixed(1)} Z`;
    const assetDots = references.map((asset) => `
        <g class="frontier-asset">
            <circle cx="${x(asset.risk)}" cy="${y(asset.ret)}" r="6"></circle>
            <text x="${x(asset.risk) + 10}" y="${y(asset.ret) - 8}">${escapeHTML(asset.name)}</text>
        </g>`).join("");
    const optimumMarker = optimum ? `
        <g class="frontier-optimum">
            <rect x="${x(optimum.risk) - 7}" y="${y(optimum.ret) - 7}" width="14" height="14" transform="rotate(45 ${x(optimum.risk)} ${y(optimum.ret)})"></rect>
            <text x="${x(optimum.risk) - 12}" y="${y(optimum.ret) - 14}" text-anchor="end">Tu óptimo</text>
        </g>` : "";

    const chart = document.getElementById("frontier-chart");
    chart.innerHTML = `
        <div class="frontier-layout">
            <div class="frontier-plot">
                <svg class="frontier-svg" viewBox="0 0 ${width} ${height}" role="img"
                    aria-label="Frontera eficiente: riesgo anual frente a rendimiento esperado anual de ${points.length} carteras">
                    <defs>
                        <linearGradient id="frontier-fill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stop-color="currentColor" stop-opacity="0.18"></stop>
                            <stop offset="100%" stop-color="currentColor" stop-opacity="0"></stop>
                        </linearGradient>
                    </defs>
                    ${grid}
                    <line class="chart-axis" x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}"></line>
                    <line class="chart-axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}"></line>
                    <path class="frontier-area" d="${area}"></path>
                    <polyline class="frontier-line" points="${curve}"></polyline>
                    ${points.map((point) => `<circle class="frontier-point" cx="${x(point.risk)}" cy="${y(point.ret)}" r="3.5"></circle>`).join("")}
                    ${assetDots}
                    <g class="frontier-cursor">
                        <line data-cursor-line y1="${pad.top}" y2="${height - pad.bottom}"></line>
                        <circle data-cursor-dot r="9"></circle>
                    </g>
                    ${optimumMarker}
                    <text class="chart-label" x="${(pad.left + width - pad.right) / 2}" y="${height - 14}" text-anchor="middle">Riesgo anual (volatilidad)</text>
                    <text class="chart-label" transform="translate(18 ${(pad.top + height - pad.bottom) / 2}) rotate(-90)" text-anchor="middle">Rendimiento esperado anual</text>
                    <rect class="frontier-hit" x="${pad.left}" y="${pad.top}" width="${width - pad.left - pad.right}" height="${height - pad.top - pad.bottom}"></rect>
                </svg>
                <div class="frontier-legend" aria-hidden="true">
                    <span><i class="legend-line"></i> Carteras eficientes</span>
                    ${references.length ? '<span><i class="legend-asset"></i> Cada activo por separado</span>' : ""}
                    ${optimum ? '<span><i class="legend-optimum"></i> Tu cartera óptima</span>' : ""}
                </div>
                <label class="frontier-slider">
                    <span>Menos riesgo</span>
                    <input type="range" min="0" max="${points.length - 1}" step="1" data-frontier-slider
                        aria-label="Elige el nivel de riesgo de la cartera">
                    <span>Más riesgo</span>
                </label>
            </div>
            <aside class="frontier-detail" aria-live="polite" data-frontier-detail></aside>
        </div>`;

    const svg = chart.querySelector("svg");
    const slider = chart.querySelector("[data-frontier-slider]");
    const detail = chart.querySelector("[data-frontier-detail]");
    const cursorLine = chart.querySelector("[data-cursor-line]");
    const cursorDot = chart.querySelector("[data-cursor-dot]");

    const describe = (index) => {
        const point = points[index];
        const allocation = point.weights
            .map((weight, assetIndex) => ({ name: names[assetIndex] || `Activo ${assetIndex + 1}`, weight }))
            .filter((entry) => entry.weight >= 0.005)
            .sort((first, second) => second.weight - first.weight);
        let comparison = "";
        if (optimum) {
            const deltaReturn = (point.ret - optimum.ret) * 100;
            const deltaRisk = (point.risk - optimum.risk) * 100;
            const signed = (value) => `${value >= 0 ? "+" : "−"}${formatMetric(Math.abs(value), 1)}`;
            comparison = Math.abs(deltaReturn) < 0.05 && Math.abs(deltaRisk) < 0.05
                ? '<p class="frontier-compare">Muy cerca de tu cartera óptima: casi el mismo riesgo y rendimiento.</p>'
                : `<p class="frontier-compare">Frente a tu óptimo: <strong>${signed(deltaReturn)} pts</strong> de rendimiento y <strong>${signed(deltaRisk)} pts</strong> de riesgo.</p>`;
        }
        detail.innerHTML = `
            <p class="frontier-detail-title">Cartera ${index + 1} de ${points.length}</p>
            <div class="frontier-detail-kpis">
                <div><span>Rendimiento anual</span><strong>${percent(point.ret)}</strong></div>
                <div><span>Riesgo anual</span><strong>${percent(point.risk)}</strong></div>
            </div>
            ${comparison}
            <ul class="frontier-weights">
                ${allocation.map((entry) => `
                    <li>
                        <span class="frontier-weight-name">${escapeHTML(entry.name)}</span>
                        <span class="allocation-bar is-weight" aria-hidden="true"><span style="width:${(entry.weight * 100).toFixed(2)}%"></span></span>
                        <strong>${formatPercent(entry.weight, 1)}</strong>
                    </li>`).join("")}
            </ul>`;
    };

    const select = (index) => {
        const point = points[index];
        cursorLine.setAttribute("x1", x(point.risk));
        cursorLine.setAttribute("x2", x(point.risk));
        cursorDot.setAttribute("cx", x(point.risk));
        cursorDot.setAttribute("cy", y(point.ret));
        slider.value = String(index);
        slider.setAttribute("aria-valuetext",
            `Riesgo ${percent(point.risk)}, rendimiento ${percent(point.ret)}`);
        describe(index);
    };

    const nearestByRisk = (risk) => points.reduce((best, point, index) =>
        (Math.abs(point.risk - risk) < Math.abs(points[best].risk - risk) ? index : best), 0);

    const fromPointer = (event) => {
        const box = svg.getBoundingClientRect();
        const svgX = ((event.clientX - box.left) / box.width) * width;
        const risk = ((svgX - pad.left) / (width - pad.left - pad.right)) * riskMax;
        select(nearestByRisk(risk));
    };
    svg.addEventListener("pointermove", fromPointer);
    svg.addEventListener("pointerdown", fromPointer);
    slider.addEventListener("input", () => select(Number(slider.value)));

    select(optimum ? nearestByRisk(optimum.risk) : Math.floor(points.length / 2));
    document.getElementById("frontier-section").hidden = false;
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function formatNumber(value) {
    if (value === null || value === undefined || value === "") {
        return "—";
    }

    const number = Number(value);

    if (!Number.isFinite(number)) {
        return String(value);
    }

    return new Intl.NumberFormat("es-CO", {
        maximumFractionDigits: 6
    }).format(number);
}

function renderPortfolioComparisonInputs(execution) {
    const snapshot = execution.modelo_snapshot;
    const weights = document.getElementById("portfolio-comparison-weights");
    const message = document.getElementById("portfolio-comparison-message");
    const results = document.getElementById("portfolio-comparison-results");
    portfolioComparisonExecution = execution;
    message.hidden = true;
    message.textContent = "";
    results.hidden = true;
    results.innerHTML = "";
    weights.innerHTML = snapshot.activos.map((asset, index) => `
        <label>
            ${escapeHTML(asset)} (%)
            <input
                type="number"
                name="peso-${index}"
                min="0"
                max="100"
                step="any"
                required
                aria-label="Peso actual de ${escapeHTML(asset)} (%)"
            >
        </label>
    `).join("");
    document.getElementById("portfolio-comparison").hidden = false;
}

function renderGeneralRiskReview(snapshot, currentWeights, execution) {
    const alerts = [];
    const optimizedWeights = execution.ponderaciones.map(Number);
    for (const [label, weights] of [
        ["actual", currentWeights],
        ["óptima", optimizedWeights]
    ]) {
        const largestWeight = Math.max(...weights);
        if (largestWeight > 0.5) {
            const asset = snapshot.activos[weights.indexOf(largestWeight)];
            alerts.push(
                `Concentración ${label}: ${escapeHTML(asset)} representa ${formatNumber(largestWeight * 100)} % de la cartera.`
            );
        }
    }

    const minimums = (snapshot.pesos_minimos || []).map(Number);
    const maximums = (snapshot.pesos_maximos || []).map(Number);
    const weightViolations = currentWeights.flatMap((weight, index) => {
        const min = minimums[index] ?? 0;
        const max = maximums[index] ?? 1;
        if (weight < min - 0.0001 || weight > max + 0.0001) {
            return [escapeHTML(snapshot.activos[index])];
        }
        return [];
    });
    if (weightViolations.length) {
        alerts.push(
            `La distribución actual excede los límites configurados para: ${weightViolations.join(", ")}.`
        );
    }

    const categoryLimits = snapshot.limites_categoria || {};
    for (const [category, cap] of Object.entries(categoryLimits)) {
        const categoryWeight = (snapshot.categorias || []).reduce(
            (sum, assetCategory, index) =>
                sum + (assetCategory === category ? currentWeights[index] : 0),
            0
        );
        if (categoryWeight > Number(cap) + 0.0001) {
            alerts.push(
                `La distribución actual supera el límite configurado para la categoría ${escapeHTML(category)}.`
            );
        }
    }

    const scenarios = snapshot.escenarios_estres || {};
    const scenarioRows = Object.entries(scenarios).map(([name, assetReturns]) => {
        const currentReturn = assetReturns.reduce(
            (sum, assetReturn, index) =>
                sum + Number(assetReturn) * currentWeights[index],
            0
        );
        const optimalReturn = Number(execution.resultados_estres?.[name]);
        if (currentReturn < 0 || optimalReturn < 0) {
            alerts.push(
                `El escenario simulado «${escapeHTML(name)}» produce un rendimiento negativo.`
            );
        }
        return `
            <tr>
                <th scope="row">${escapeHTML(name)}</th>
                <td>${formatNumber(currentReturn * 100)} %</td>
                <td>${formatNumber(optimalReturn * 100)} %</td>
            </tr>`;
    });
    if (!scenarioRows.length) {
        alerts.push("No hay escenarios de estrés configurados para estimar pérdidas hipotéticas.");
    }
    if (!alerts.length) {
        alerts.push("No se detectaron alertas en las comprobaciones generales configuradas.");
    }

    return `
        <section class="risk-review" aria-labelledby="risk-review-title">
            <h5 id="risk-review-title">Alertas generales de riesgo</h5>
            <p class="muted">
                Indicadores orientativos, no una verificación de cumplimiento regulatorio ni asesoría financiera.
                La alerta de concentración usa un umbral interno del 50 %.
            </p>
            <ul class="risk-alert-list" role="status">
                ${alerts.map((alert) => `<li>${alert}</li>`).join("")}
            </ul>
            ${scenarioRows.length
                ? `<div class="table-scroll">
                    <table class="comparison-table risk-scenarios-table">
                        <caption>Rendimiento simulado por escenario de estrés</caption>
                        <thead>
                            <tr><th scope="col">Escenario</th><th scope="col">Actual</th><th scope="col">Óptimo</th></tr>
                        </thead>
                        <tbody>${scenarioRows.join("")}</tbody>
                    </table>
                </div>`
                : ""}
        </section>`;
}

function comparePortfolioScenarios(event) {
    event.preventDefault();
    const message = document.getElementById("portfolio-comparison-message");
    const results = document.getElementById("portfolio-comparison-results");
    const execution = portfolioComparisonExecution;
    if (!execution) return;

    const snapshot = execution.modelo_snapshot;
    const form = event.currentTarget;
    const weights = snapshot.activos.map((_, index) =>
        Number(form.elements[`peso-${index}`].value) / 100
    );
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (Math.abs(total - 1) > 0.0001) {
        message.textContent = `La distribución actual debe sumar 100 % (ahora suma ${formatNumber(total * 100)} %).`;
        message.classList.add("error-message");
        message.hidden = false;
        results.hidden = true;
        return;
    }

    const expectedReturns = snapshot.rendimientos_esperados.map(Number);
    const covariance = snapshot.covarianza.map((row) => row.map(Number));
    const expectedReturn = expectedReturns.reduce(
        (sum, assetReturn, index) => sum + assetReturn * weights[index],
        0
    );
    const variance = weights.reduce((sum, weight, rowIndex) =>
        sum + weight * covariance[rowIndex].reduce(
            (rowSum, value, columnIndex) =>
                rowSum + value * weights[columnIndex],
            0
        ),
    0);
    if (!Number.isFinite(variance) || variance < -1e-10) {
        message.textContent = "No se pudo calcular el riesgo de la distribución actual.";
        message.classList.add("error-message");
        message.hidden = false;
        results.hidden = true;
        return;
    }

    const periods = Number(snapshot.periodos_por_anio || 1);
    const current = {
        expectedReturn,
        volatility: Math.sqrt(Math.max(variance, 0)),
        utility: expectedReturn - Number(snapshot.aversion_riesgo) * variance
    };
    const optimal = {
        expectedReturn: Number(execution.rendimientos_portafolio),
        volatility: Number(execution.volatilidad_portafolio),
        utility: Number(execution.utilidad_riesgo)
    };
    const comparisons = [
        ["Rendimiento esperado del período", current.expectedReturn, optimal.expectedReturn],
        ["Rendimiento anualizado (aprox.)", current.expectedReturn * periods, optimal.expectedReturn * periods],
        ["Volatilidad del período", current.volatility, optimal.volatility],
        ["Volatilidad anualizada (aprox.)", current.volatility * Math.sqrt(periods), optimal.volatility * Math.sqrt(periods)],
        ["Utilidad ajustada por riesgo", current.utility, optimal.utility]
    ];
    const percentageRows = new Set([0, 1, 2, 3]);
    const allocationRows = snapshot.activos.map((asset, index) => {
        const actualPercent = weights[index] * 100;
        const optimalPercent = Number(execution.ponderaciones[index]) * 100;
        const renderAllocation = (label, value, className) => `
            <div class="allocation-value">
                <span>${label}: ${formatNumber(value)} %</span>
                <div class="allocation-bar-track" aria-hidden="true">
                    <span class="${className}" style="width: ${Math.min(value, 100)}%"></span>
                </div>
            </div>`;
        return `
            <div class="allocation-chart-row">
                <strong>${escapeHTML(asset)}</strong>
                ${renderAllocation("Actual", actualPercent, "allocation-bar-current")}
                ${renderAllocation("Óptimo", optimalPercent, "allocation-bar-optimal")}
            </div>`;
    }).join("");
    results.innerHTML = `
        <table class="comparison-table">
            <caption>Comparación estimada: cartera actual y cartera óptima</caption>
            <thead>
                <tr>
                    <th scope="col">Métrica</th>
                    <th scope="col">Actual</th>
                    <th scope="col">Óptimo</th>
                    <th scope="col">Cambio</th>
                </tr>
            </thead>
            <tbody>
                ${comparisons.map(([label, actual, optimalValue], index) => {
                    const actualDisplay = percentageRows.has(index)
                        ? `${formatNumber(actual * 100)} %`
                        : formatNumber(actual);
                    const optimalDisplay = percentageRows.has(index)
                        ? `${formatNumber(optimalValue * 100)} %`
                        : formatNumber(optimalValue);
                    const difference = optimalValue - actual;
                    const differenceDisplay = percentageRows.has(index)
                        ? `${difference > 0 ? "+" : ""}${formatNumber(difference * 100)} puntos porcentuales`
                        : `${difference > 0 ? "+" : ""}${formatNumber(difference)}`;
                    return `
                        <tr>
                            <th scope="row">${label}</th>
                            <td>${actualDisplay}</td>
                            <td>${optimalDisplay}</td>
                            <td>${differenceDisplay}</td>
                        </tr>`;
                }).join("")}
            </tbody>
        </table>
        <section class="allocation-chart" aria-labelledby="allocation-chart-title">
            <h5 id="allocation-chart-title">Distribución de capital por activo</h5>
            <div class="allocation-chart-legend" aria-hidden="true">
                <span><i class="allocation-bar-current"></i> Actual</span>
                <span><i class="allocation-bar-optimal"></i> Óptimo</span>
            </div>
            ${allocationRows}
        </section>
        ${renderGeneralRiskReview(snapshot, weights, execution)}`;
    message.classList.remove("error-message");
    message.textContent = "Comparación calculada con los supuestos guardados para este portafolio.";
    message.hidden = false;
    results.hidden = false;
}

function getVariableName(term, variables = []) {
    if (term.variable_nombre) {
        return term.variable_nombre;
    }

    const variable = variables.find(
        (item) => String(item.id) === String(term.variable)
    );

    return variable?.nombre || `Variable ${term.variable}`;
}

// Nombres de variables con notación matemática: x_A1 → x con subíndice A1.
function mathName(name) {
    const text = String(name ?? "");
    const match = text.match(/^([A-Za-z]{1,2})_([A-Za-z0-9]{1,8})$/);
    if (match) {
        return `<span class="math-var"><i>${escapeHTML(match[1])}</i><sub>${escapeHTML(match[2])}</sub></span>`;
    }
    if (/^[A-Za-z]{1,2}\d{0,3}$/.test(text)) {
        return `<span class="math-var"><i>${escapeHTML(text)}</i></span>`;
    }
    return `<span class="math-var">${escapeHTML(text)}</span>`;
}

// «horas_trabajo» → «Horas trabajo» para títulos legibles.
function humanizeName(name) {
    const text = String(name ?? "").replace(/_/g, " ").trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function formatExpressionHTML(terms, variables = []) {
    const visible = (terms || []).filter((term) => {
        const coefficient = Number(term.coeficiente);
        return !Number.isFinite(coefficient) || coefficient !== 0;
    });
    if (!visible.length) return "0";
    return visible.map((term, index) => {
        const coefficient = Number(term.coeficiente);
        const name = mathName(getVariableName(term, variables));
        if (!Number.isFinite(coefficient)) {
            return `${escapeHTML(term.coeficiente)} · ${name}`;
        }
        const absolute = Math.abs(coefficient);
        const part = absolute === 1 ? name : `${escapeHTML(formatNumber(absolute))} · ${name}`;
        if (index === 0) return coefficient < 0 ? `−${part}` : part;
        return `${coefficient < 0 ? "−" : "+"} ${part}`;
    }).join(" ");
}

function getVariableType(type) {
    const types = {
        CONT: "Continua",
        ENT: "Entera",
        BIN: "Binaria"
    };

    return types[type] || type || "No especificado";
}

function getOperator(operator) {
    const operators = {
        LE: "≤",
        GE: "≥",
        EQ: "="
    };

    return operators[operator] || operator || "?";
}

function getObjectiveLabel(type) {
    return type === "MIN" ? "Minimizar" : "Maximizar";
}

function getProblemId(problem) {
    return problem.id ?? problem.pk;
}

function showAuthentication(message = "", tone = "info") {
    document.body.classList.remove("authenticated");
    setNotificationsOpen(false);
    authPanel.hidden = false;
    appContent.hidden = true;
    statusLabel.hidden = true;
    setPremiumLabel(false);
    document.getElementById("demo-banner").hidden = true;
    resetDashboard();
    if (!resetCredentials) {
        authHelpActions.hidden = false;
        setAuthTab("login");
    }
    setAuthMessage(message, tone);
}

function setAuthMessage(message, tone = "info") {
    authMessage.classList.remove("error-message", "success-message", "info-message");
    if (!message) {
        authMessage.textContent = "";
        authMessage.hidden = true;
        return;
    }

    const activeTone = ["error", "success", "info"].includes(tone) ? tone : "info";
    authMessage.classList.add(`${activeTone}-message`);
    authMessage.setAttribute("role", activeTone === "error" ? "alert" : "status");
    authMessage.setAttribute(
        "aria-live",
        activeTone === "error" ? "assertive" : "polite"
    );
    authMessage.textContent = message;
    authMessage.hidden = false;
}

function showAuthMessage(message, isError = false) {
    setAuthMessage(message, isError ? "error" : "success");
}

const AUTH_TAB_COPY = {
    login: {
        title: "Inicia sesión",
        subtitle: "Tus problemas y resultados solo estarán disponibles para tu cuenta."
    },
    register: {
        title: "Crea tu cuenta",
        subtitle: "Crea tu espacio privado para modelar y analizar portafolios."
    }
};

function setAuthTab(tabName, { focus = false } = {}) {
    const isRegister = tabName === "register";
    const activeTab = isRegister ? registerTab : loginTab;
    if (!activeTab || activeTab.hidden) return;

    loginTab.classList.toggle("selected", !isRegister);
    registerTab.classList.toggle("selected", isRegister);
    loginTab.setAttribute("aria-selected", String(!isRegister));
    registerTab.setAttribute("aria-selected", String(isRegister));
    loginTab.tabIndex = isRegister ? -1 : 0;
    registerTab.tabIndex = isRegister ? 0 : -1;
    loginForm.hidden = isRegister;
    registerForm.hidden = !isRegister;
    authTitle.textContent = AUTH_TAB_COPY[isRegister ? "register" : "login"].title;
    authSubtitle.textContent =
        AUTH_TAB_COPY[isRegister ? "register" : "login"].subtitle;
    setAuthMessage("");
    closeAuthHelpPanels();
    if (focus) activeTab.focus();
}

function closeAuthHelpPanels() {
    [
        ["resend-verification-button", "resend-verification-form"],
        ["password-reset-button", "password-reset-form"]
    ].forEach(([buttonId, formId]) => {
        const button = document.getElementById(buttonId);
        const form = document.getElementById(formId);
        if (!button || !form) return;
        form.hidden = true;
        button.setAttribute("aria-expanded", "false");
    });
}

function toggleAuthHelpPanel(button, form) {
    const willOpen = form.hidden;
    closeAuthHelpPanels();
    if (!willOpen) {
        button.focus();
        return;
    }

    setAuthMessage("");
    form.hidden = false;
    button.setAttribute("aria-expanded", "true");
    form.querySelector("input")?.focus();
}

function setPasswordVisibility(button, visible) {
    const input = document.getElementById(button.dataset.passwordToggle);
    if (!input) return;
    input.type = visible ? "text" : "password";
    button.textContent = visible ? "Ocultar" : "Mostrar";
    button.setAttribute("aria-pressed", String(visible));
    button.setAttribute(
        "aria-label",
        visible ? "Ocultar contraseña" : "Mostrar contraseña"
    );
}

function resetPasswordToggles(form) {
    form.querySelectorAll("[data-password-toggle]").forEach((button) => {
        setPasswordVisibility(button, false);
    });
}

function startAuthFormBusy(form, loadingLabel) {
    const submit = form.querySelector('button[type="submit"]');
    if (!submit || form.dataset.busy === "true") return null;

    form.dataset.busy = "true";
    form.setAttribute("aria-busy", "true");
    submit.dataset.idleLabel = submit.textContent;
    submit.textContent = loadingLabel;
    submit.disabled = true;
    submit.classList.add("is-loading");
    return submit;
}

function finishAuthFormBusy(form) {
    const submit = form.querySelector('button[type="submit"]');
    form.dataset.busy = "false";
    form.removeAttribute("aria-busy");
    if (!submit) return;

    if (submit.dataset.idleLabel) {
        submit.textContent = submit.dataset.idleLabel;
        delete submit.dataset.idleLabel;
    }
    submit.disabled = false;
    submit.classList.remove("is-loading");
}

// En la pantalla de acceso el enlace a planes es discreto; dentro de la app invita
// a mejorar el plan.
function setPremiumLabel(authenticated) {
    const label = document.getElementById("premium-label");
    if (label) label.textContent = authenticated ? "Hazte premium" : "Ver planes";
}

function showApplication(user) {
    document.body.classList.add("authenticated");
    setPremiumLabel(true);
    document.getElementById("demo-banner").hidden = !user.es_demo;
    authPanel.hidden = true;
    appContent.hidden = false;
    syncAppView();
    statusLabel.hidden = true;
    const username = user.username || "Usuario";
    if (notificationAccount !== username) {
        notificationAccount = username;
        try {
            const saved = JSON.parse(
                localStorage.getItem(getNotificationStorageKey()) || "[]"
            );
            if (!Array.isArray(saved) || saved.some((key) => typeof key !== "string")) {
                throw new Error("El estado guardado de notificaciones no es válido.");
            }
            notificationRead = new Set(saved);
            notificationStorageWarning = false;
        } catch {
            notificationRead = new Set();
            notificationStorageWarning = true;
        }
    }
    document.getElementById("account-name").textContent =
        `Conectado como ${username}`;
    renderUserProfile({
        nombre_visible: "",
        descripcion: "",
        foto_url: null
    }, username);
    document.getElementById("dashboard-date").textContent =
        new Intl.DateTimeFormat("es-CO", {
            dateStyle: "full"
        }).format(new Date());
    const footerYear = document.getElementById("footer-year");
    if (footerYear) footerYear.textContent = new Date().getFullYear();
    invalidateDashboard();
    loadPortfolios();
    loadDashboard({ force: true });
    loadUserProfile(username);
}

let profileFallbackName = "Usuario";
let profileSnapshot = { nombre_visible: "", descripcion: "", foto_url: null };
let profilePreviewUrl = null;
let profileSaving = false;

function updateProfilePreview() {
    const displayName =
        document.getElementById("profile-display-name").value.trim() ||
        profileFallbackName;
    const description =
        document.getElementById("profile-description").value.trim();
    const imageUrl = profilePreviewUrl || profileSnapshot.foto_url;
    window.profilePreviewData = {
        displayName,
        description,
        imageUrl: imageUrl && !profilePreviewUrl
            ? `${imageUrl}?v=${Date.now()}`
            : imageUrl,
    };
    document.getElementById("profile-name-count").textContent =
        `${document.getElementById("profile-display-name").value.length}/80`;
    document.getElementById("profile-description-count").textContent =
        `${document.getElementById("profile-description").value.length}/240`;
    window.dispatchEvent(new Event("profile:preview"));
}

window.addEventListener("profile:preview-ready", updateProfilePreview);

function updateProfileFormState() {
    const name = document.getElementById("profile-display-name").value;
    const description = document.getElementById("profile-description").value;
    const hasChanges = Boolean(profilePhotoInput?.files.length) ||
        name !== (profileSnapshot.nombre_visible || "") ||
        description !== (profileSnapshot.descripcion || "");
    profileForm.querySelector("button[type='submit']").disabled =
        profileSaving || !hasChanges;
    document.getElementById("profile-reset").disabled =
        profileSaving || !hasChanges;
    const removePhotoButton = document.getElementById("profile-remove-photo");
    removePhotoButton.hidden = !profileSnapshot.foto_url;
    removePhotoButton.disabled =
        profileSaving || Boolean(profilePhotoInput?.files.length);
    updateProfilePreview();
}

function renderUserProfile(profile, username) {
    profileFallbackName = username || "Usuario";
    profileSnapshot = {
        nombre_visible: profile.nombre_visible || "",
        descripcion: profile.descripcion || "",
        foto_url: profile.foto_url || null
    };
    const displayName = profile.nombre_visible?.trim() || username;
    document.getElementById("dashboard-greeting").textContent =
        `Escritorio de ${displayName}`;
    document.getElementById("dashboard-user-name").textContent = displayName;
    const avatar = document.getElementById("dashboard-user-avatar");
    const photo = document.getElementById("dashboard-user-photo");
    avatar.textContent = displayName.charAt(0).toUpperCase() || "U";
    avatar.hidden = Boolean(profile.foto_url);
    photo.hidden = !profile.foto_url;
    if (profile.foto_url) {
        photo.src = `${profile.foto_url}?v=${Date.now()}`;
    } else {
        photo.removeAttribute("src");
    }
    const bio = document.getElementById("dashboard-user-bio");
    bio.textContent = profile.descripcion || "";
    bio.hidden = !profile.descripcion;
    document.getElementById("sidebar-user-name").textContent = displayName;
    const sidebarAvatar = document.getElementById("sidebar-user-avatar");
    const sidebarPhoto = document.getElementById("sidebar-user-photo");
    sidebarAvatar.textContent = displayName.charAt(0).toUpperCase() || "U";
    sidebarAvatar.hidden = Boolean(profile.foto_url);
    sidebarPhoto.hidden = !profile.foto_url;
    if (profile.foto_url) {
        sidebarPhoto.src = `${profile.foto_url}?v=${Date.now()}`;
    } else {
        sidebarPhoto.removeAttribute("src");
    }
    document.getElementById("profile-display-name").value =
        profile.nombre_visible || "";
    document.getElementById("profile-description").value =
        profile.descripcion || "";
    updateProfileFormState();
    renderPlanSummary(profile.plan);
}

function describePlanUsage(used, limit, singular, plural) {
    if (limit === null || limit === undefined) {
        return `${used} ${used === 1 ? singular : plural} · sin límite`;
    }
    return `${used} de ${limit} ${limit === 1 ? singular : plural}`;
}

function renderPlanSummary(plan) {
    const section = document.getElementById("profile-plan");
    if (!plan) {
        section.hidden = true;
        return;
    }
    document.getElementById("profile-plan-name").textContent = plan.unlimited
        ? `${plan.name} · Sin límites`
        : plan.name;
    const usage = document.getElementById("profile-plan-usage");
    usage.replaceChildren();
    const rows = [
        describePlanUsage(plan.usage.models, plan.limits.models,
            "modelo", "modelos"),
        describePlanUsage(plan.usage.portfolios, plan.limits.portfolios,
            "portafolio", "portafolios"),
        plan.limits.assets_per_portfolio === null
            ? "Activos por portafolio: sin límite"
            : `Hasta ${plan.limits.assets_per_portfolio} activos por portafolio`,
        describePlanUsage(plan.usage.ai_requests_this_month,
            plan.limits.ai_requests_per_month,
            "consulta de IA este mes", "consultas de IA este mes")
    ];
    rows.forEach((text) => {
        const item = document.createElement("li");
        item.textContent = text;
        usage.append(item);
    });
    section.hidden = false;
}

async function refreshPlanSummary() {
    try {
        const profile = await requestJSON(`${API_URL}/profile/`);
        if (!appContent.hidden) renderPlanSummary(profile.plan);
    } catch {
        // El resumen del plan es informativo; un fallo aquí no bloquea nada.
    }
}

async function loadUserProfile(username) {
    try {
        const profile = await requestJSON(`${API_URL}/profile/`);
        if (appContent.hidden) return;
        renderUserProfile(profile, username);
    } catch (error) {
        if (appContent.hidden) return;
        const message = document.getElementById("profile-message");
        message.textContent = `No se pudo cargar el perfil: ${error.message}`;
        message.classList.add("error-message");
        message.hidden = false;
    }
}

function showProfileMessage(message, isError = false) {
    const target = document.getElementById("profile-message");
    target.textContent = message;
    target.classList.toggle("error-message", isError);
    target.hidden = !message;
}

async function submitAuthentication(event, endpoint) {
    event.preventDefault();
    const form = event.currentTarget;
    const isRegister = endpoint === "registro";
    const submit = startAuthFormBusy(
        form,
        isRegister ? "Creando cuenta…" : "Iniciando sesión…"
    );
    if (!submit) return;

    setAuthMessage("");
    const payload = Object.fromEntries(new FormData(form).entries());

    try {
        const user = await requestJSON(`${API_URL}/auth/${endpoint}/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        if (isRegister) {
            showAuthMessage(user.detail || "Revisa tu correo para activar la cuenta.");
            form.reset();
            resetPasswordToggles(form);
            return;
        }
        showApplication(user);
        await loadProblems();
    } catch (error) {
        showAuthMessage(error.message, true);
    } finally {
        finishAuthFormBusy(form);
    }
}

async function submitAuthRequest(event, endpoint, successMessage) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = startAuthFormBusy(
        form,
        endpoint === "verify/resend" ? "Reenviando…" : "Enviando…"
    );
    if (!submit) return;

    setAuthMessage("");
    const payload = Object.fromEntries(new FormData(form).entries());
    try {
        const response = await requestJSON(`${API_URL}/auth/${endpoint}/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        showAuthMessage(response.detail || successMessage);
        form.reset();
    } catch (error) {
        showAuthMessage(error.message, true);
    } finally {
        finishAuthFormBusy(form);
    }
}

const HISTORY_VISIBLE_ROWS = 6;

function formatPercent(fraction, digits = 2) {
    const number = Number(fraction);
    if (fraction === null || fraction === undefined || !Number.isFinite(number)) {
        return "—";
    }
    return `${new Intl.NumberFormat("es-CO", {
        maximumFractionDigits: digits
    }).format(number * 100)} %`;
}

// Decimales según la magnitud: los resultados grandes se muestran a 2 decimales
// y los pequeños a 4, para no arrastrar el ruido numérico del solucionador.
function smartNumber(value) {
    const number = Number(value);
    if (value === null || value === undefined || value === "" || !Number.isFinite(number)) {
        return "—";
    }
    const absolute = Math.abs(number);
    const digits = absolute >= 100 ? 2 : absolute >= 1 ? 4 : 6;
    const rounded = Number(number.toFixed(digits));
    return new Intl.NumberFormat("es-CO", { maximumFractionDigits: digits })
        .format(Object.is(rounded, -0) ? 0 : rounded);
}

function formatMetric(value, digits = 4) {
    const number = Number(value);
    if (value === null || value === undefined || !Number.isFinite(number)) return "—";
    return new Intl.NumberFormat("es-CO", { maximumFractionDigits: digits }).format(number);
}

function portfolioAllocationChips(item, limit = 3) {
    const names = item.modelo_snapshot?.activos || [];
    const weights = (item.ponderaciones || [])
        .map((weight, index) => ({
            name: names[index] || `Activo ${index + 1}`,
            weight: Number(weight)
        }))
        .filter((entry) => entry.weight >= 0.005)
        .sort((first, second) => second.weight - first.weight);
    if (!weights.length) return '<span class="muted">Sin asignación</span>';
    const chips = weights.slice(0, limit).map((entry) =>
        `<span class="history-chip">${escapeHTML(entry.name)} <strong>${formatPercent(entry.weight, 1)}</strong></span>`);
    if (weights.length > limit) {
        chips.push(`<span class="history-chip history-chip-more">+${weights.length - limit}</span>`);
    }
    return chips.join("");
}

function problemSolutionChips(item, limit = 4) {
    const values = item.valores || [];
    if (!values.length) return '<span class="muted">Sin valores</span>';
    const chips = values.slice(0, limit).map((value) =>
        `<span class="history-chip">${escapeHTML(value.variable_nombre || `Variable ${value.variable}`)} <strong>${escapeHTML(smartNumber(value.valor))}</strong></span>`);
    if (values.length > limit) {
        chips.push(`<span class="history-chip history-chip-more">+${values.length - limit}</span>`);
    }
    return chips.join("");
}

function showHistory(items, target, portfolio = false) {
    if (!items.length) {
        target.innerHTML = '<p class="history-empty">Todavía no hay ejecuciones.</p>';
        return;
    }
    const header = portfolio
        ? `<th scope="col">Fecha</th>
           <th scope="col" class="numeric">Rendimiento anual</th>
           <th scope="col" class="numeric">Volatilidad anual</th>
           <th scope="col">Distribución principal</th>`
        : `<th scope="col">Fecha</th>
           <th scope="col">Estado</th>
           <th scope="col" class="numeric">Valor objetivo</th>
           <th scope="col">Solución</th>`;
    const rows = items.map((item, index) => {
        const date = formatDashboardDate(item.creada_en || item.iniciada_en);
        const hidden = index >= HISTORY_VISIBLE_ROWS ? " hidden data-history-extra" : "";
        if (portfolio) {
            const annualReturn = item.rendimiento_anualizado ?? item.rendimientos_portafolio;
            const annualRisk = item.volatilidad_anualizada ?? item.volatilidad_portafolio;
            return `<tr${hidden}>
                <td data-label="Fecha">${escapeHTML(date)}</td>
                <td data-label="Rendimiento anual" class="numeric">${formatPercent(annualReturn)}</td>
                <td data-label="Volatilidad anual" class="numeric">${formatPercent(annualRisk)}</td>
                <td data-label="Distribución"><div class="history-chips">${portfolioAllocationChips(item)}</div></td>
            </tr>`;
        }
        const ok = item.estado === "OPT";
        return `<tr${hidden}>
            <td data-label="Fecha">${escapeHTML(date)}</td>
            <td data-label="Estado"><span class="history-status ${ok ? "is-ok" : "is-bad"}">${escapeHTML(getStatusLabel(item.estado))}</span></td>
            <td data-label="Valor objetivo" class="numeric">${escapeHTML(smartNumber(item.valor_objetivo))}</td>
            <td data-label="Solución"><div class="history-chips">${problemSolutionChips(item)}</div></td>
        </tr>`;
    }).join("");
    const extra = items.length - HISTORY_VISIBLE_ROWS;
    target.innerHTML = `
        <div class="table-scroll">
            <table class="history-table">
                <thead><tr>${header}</tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        ${extra > 0 ? `<button class="secondary-button history-toggle" type="button" data-history-toggle aria-expanded="false">Ver todo el historial (${items.length})</button>` : ""}`;
}

document.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-history-toggle]");
    if (!toggle) return;
    const container = toggle.parentElement;
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    container.querySelectorAll("[data-history-extra]").forEach((row) => {
        row.hidden = expanded;
    });
    toggle.setAttribute("aria-expanded", String(!expanded));
    const total = container.querySelectorAll("tbody tr").length;
    toggle.textContent = expanded ? `Ver todo el historial (${total})` : "Ver menos";
});

function portfolioPayload() {
    const form = document.getElementById("portfolio-form");
    const parseOptionalJson = (value, fallback) =>
        value.trim() ? JSON.parse(value) : fallback;
    if (!form.elements.nombre.value.trim()) {
        throw new Error("Escribe un nombre para el portafolio.");
    }
    const assetNames = form.elements.activos.value.split(",").map((name) => name.trim());
    if (!assetNames.some(Boolean)) {
        throw new Error("Añade al menos un activo.");
    }
    const categories = form.elements.categorias.value.trim()
        ? form.elements.categorias.value.split(",").map((name) => name.trim())
        : assetNames.map(() => "");
    return {
        nombre: form.elements.nombre.value.trim(),
        activos: assetNames,
        categorias: categories,
        rendimientos_esperados: JSON.parse(form.elements.rendimientos.value),
        covarianza: JSON.parse(form.elements.covarianza.value),
        aversion_riesgo: form.elements.aversion_riesgo.value,
        pesos_minimos: parseOptionalJson(
            form.elements.pesos_minimos.value,
            assetNames.map(() => 0)
        ),
        pesos_maximos: parseOptionalJson(
            form.elements.pesos_maximos.value,
            assetNames.map(() => 1)
        ),
        limites_categoria: parseOptionalJson(
            form.elements.limites_categoria.value,
            {}
        ),
        periodos_por_anio: Number(form.elements.periodos_por_anio.value),
        escenarios_estres: parseOptionalJson(
            form.elements.escenarios_estres.value,
            {}
        )
    };
}

function resetPortfolioForm() {
    editingPortfolioId = null;
    document.getElementById("portfolio-form").reset();
    document.getElementById("portfolio-risk").value = "1";
    document.getElementById("portfolio-periods").value = "1";
    document.getElementById("portfolio-cancel-edit").hidden = true;
    document.querySelector("#portfolio-form button[type='submit']").textContent =
        "Guardar portafolio";
    renderPortfolioEditor();
}

function fillPortfolioForm(portfolio) {
    const form = document.getElementById("portfolio-form");
    form.elements.nombre.value = portfolio.nombre;
    form.elements.activos.value = portfolio.activos.join(", ");
    form.elements.categorias.value = portfolio.categorias?.some(Boolean)
        ? portfolio.categorias.join(", ")
        : "";
    form.elements.rendimientos.value = JSON.stringify(portfolio.rendimientos_esperados);
    form.elements.covarianza.value = JSON.stringify(portfolio.covarianza);
    form.elements.pesos_minimos.value = JSON.stringify(portfolio.pesos_minimos);
    form.elements.pesos_maximos.value = JSON.stringify(portfolio.pesos_maximos);
    form.elements.limites_categoria.value = JSON.stringify(portfolio.limites_categoria);
    form.elements.periodos_por_anio.value = portfolio.periodos_por_anio;
    form.elements.escenarios_estres.value = JSON.stringify(portfolio.escenarios_estres);
    form.elements.aversion_riesgo.value = Number(portfolio.aversion_riesgo);
    const hasAdvancedOptions =
        Object.keys(portfolio.limites_categoria || {}).length > 0 ||
        Object.keys(portfolio.escenarios_estres || {}).length > 0;
    if (hasAdvancedOptions) {
        form.querySelector(".portfolio-advanced:not(.portfolio-json)").open = true;
    }
    renderPortfolioEditor();
}

// Editor visual del portafolio: una tabla de activos (en %) y la matriz de
// covarianza en cuadrícula. Los campos JSON del formulario siguen siendo la
// fuente de datos; el editor los lee y los vuelve a escribir.
const PORTFOLIO_JSON_FIELDS = [
    "activos", "categorias", "rendimientos", "covarianza", "pesos_minimos", "pesos_maximos"
];

function toPercent(value) {
    return Number((Number(value) * 100).toFixed(6));
}

function fromPercent(value) {
    return Number((Number(value) / 100).toFixed(8));
}

function volatilityText(variance) {
    const value = Number(variance);
    return value > 0
        ? `${formatNumber(Number(toPercent(Math.sqrt(value)).toFixed(2)))} %`
        : "—";
}

function readPortfolioEditorState() {
    const form = document.getElementById("portfolio-form");
    const parseList = (value, fallback) => {
        const parsed = value.trim() ? JSON.parse(value) : fallback;
        if (!Array.isArray(parsed)) throw new SyntaxError("Se esperaba una lista.");
        return parsed;
    };
    const names = form.elements.activos.value.trim()
        ? form.elements.activos.value.split(",").map((name) => name.trim())
        : [];
    const size = names.length;
    const fit = (list, filler) =>
        Array.from({ length: size }, (_, index) =>
            list[index] === undefined || list[index] === null ? filler : list[index]);
    const categoryText = form.elements.categorias.value.trim();
    const categories = categoryText
        ? categoryText.split(",").map((name) => name.trim())
        : [];
    const covariance = parseList(form.elements.covarianza.value, []);
    return {
        names,
        categories: fit(categories, ""),
        returns: fit(parseList(form.elements.rendimientos.value, []), 0),
        minimums: fit(parseList(form.elements.pesos_minimos.value, []), 0),
        maximums: fit(parseList(form.elements.pesos_maximos.value, []), 1),
        covariance: Array.from({ length: size }, (_, row) =>
            fit(Array.isArray(covariance[row]) ? covariance[row] : [], 0))
    };
}

function writePortfolioEditorState(state) {
    const form = document.getElementById("portfolio-form");
    form.elements.activos.value = state.names.join(", ");
    form.elements.categorias.value = state.categories.some(Boolean)
        ? state.categories.join(", ")
        : "";
    form.elements.rendimientos.value = JSON.stringify(state.returns);
    form.elements.covarianza.value = JSON.stringify(state.covariance);
    form.elements.pesos_minimos.value = JSON.stringify(state.minimums);
    form.elements.pesos_maximos.value = JSON.stringify(state.maximums);
}

let portfolioEditorState = null;

function renderPortfolioEditor() {
    const assetsEditor = document.getElementById("portfolio-assets-editor");
    const covarianceEditor = document.getElementById("portfolio-covariance-editor");
    try {
        portfolioEditorState = readPortfolioEditorState();
    } catch {
        portfolioEditorState = null;
        const note = '<p class="portfolio-editor-note">Corrige el texto JSON de «Editar los datos como texto» para ver las tablas.</p>';
        assetsEditor.innerHTML = note;
        covarianceEditor.innerHTML = "";
        return;
    }
    const state = portfolioEditorState;
    const numberInput = (attributes, value) =>
        `<input type="number" step="any" inputmode="decimal" ${attributes} value="${escapeHTML(String(Number(value)))}">`;

    const rows = state.names.map((name, index) => `
        <tr>
            <td data-label="Activo">
                <input type="text" maxlength="80" data-asset-field="name" data-index="${index}"
                    aria-label="Nombre del activo ${index + 1}" value="${escapeHTML(name)}" placeholder="Activo ${index + 1}">
            </td>
            <td data-label="Categoría">
                <input type="text" maxlength="80" data-asset-field="category" data-index="${index}"
                    aria-label="Categoría de ${escapeHTML(name || `activo ${index + 1}`)}" value="${escapeHTML(state.categories[index])}" placeholder="Opcional">
            </td>
            <td data-label="Rendimiento esperado">
                <span class="portfolio-percent-input">${numberInput(
                    `data-asset-field="return" data-index="${index}" aria-label="Rendimiento esperado de ${escapeHTML(name || `activo ${index + 1}`)} en porcentaje"`,
                    toPercent(state.returns[index])
                )}<span aria-hidden="true">%</span></span>
            </td>
            <td data-label="Peso mínimo">
                <span class="portfolio-percent-input">${numberInput(
                    `min="0" max="100" data-asset-field="minimum" data-index="${index}" aria-label="Peso mínimo de ${escapeHTML(name || `activo ${index + 1}`)} en porcentaje"`,
                    toPercent(state.minimums[index])
                )}<span aria-hidden="true">%</span></span>
            </td>
            <td data-label="Peso máximo">
                <span class="portfolio-percent-input">${numberInput(
                    `min="0" max="100" data-asset-field="maximum" data-index="${index}" aria-label="Peso máximo de ${escapeHTML(name || `activo ${index + 1}`)} en porcentaje"`,
                    toPercent(state.maximums[index])
                )}<span aria-hidden="true">%</span></span>
            </td>
            <td class="portfolio-asset-remove">
                <button class="icon-button" type="button" data-remove-asset="${index}"
                    aria-label="Quitar ${escapeHTML(name || `activo ${index + 1}`)}" title="Quitar activo">✕</button>
            </td>
        </tr>`).join("");

    assetsEditor.innerHTML = `
        ${state.names.length ? `
        <div class="table-scroll">
            <table class="portfolio-assets-table">
                <thead>
                    <tr>
                        <th scope="col">Activo</th>
                        <th scope="col">Categoría</th>
                        <th scope="col">Rendimiento esperado</th>
                        <th scope="col">Peso mínimo</th>
                        <th scope="col">Peso máximo</th>
                        <th scope="col"><span class="visually-hidden">Acciones</span></th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>` : '<p class="portfolio-editor-note">Todavía no hay activos. Añade el primero o genera un borrador con IA.</p>'}
        <button class="secondary-button" type="button" data-add-asset>＋ Añadir activo</button>`;

    if (!state.names.length) {
        covarianceEditor.innerHTML =
            '<p class="portfolio-editor-note">La matriz aparecerá cuando añadas activos.</p>';
        return;
    }
    const label = (index) => escapeHTML(state.names[index] || `Activo ${index + 1}`);
    const header = state.names.map((_, index) =>
        `<th scope="col" data-asset-label="${index}">${label(index)}</th>`).join("");
    const body = state.covariance.map((row, rowIndex) => `
        <tr>
            <th scope="row" data-asset-label="${rowIndex}">${label(rowIndex)}</th>
            ${row.map((value, columnIndex) => `
                <td class="${rowIndex === columnIndex ? "is-diagonal" : ""}">${numberInput(
                    `data-cov-row="${rowIndex}" data-cov-col="${columnIndex}" aria-label="Covarianza entre ${label(rowIndex)} y ${label(columnIndex)}"`,
                    value
                )}</td>`).join("")}
        </tr>`).join("");
    const volatilities = state.names.map((_, index) => {
        const text = volatilityText(state.covariance[index][index]);
        return `<span class="portfolio-volatility-chip"><span data-asset-label="${index}">${label(index)}</span><strong data-volatility="${index}">${text}</strong></span>`;
    }).join("");
    covarianceEditor.innerHTML = `
        <div class="table-scroll">
            <table class="portfolio-covariance-table">
                <thead><tr><th scope="col"><span class="visually-hidden">Activo</span></th>${header}</tr></thead>
                <tbody>${body}</tbody>
            </table>
        </div>
        <div class="portfolio-volatilities" aria-live="polite">
            <span class="portfolio-hint">Volatilidad implícita (raíz de la diagonal):</span>
            ${volatilities}
        </div>`;
}

function updateVolatilityChip(index) {
    const chip = document.querySelector(`[data-volatility="${index}"]`);
    if (!chip || !portfolioEditorState) return;
    chip.textContent = volatilityText(portfolioEditorState.covariance[index][index]);
}

function resizePortfolioState(state, size) {
    const resize = (list, filler) =>
        Array.from({ length: size }, (_, index) => (index < list.length ? list[index] : filler));
    state.categories = resize(state.categories, "");
    state.returns = resize(state.returns, 0);
    state.minimums = resize(state.minimums, 0);
    state.maximums = resize(state.maximums, 1);
    state.covariance = Array.from({ length: size }, (_, row) =>
        Array.from({ length: size }, (_, column) =>
            (row < state.covariance.length && column < state.covariance.length
                ? state.covariance[row][column]
                : 0)));
}

document.getElementById("portfolio-assets-editor").addEventListener("input", (event) => {
    const input = event.target.closest("[data-asset-field]");
    if (!input || !portfolioEditorState) return;
    const index = Number(input.dataset.index);
    const state = portfolioEditorState;
    const field = input.dataset.assetField;
    if (field === "name" || field === "category") {
        // La coma separa los activos en el formato de texto.
        const clean = input.value.replace(/,/g, " ");
        if (clean !== input.value) input.value = clean;
        if (field === "name") {
            state.names[index] = clean.trim();
            document.querySelectorAll(`[data-asset-label="${index}"]`).forEach((cell) => {
                cell.textContent = state.names[index] || `Activo ${index + 1}`;
            });
        } else {
            state.categories[index] = clean.trim();
        }
    } else {
        if (input.value === "" || Number.isNaN(Number(input.value))) return;
        const key = { return: "returns", minimum: "minimums", maximum: "maximums" }[field];
        state[key][index] = fromPercent(input.value);
    }
    writePortfolioEditorState(state);
});

document.getElementById("portfolio-assets-editor").addEventListener("click", (event) => {
    if (!portfolioEditorState) return;
    const state = portfolioEditorState;
    if (event.target.closest("[data-add-asset]")) {
        state.names.push(`Activo ${state.names.length + 1}`);
        resizePortfolioState(state, state.names.length);
        writePortfolioEditorState(state);
        renderPortfolioEditor();
        const inputs = document.querySelectorAll('[data-asset-field="name"]');
        inputs[inputs.length - 1]?.select();
        return;
    }
    const remove = event.target.closest("[data-remove-asset]");
    if (!remove) return;
    const index = Number(remove.dataset.removeAsset);
    state.names.splice(index, 1);
    state.categories.splice(index, 1);
    state.returns.splice(index, 1);
    state.minimums.splice(index, 1);
    state.maximums.splice(index, 1);
    state.covariance.splice(index, 1);
    state.covariance.forEach((row) => row.splice(index, 1));
    writePortfolioEditorState(state);
    renderPortfolioEditor();
});

document.getElementById("portfolio-covariance-editor").addEventListener("input", (event) => {
    const input = event.target.closest("[data-cov-row]");
    if (!input || !portfolioEditorState) return;
    if (input.value === "" || Number.isNaN(Number(input.value))) return;
    const row = Number(input.dataset.covRow);
    const column = Number(input.dataset.covCol);
    const value = Number(input.value);
    const state = portfolioEditorState;
    state.covariance[row][column] = value;
    state.covariance[column][row] = value;
    if (row !== column) {
        const mirror = document.querySelector(
            `[data-cov-row="${column}"][data-cov-col="${row}"]`
        );
        if (mirror) mirror.value = input.value;
    } else {
        updateVolatilityChip(row);
    }
    writePortfolioEditorState(state);
});

PORTFOLIO_JSON_FIELDS.forEach((name) => {
    document.getElementById("portfolio-form").elements[name]
        .addEventListener("input", renderPortfolioEditor);
});
renderPortfolioEditor();

function formatDashboardDate(value) {
    if (!value) return "Sin fecha";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Sin fecha";
    return date.toLocaleString("es-CO", {
        dateStyle: "medium",
        timeStyle: "short"
    });
}

function setDashboardStatus(state, message = "") {
    const status = document.getElementById("dashboard-status");
    const text = document.getElementById("dashboard-status-text");
    const retry = document.getElementById("dashboard-retry");
    if (!status || !text || !retry) return;
    if (state === "ready") {
        status.hidden = true;
        status.removeAttribute("data-state");
        text.textContent = "";
        retry.hidden = true;
        const refresh = document.getElementById("dashboard-refresh");
        if (refresh) {
            refresh.disabled = false;
            refresh.removeAttribute("aria-busy");
        }
        return;
    }
    status.hidden = false;
    status.dataset.state = state;
    text.textContent = message;
    retry.hidden = state !== "error";
    const refresh = document.getElementById("dashboard-refresh");
    if (refresh) {
        refresh.disabled = state === "loading";
        refresh.setAttribute("aria-busy", String(state === "loading"));
    }
}

function getChartTheme() {
    const styles = getComputedStyle(document.body);
    const value = (name, fallback) =>
        styles.getPropertyValue(name).trim() || fallback;
    return {
        text: value("--text", "#182230"),
        muted: value("--muted", "#718096"),
        border: value("--border", "#e6e9f0"),
        primary: value("--primary", "#5b4bdb"),
        success: value("--success", "#087b50"),
        danger: value("--danger", "#a32332"),
        chartColors: [
            value("--primary", "#5b4bdb"),
            value("--success", "#087b50"),
            "#f59e0b",
            value("--danger", "#a32332"),
            value("--muted", "#718096"),
            "#3282b8"
        ]
    };
}

function getDashboardChartAnimation(type) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return false;
    }

    if (type === "pie" || type === "doughnut") {
        return {
            duration: 1250,
            easing: "easeOutQuart",
            animateRotate: true,
            animateScale: true
        };
    }

    return {
        duration: 950,
        easing: "easeOutQuart",
        delay: 320
    };
}

function updateDashboardChartMotion() {
    const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
    ).matches;
    Object.values(dashboardCharts).forEach((chart) => {
        if (!chart) return;
        chart.options.animation = getDashboardChartAnimation(chart.config.type);
        if (reducedMotion) chart.stop();
        chart.update("none");
    });
}

window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener(
    "change",
    updateDashboardChartMotion
);

function applyChartTheme() {
    if (typeof Chart === "undefined") return;
    const theme = getChartTheme();
    Object.values(dashboardCharts).forEach((chart) => {
        if (!chart) return;
        chart.options.color = theme.text;
        if (chart.options.plugins?.legend?.labels) {
            chart.options.plugins.legend.labels.color = theme.text;
        }
        if (chart.options.scales) {
            Object.values(chart.options.scales).forEach((scale) => {
                if (!scale) return;
                if (scale.ticks) scale.ticks.color = theme.muted;
                if (scale.grid) scale.grid.color = theme.border;
                if (scale.border) scale.border.color = theme.border;
            });
        }
        if (chart.config.type === "pie" || chart.config.type === "doughnut") {
            chart.data.datasets[0].backgroundColor = theme.chartColors;
            chart.data.datasets[0].borderColor = theme.border;
        } else if (chart.config.type === "bar") {
            chart.data.datasets[0].backgroundColor = theme.primary;
        }
        chart.update("none");
    });
}

function renderDashboardKPIs(summary) {
    const values = {
        "kpi-problemas": summary.problemas,
        "kpi-portafolios": summary.portafolios,
        "kpi-problemas-archivados": summary.problemas_archivados,
        "kpi-portafolios-archivados": summary.portafolios_archivados,
        "kpi-activos-totales": summary.analitica?.activos_totales
    };
    Object.entries(values).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value ?? "—";
    });
    // Una cuenta sin modelos ni portafolios ve la invitación a cargar ejemplos.
    const onboarding = document.getElementById("dashboard-onboarding");
    if (onboarding) {
        onboarding.hidden = Number(summary.problemas) + Number(summary.portafolios) > 0;
    }
}

function renderDashboardActivity(summary) {
    const problems = Array.isArray(summary?.ultimos_problemas)
        ? summary.ultimos_problemas
        : [];
    const portfolios = Array.isArray(summary?.ultimos_portafolios)
        ? summary.ultimos_portafolios
        : [];
    const problemsTarget = document.getElementById("dashboard-problems");
    const portfoliosTarget = document.getElementById("dashboard-portfolios");
    const historyTarget = document.getElementById("dashboard-activity-history");

    if (problemsTarget) {
        problemsTarget.innerHTML = problems.length
            ? problems.map((problem) => `
                <div class="activity-item">
                    <div class="activity-copy">
                        <span class="activity-title">${escapeHTML(problem.nombre)}</span>
                        <span class="activity-meta">${escapeHTML(getObjectiveLabel(problem.tipo_objetivo))} · ${escapeHTML(formatDashboardDate(problem.actualizado_en))}</span>
                    </div>
                    <div class="activity-actions">
                        <button class="secondary-button" type="button" data-dashboard-problem="${escapeHTML(problem.id)}">
                            <svg class="button-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3.5 12s3-5.5 8.5-5.5 8.5 5.5 8.5 5.5-3 5.5-8.5 5.5S3.5 12 3.5 12Z"/><circle cx="12" cy="12" r="2.5"/></svg>
                            Abrir
                        </button>
                    </div>
                </div>`).join("")
            : `<div class="dashboard-empty-state">
                <span class="dashboard-empty-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none"><path d="M5 4.5h14A1.5 1.5 0 0 1 20.5 6v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V6A1.5 1.5 0 0 1 5 4.5Z"/><path d="M8 9h8M8 13h5"/></svg>
                </span>
                <div class="dashboard-empty-copy">
                    <strong>Aún no tienes modelos</strong>
                    <span>Crea uno para empezar a explorar soluciones.</span>
                </div>
                <a href="#problem-workspace">Crear modelo</a>
            </div>`;
    }

    if (portfoliosTarget) {
        portfoliosTarget.innerHTML = portfolios.length
            ? portfolios.map((portfolio) => {
                const assetCount = Array.isArray(portfolio.activos)
                    ? portfolio.activos.length
                    : 0;
                return `
                    <div class="activity-item">
                        <div class="activity-copy">
                            <span class="activity-title">${escapeHTML(portfolio.nombre)}</span>
                            <span class="activity-meta">${assetCount} activos · ${escapeHTML(formatDashboardDate(portfolio.actualizado_en))}</span>
                        </div>
                        <div class="activity-actions">
                            <button class="secondary-button" type="button" data-dashboard-portfolio-action="solve" data-dashboard-portfolio-id="${escapeHTML(portfolio.id)}">
                                <svg class="button-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z"/></svg>
                                Optimizar
                            </button>
                            <button class="secondary-button" type="button" data-dashboard-portfolio-action="history" data-dashboard-portfolio-id="${escapeHTML(portfolio.id)}">
                                <svg class="button-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/></svg>
                                Historial
                            </button>
                        </div>
                    </div>`;
            }).join("")
            : `<div class="dashboard-empty-state">
                <span class="dashboard-empty-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none"><path d="M4 19.5h16M6.5 16V9.5m5 6.5V4.5m5 11.5v-4m-12-5.5 5-4 5 5 5-4"/></svg>
                </span>
                <div class="dashboard-empty-copy">
                    <strong>Aún no tienes portafolios</strong>
                    <span>Registra tus activos para analizar su distribución.</span>
                </div>
                <a href="#portfolio-panel">Crear portafolio</a>
            </div>`;
    }

    if (historyTarget) {
        const history = [
            ...problems.map((problem) => ({
                type: "Modelo",
                name: problem.nombre,
                updatedAt: problem.actualizado_en
            })),
            ...portfolios.map((portfolio) => ({
                type: "Portafolio",
                name: portfolio.nombre,
                updatedAt: portfolio.actualizado_en
            }))
        ].sort((first, second) => {
            const firstDate = new Date(first.updatedAt || 0).getTime() || 0;
            const secondDate = new Date(second.updatedAt || 0).getTime() || 0;
            return secondDate - firstDate;
        }).slice(0, 10);

        historyTarget.innerHTML = history.length
            ? history.map((item) => `
                <tr>
                    <td><span class="dashboard-history-type">${escapeHTML(item.type)}</span></td>
                    <td>${escapeHTML(item.name)}</td>
                    <td>${escapeHTML(formatDashboardDate(item.updatedAt))}</td>
                </tr>`).join("")
            : `<tr><td class="dashboard-history-empty" colspan="3">
                <span>Aún no hay actividad. Cuando crees modelos o portafolios, aparecerán aquí.</span>
            </td></tr>`;
    }
    renderNotifications(problems, portfolios);
}

function renderNotifications(problems, portfolios) {
    const list = document.getElementById("notifications-list");
    const count = document.getElementById("notification-count");
    const toggle = document.getElementById("notification-toggle");
    const summary = document.getElementById("notifications-summary");
    const markRead = document.getElementById("notifications-mark-read");
    if (!list || !count || !toggle || !summary || !markRead) return;

    currentNotifications = [
        ...problems.map((item) => ({
            id: String(item.id),
            key: `problem:${item.id}:${item.actualizado_en || ""}`,
            type: "problem",
            title: "Modelo actualizado",
            name: item.nombre,
            updatedAt: item.actualizado_en
        })),
        ...portfolios.map((item) => ({
            id: String(item.id),
            key: `portfolio:${item.id}:${item.actualizado_en || ""}`,
            type: "portfolio",
            title: "Portafolio actualizado",
            name: item.nombre,
            updatedAt: item.actualizado_en
        }))
    ].sort((first, second) => {
        const firstDate = new Date(first.updatedAt || 0).getTime() || 0;
        const secondDate = new Date(second.updatedAt || 0).getTime() || 0;
        return secondDate - firstDate;
    }).slice(0, 10);

    const unreadCount = currentNotifications.filter(
        (item) => !notificationRead.has(item.key)
    ).length;
    count.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
    count.hidden = unreadCount === 0;
    toggle.classList.toggle("has-unread", unreadCount > 0);
    toggle.setAttribute(
        "aria-label",
        unreadCount
            ? `Notificaciones, ${unreadCount} sin leer`
            : "Notificaciones, todas leídas"
    );
    summary.textContent = notificationStorageWarning
        ? "No se pudo guardar el estado de lectura en este navegador"
        : unreadCount
        ? `${unreadCount} actualización${unreadCount === 1 ? "" : "es"} sin leer`
        : "Actividad reciente de tu espacio";
    markRead.disabled = unreadCount === 0;

    list.innerHTML = currentNotifications.length
        ? currentNotifications.map((item) => {
            const unread = !notificationRead.has(item.key);
            return `
                <button class="notification-item${unread ? " is-unread" : ""}" type="button"
                    data-notification-type="${item.type}" data-notification-id="${escapeHTML(item.id)}"
                    data-notification-key="${escapeHTML(item.key)}">
                    <span class="notification-item-icon" aria-hidden="true">${item.type === "problem" ? "⌘" : "◈"}</span>
                    <span class="notification-item-copy">
                        <strong>${escapeHTML(item.title)}</strong>
                        <span>${escapeHTML(item.name)}</span>
                        <small>${escapeHTML(formatDashboardDate(item.updatedAt))}</small>
                    </span>
                    ${unread ? '<span class="notification-unread-dot" aria-label="Sin leer"></span>' : ""}
                </button>`;
        }).join("")
        : '<p class="notification-empty">Tus actualizaciones recientes aparecerán aquí.</p>';
}

function getNotificationStorageKey() {
    return `vertice-notifications-read:${encodeURIComponent(notificationAccount)}`;
}

function persistNotificationRead() {
    try {
        localStorage.setItem(
            getNotificationStorageKey(),
            JSON.stringify([...notificationRead].slice(-100))
        );
        notificationStorageWarning = false;
    } catch {
        notificationStorageWarning = true;
    }
}

function setNotificationsOpen(open) {
    const toggle = document.getElementById("notification-toggle");
    const panel = document.getElementById("notifications-panel");
    if (!toggle || !panel) return;
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
}

document.getElementById("notification-toggle").addEventListener("click", () => {
    const toggle = document.getElementById("notification-toggle");
    setNotificationsOpen(toggle.getAttribute("aria-expanded") !== "true");
});

document.getElementById("notifications-mark-read").addEventListener("click", () => {
    currentNotifications.forEach((item) => notificationRead.add(item.key));
    persistNotificationRead();
    const summary = dashboardState.data || {};
    renderNotifications(
        Array.isArray(summary.ultimos_problemas) ? summary.ultimos_problemas : [],
        Array.isArray(summary.ultimos_portafolios) ? summary.ultimos_portafolios : []
    );
});

document.getElementById("notifications-list").addEventListener("click", (event) => {
    const item = event.target.closest("[data-notification-type]");
    if (!item) return;
    const { notificationType, notificationId, notificationKey } = item.dataset;
    notificationRead.add(notificationKey);
    persistNotificationRead();
    const summary = dashboardState.data || {};
    renderNotifications(
        Array.isArray(summary.ultimos_problemas) ? summary.ultimos_problemas : [],
        Array.isArray(summary.ultimos_portafolios) ? summary.ultimos_portafolios : []
    );
    setNotificationsOpen(false);
    if (notificationType === "problem") {
        navigateAppView("#problem-workspace");
        loadProblem(notificationId);
        document.querySelector(".details-panel")?.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    } else {
        navigateAppView("#portfolio-panel");
        managePortfolio("history", notificationId);
        document.querySelector(".portfolio-panel")?.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }
});

document.addEventListener("click", (event) => {
    const menu = document.querySelector(".notification-menu");
    if (menu && !menu.contains(event.target)) setNotificationsOpen(false);
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setNotificationsOpen(false);
});

function animateThemeToggle() {
    if (!themeToggle) return;
    themeToggle.classList.remove("is-switching");
    void themeToggle.offsetWidth;
    themeToggle.classList.add("is-switching");
}

function renderDashboardCharts(summary) {
    if (typeof Chart === "undefined") return false;

    const problemsCanvas = document.getElementById("chart-problemas");
    const portfoliosCanvas = document.getElementById("chart-portafolios");
    if (!problemsCanvas || !portfoliosCanvas) return false;

    const analytics = summary?.analitica || {};
    const objectiveCounts = Array.isArray(analytics.problemas_por_objetivo)
        ? analytics.problemas_por_objetivo
        : [];
    const portfolioDistribution = Array.isArray(
        analytics.portafolios_por_cantidad_activos
    )
        ? analytics.portafolios_por_cantidad_activos
        : [];
    const signature = JSON.stringify({
        objectives: objectiveCounts,
        portfolios: portfolioDistribution
    });
    if (signature === dashboardState.chartSignature
        && dashboardCharts.problemas
        && dashboardCharts.portafolios) {
        applyChartTheme();
        return true;
    }

    const theme = getChartTheme();
    const objectiveLabels = objectiveCounts.map((item) =>
        item.tipo_objetivo === "MIN" ? "Minimizar" : "Maximizar"
    );
    const objectiveData = objectiveCounts.map((item) => item.total);
    const portfolioLabels = portfolioDistribution.map((item) =>
        item.cantidad_activos === "5+"
            ? "5 o más activos"
            : `${item.cantidad_activos} activos`
    );
    const portfolioData = portfolioDistribution.map(
        (item) => item.total_portafolios
    );
    const hasObjectives = objectiveData.some((count) => count > 0);
    const hasPortfolios = portfolioData.some((count) => count > 0);

    if (!dashboardCharts.problemas) {
        dashboardCharts.problemas = new Chart(problemsCanvas, {
            type: "pie",
            data: {
                labels: hasObjectives ? objectiveLabels : ["Sin problemas activos"],
                datasets: [{
                    data: hasObjectives ? objectiveData : [0],
                    backgroundColor: hasObjectives
                        ? theme.chartColors
                        : [theme.border],
                    borderColor: theme.border,
                    borderWidth: 2,
                    hoverOffset: 8
                }]
            },
            options: {
                responsive: true,
                animation: getDashboardChartAnimation("doughnut"),
                color: theme.text,
                plugins: {
                    legend: {
                        position: "bottom",
                        labels: { color: theme.text, usePointStyle: true }
                    },
                    tooltip: { enabled: hasObjectives }
                },
            }
        });
    } else {
        const chart = dashboardCharts.problemas;
        chart.data.labels = hasObjectives
            ? objectiveLabels
            : ["Sin problemas activos"];
        chart.data.datasets[0].data = hasObjectives ? objectiveData : [0];
        chart.data.datasets[0].backgroundColor = hasObjectives
            ? theme.chartColors
            : [theme.border];
        chart.data.datasets[0].borderColor = theme.border;
        chart.options.plugins.tooltip.enabled = hasObjectives;
        chart.update();
    }

    if (!dashboardCharts.portafolios) {
        dashboardCharts.portafolios = new Chart(portfoliosCanvas, {
            type: "pie",
            data: {
                labels: hasPortfolios
                    ? portfolioLabels
                    : ["Sin portafolios activos"],
                datasets: [{
                    label: "Portafolios",
                    data: hasPortfolios ? portfolioData : [0],
                    backgroundColor: hasPortfolios
                        ? theme.chartColors
                        : [theme.border],
                    borderColor: theme.border,
                    borderWidth: 2,
                    hoverOffset: 8
                }]
            },
            options: {
                responsive: true,
                animation: getDashboardChartAnimation("pie"),
                color: theme.text,
                plugins: {
                    legend: {
                        position: "bottom",
                        labels: { color: theme.text, usePointStyle: true }
                    },
                    tooltip: { enabled: hasPortfolios }
                }
            }
        });
    } else {
        const chart = dashboardCharts.portafolios;
        chart.data.labels = hasPortfolios
            ? portfolioLabels
            : ["Sin portafolios activos"];
        chart.data.datasets[0].data = hasPortfolios ? portfolioData : [0];
        chart.data.datasets[0].backgroundColor = hasPortfolios
            ? theme.chartColors
            : [theme.border];
        chart.data.datasets[0].borderColor = theme.border;
        chart.options.plugins.tooltip.enabled = hasPortfolios;
        chart.update();
    }

    const problemsEmpty = document.getElementById("chart-problemas-empty");
    const portfoliosEmpty = document.getElementById("chart-portafolios-empty");
    if (problemsEmpty) problemsEmpty.hidden = hasObjectives;
    if (portfoliosEmpty) portfoliosEmpty.hidden = hasPortfolios;
    problemsCanvas.closest(".chart-canvas")?.classList.toggle(
        "is-empty",
        !hasObjectives
    );
    portfoliosCanvas.closest(".chart-canvas")?.classList.toggle(
        "is-empty",
        !hasPortfolios
    );

    dashboardState.chartSignature = signature;
    return true;
}

function invalidateDashboard() {
    dashboardState.dirty = true;
    if (dashboardState.inFlight) dashboardState.pendingRefresh = true;
}

function refreshDashboardAfterMutation() {
    invalidateDashboard();
    refreshPlanSummary();
    return loadDashboard({ force: true });
}

function resetDashboard() {
    dashboardState.data = null;
    dashboardState.lastLoadedAt = 0;
    dashboardState.dirty = true;
    dashboardState.pendingRefresh = false;
    dashboardState.chartSignature = null;
    dashboardState.generation += 1;
    Object.values(dashboardCharts).forEach((chart) => {
        if (chart) chart.destroy();
    });
    dashboardCharts = {};
    [
        "kpi-problemas",
        "kpi-portafolios",
        "kpi-problemas-archivados",
        "kpi-portafolios-archivados",
        "kpi-activos-totales"
    ].forEach((id) => {
        const element = document.getElementById(id);
        if (element) element.textContent = "—";
    });
    renderDashboardActivity({});
    setDashboardStatus("ready");
}

async function loadDashboard({ force = false } = {}) {
    if (appContent.hidden) return;
    if (dashboardState.inFlight) {
        dashboardState.pendingRefresh = true;
        return dashboardState.inFlight;
    }

    const cacheIsFresh = !force
        && !dashboardState.dirty
        && dashboardState.data
        && Date.now() - dashboardState.lastLoadedAt < DASHBOARD_CACHE_MS;
    if (cacheIsFresh) return dashboardState.data;

    setDashboardStatus("loading", "Actualizando dashboard...");
    const generation = dashboardState.generation;
    dashboardState.inFlight = (async () => {
        try {
            const summary = await requestJSON(`${API_URL}/resumen/`);
            if (generation !== dashboardState.generation || appContent.hidden) {
                return null;
            }
            dashboardState.data = summary;
            dashboardState.lastLoadedAt = Date.now();
            dashboardState.dirty = false;
            renderDashboardKPIs(summary);
            renderDashboardActivity(summary);
            loadRecentJobs();
            const chartsRendered = renderDashboardCharts(summary);
            if (chartsRendered) {
                setDashboardStatus("ready");
            } else {
                setDashboardStatus(
                    "error",
                    "El resumen se actualizó, pero no se pudieron dibujar los gráficos."
                );
            }
            return summary;
        } catch (error) {
            if (error.status === 401 || error.status === 403) {
                showAuthentication("Tu sesión terminó. Inicia sesión nuevamente.");
                return null;
            }
            setDashboardStatus(
                "error",
                `No se pudo cargar el resumen. ${error.message}`
            );
            return null;
        } finally {
            dashboardState.inFlight = null;
            if (dashboardState.pendingRefresh) {
                dashboardState.pendingRefresh = false;
                dashboardState.dirty = true;
                loadDashboard({ force: true });
            }
        }
    })();
    return dashboardState.inFlight;
}

async function loadPortfolios() {
    const list = document.getElementById("portfolio-list");
    try {
        const portfolios = await requestJSON(
            `${API_URL}/portafolios/${showArchivedPortfolios ? "archivados/" : ""}`
        );
        list.innerHTML = portfolios.length
            ? portfolios.map((portfolio) => `
                <article class="problem-card portfolio-card">
                    <strong>${escapeHTML(portfolio.nombre)}</strong>
                    <span class="problem-card-meta">${escapeHTML(portfolio.activos.join(", "))}</span>
                    <div class="model-actions">
                        ${showArchivedPortfolios
                            ? `<button class="secondary-button" data-action="restore" data-id="${portfolio.id}" type="button">Restaurar</button>`
                            : `<button class="secondary-button" data-action="solve" data-id="${portfolio.id}" type="button">Optimizar</button>
                               <button class="secondary-button" data-action="frontier" data-id="${portfolio.id}" type="button">Frontera eficiente</button>
                               <button class="secondary-button" data-action="edit" data-id="${portfolio.id}" type="button">Editar</button>
                               <button class="secondary-button" data-action="duplicate" data-id="${portfolio.id}" type="button">Duplicar</button>
                               <button class="secondary-button" data-action="history" data-id="${portfolio.id}" type="button">Historial</button>
                               <button class="secondary-button" data-action="archive" data-id="${portfolio.id}" type="button">Archivar</button>`}
                    </div>
                </article>`).join("")
            : `<p class="muted">${showArchivedPortfolios ? "No hay portafolios archivados." : "Aún no hay portafolios guardados."}</p>`;
        list.querySelectorAll("[data-action]").forEach((button) => {
            button.addEventListener("click", () => managePortfolio(
                button.dataset.action,
                button.dataset.id,
                button
            ));
        });
    } catch (error) {
        list.innerHTML = `<p class="muted">${escapeHTML(error.message)}</p>`;
    }
}

async function renderPortfolioResult(result, id) {
    selectedPortfolioId = id;
    lastPortfolioExecutionId = result.id;
    resetExplanation("portfolio", result);
    const snapshot = result.modelo_snapshot || {};
    const names = snapshot.activos || [];
    const categories = snapshot.categorias || [];
    const periods = Number(snapshot.periodos_por_anio) || 1;
    const contributions = result.contribuciones_riesgo || [];
    const allocation = (result.ponderaciones || []).map((weight, index) => ({
        name: names[index] || `Activo ${index + 1}`,
        category: categories[index] || "",
        weight: Number(weight) || 0,
        riskShare: Number(contributions[index]?.proporcion_volatilidad) || 0,
        riskContribution: contributions[index]?.contribucion_volatilidad,
        maxWeight: Number(snapshot.pesos_maximos?.[index] ?? 1)
    })).sort((first, second) =>
        second.weight - first.weight || second.riskShare - first.riskShare);
    const invested = allocation.filter((entry) => entry.weight >= 0.005);
    const top = allocation[0];
    const annualReturn = result.rendimiento_anualizado ?? result.rendimientos_portafolio;
    const annualRisk = result.volatilidad_anualizada ?? result.volatilidad_portafolio;
    const periodNote = periods > 1
        ? `Por periodo: ${formatPercent(result.rendimientos_portafolio)}`
        : "Según tus supuestos";
    const periodRiskNote = periods > 1
        ? `Por periodo: ${formatPercent(result.volatilidad_portafolio)}`
        : "Desviación estándar de la cartera";

    let insight = "";
    if (top && top.weight >= 0.995) {
        insight = `Toda la cartera queda en <strong>${escapeHTML(top.name)}</strong>: con estos supuestos no hay diversificación. Revisa los límites de peso o sube la aversión al riesgo si quieres repartirla.`;
    } else if (top && top.weight >= 0.6) {
        const atLimit = top.maxWeight < 1 && Math.abs(top.weight - top.maxWeight) < 0.005;
        insight = atLimit
            ? `<strong>${escapeHTML(top.name)}</strong> concentra el ${formatPercent(top.weight, 1)} del peso y llegó a su peso máximo: el optimizador le asignaría más si el límite lo permitiera.`
            : `<strong>${escapeHTML(top.name)}</strong> concentra el ${formatPercent(top.weight, 1)} del peso. Puedes limitarlo con un peso máximo.`;
    } else if (invested.length > 1) {
        insight = `La cartera se reparte entre ${invested.length} activos; el mayor peso es <strong>${escapeHTML(top.name)}</strong> con ${formatPercent(top.weight, 1)}.`;
    }

    const bar = (fraction, tone) => {
        const width = Math.max(0, Math.min(100, fraction * 100)).toFixed(2);
        return `<span class="allocation-bar ${tone}" aria-hidden="true"><span style="width:${width}%"></span></span>`;
    };
    const rows = allocation.map((entry) => `
        <tr class="${entry.weight < 0.005 ? "is-empty" : ""}">
            <th scope="row">
                <span class="allocation-name">${escapeHTML(entry.name)}</span>
                ${entry.category ? `<span class="allocation-category">${escapeHTML(entry.category)}</span>` : ""}
            </th>
            <td>
                <div class="allocation-cell">${bar(entry.weight, "is-weight")}<strong>${formatPercent(entry.weight, 1)}</strong></div>
            </td>
            <td>
                <div class="allocation-cell" title="Aporta ${formatPercent(entry.riskContribution)} de volatilidad">${bar(entry.riskShare, "is-risk")}<strong>${formatPercent(entry.riskShare, 1)}</strong></div>
            </td>
        </tr>`).join("");

    const stress = Object.entries(result.resultados_estres || {});
    const stressHtml = stress.length ? `
        <section class="portfolio-result-block">
            <h4>Escenarios de estrés</h4>
            <ul class="stress-list">
                ${stress.map(([scenario, value]) => `
                    <li>
                        <span>${escapeHTML(scenario)}</span>
                        <strong class="${Number(value) < 0 ? "is-negative" : "is-positive"}">${formatPercent(value)}</strong>
                    </li>`).join("")}
            </ul>
        </section>` : "";

    document.getElementById("portfolio-result-values").innerHTML = `
        <div class="portfolio-kpis">
            <article class="portfolio-kpi is-primary">
                <span>Rendimiento esperado anual</span>
                <strong>${formatPercent(annualReturn)}</strong>
                <small>${escapeHTML(periodNote)}</small>
            </article>
            <article class="portfolio-kpi">
                <span>Volatilidad anualizada</span>
                <strong>${formatPercent(annualRisk)}</strong>
                <small>${escapeHTML(periodRiskNote)}</small>
            </article>
            <article class="portfolio-kpi">
                <span>Utilidad ajustada por riesgo</span>
                <strong>${formatMetric(result.utilidad_riesgo)}</strong>
                <small>Lo que maximiza el optimizador</small>
            </article>
            <article class="portfolio-kpi">
                <span>Activos con peso</span>
                <strong>${invested.length} de ${allocation.length}</strong>
                <small>${invested.length > 1 ? "Cartera diversificada" : "Cartera concentrada"}</small>
            </article>
        </div>
        ${insight ? `<p class="portfolio-insight">${insight}</p>` : ""}
        <section class="portfolio-result-block">
            <h4>Distribución de la cartera</h4>
            <div class="table-scroll">
                <table class="allocation-table">
                    <thead>
                        <tr>
                            <th scope="col">Activo</th>
                            <th scope="col">Peso en la cartera</th>
                            <th scope="col">Contribución al riesgo</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </section>
        ${stressHtml}`;
    document.getElementById("portfolio-result").hidden = false;
    renderPortfolioComparisonInputs(result);
    await managePortfolio("history", id);
}

async function managePortfolio(action, id, triggerButton = null) {
    const url = `${API_URL}/portafolios/${encodeURIComponent(id)}/`;
    const message = document.getElementById("portfolio-message");
    message.hidden = true;
    const isLongOperation = action === "solve" || action === "frontier";
    if (isLongOperation && triggerButton) {
        triggerButton.disabled = true;
        triggerButton.textContent = action === "solve"
            ? "En cola..."
            : "Calculando...";
    }
    try {
        if (action === "edit") {
            const portfolio = await requestJSON(url);
            fillPortfolioForm(portfolio);
            const form = document.getElementById("portfolio-form");
            editingPortfolioId = id;
            document.getElementById("portfolio-cancel-edit").hidden = false;
            document.querySelector("#portfolio-form button[type='submit']").textContent =
                "Guardar cambios";
            form.scrollIntoView({ behavior: "smooth", block: "center" });
            return;
        }
        if (action === "solve") {
            selectedPortfolioId = id;
            lastPortfolioExecutionId = null;
            document.getElementById("portfolio-result").hidden = true;
            document.querySelector('[data-report-message="portfolio"]').hidden = true;
            message.classList.remove("error-message");
            message.textContent = "En cola...";
            message.hidden = false;
            const submission = await requestJSON(`${url}resolver/`, { method: "POST" });
            const result = await waitForOptimizationJob(
                submission,
                (jobStatus) => {
                    message.textContent = jobStatus === "queued"
                        ? "En cola..."
                        : "Optimizando portafolio...";
                }
            );
            message.hidden = true;
            await renderPortfolioResult(result, id);
            return;
        }
        if (action === "frontier") {
            message.classList.remove("error-message");
            message.textContent = "En cola...";
            message.hidden = false;
            const submission = await requestJSON(
                `${url}frontera/`,
                { method: "POST" }
            );
            const result = await waitForOptimizationJob(
                submission,
                (jobStatus) => {
                    message.textContent = jobStatus === "queued"
                        ? "En cola..."
                        : "Calculando frontera eficiente...";
                }
            );
            message.hidden = true;
            renderFrontier(result);
            return;
        }
        if (action === "history") {
            const history = await requestJSON(`${url}historial/`);
            showHistory(history, document.getElementById("portfolio-history-list"), true);
            document.getElementById("portfolio-history").hidden = false;
            return;
        }
        if (action === "duplicate") {
            await requestJSON(`${url}duplicar/`, { method: "POST" });
        } else if (action === "archive") {
            await requestJSON(url, { method: "DELETE" });
        } else if (action === "restore") {
            await requestJSON(`${url}restaurar/`, { method: "POST" });
        }
        await loadPortfolios();
        await refreshDashboardAfterMutation();
    } catch (error) {
        message.textContent = error.message;
        message.classList.add("error-message");
        message.hidden = false;
    } finally {
        if (isLongOperation && triggerButton) {
            triggerButton.disabled = false;
            triggerButton.textContent = action === "solve"
                ? "Optimizar"
                : "Frontera eficiente";
        }
    }
}

document.getElementById("portfolio-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = document.getElementById("portfolio-message");
    message.hidden = true;
    try {
        const payload = portfolioPayload();
        const url = editingPortfolioId
            ? `${API_URL}/portafolios/${encodeURIComponent(editingPortfolioId)}/`
            : `${API_URL}/portafolios/`;
        await requestJSON(url, {
            method: editingPortfolioId ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        resetPortfolioForm();
        message.classList.remove("error-message");
        message.textContent = "Portafolio guardado.";
        message.hidden = false;
        await loadPortfolios();
        await refreshDashboardAfterMutation();
    } catch (error) {
        message.classList.add("error-message");
        message.textContent = error instanceof SyntaxError
            ? "Revisa que rendimientos y covarianza sean JSON válido."
            : error.message;
        message.hidden = false;
    }
});

function showPortfolioAiNotes(title, items) {
    const notes = document.getElementById("portfolio-ai-notes");
    notes.replaceChildren();
    if (!Array.isArray(items) || !items.length) {
        notes.hidden = true;
        return;
    }
    const heading = document.createElement("li");
    heading.className = "portfolio-ai-notes-title";
    heading.textContent = title;
    notes.append(heading);
    items.forEach((text) => {
        const item = document.createElement("li");
        item.textContent = text;
        notes.append(item);
    });
    notes.hidden = false;
}

document.getElementById("portfolio-ai-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type='submit']");
    const message = document.getElementById("portfolio-ai-message");
    button.disabled = true;
    button.textContent = "Generando borrador...";
    message.hidden = true;
    showPortfolioAiNotes("", []);
    try {
        const result = await requestJSON(`${API_URL}/portafolios/generar/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ texto: form.elements.texto.value.trim() })
        });
        resetPortfolioForm();
        fillPortfolioForm(result.borrador);
        message.textContent = "Borrador cargado en el formulario. Revisa cada valor y pulsa «Guardar portafolio».";
        message.classList.remove("error-message");
        message.hidden = false;
        showPortfolioAiNotes("Supuestos que conviene revisar:", result.supuestos);
        document.getElementById("portfolio-form").scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    } catch (error) {
        message.textContent = `No se pudo generar el borrador: ${error.message}`;
        message.classList.add("error-message");
        message.hidden = false;
        showPortfolioAiNotes("Datos que faltan en la descripción:", error.data?.faltantes);
    } finally {
        button.disabled = false;
        button.textContent = "Generar borrador con IA";
        refreshPlanSummary();
    }
});

document.getElementById("portfolio-import-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = document.getElementById("portfolio-import-message");
    const preview = document.getElementById("portfolio-import-preview");
    message.hidden = true;
    preview.hidden = true;
    try {
        const form = new FormData(event.currentTarget);
        const response = await requestJSON(
            `${API_URL}/portafolios/importar/preview/`,
            { method: "POST", body: form }
        );
        fillPortfolioForm(response.preview);
        editingPortfolioId = null;
        document.querySelector("#portfolio-form button[type='submit']").textContent =
            "Guardar portafolio";
        document.getElementById("portfolio-cancel-edit").hidden = true;
        preview.innerHTML = `
            <div class="solution-card">
                <span>Datos válidos para ${escapeHTML(response.preview.nombre)}</span>
                <strong>${response.preview.activos.length} activos</strong>
            </div>
            <div class="muted">${escapeHTML(response.preview.activos.join(", "))}</div>
            <div class="muted">Revisa los campos y pulsa “Guardar portafolio” para confirmar la importación.</div>`;
        preview.hidden = false;
        message.textContent = "El CSV pasó la validación y está previsualizado.";
        message.classList.remove("error-message");
        message.hidden = false;
        document.getElementById("portfolio-form").scrollIntoView({
            behavior: "smooth",
            block: "center"
        });
    } catch (error) {
        message.textContent = error.message;
        message.classList.add("error-message");
        message.hidden = false;
    }
});

document.getElementById("portfolio-cancel-edit").addEventListener("click", resetPortfolioForm);
document.getElementById("portfolio-comparison-form").addEventListener(
    "submit",
    comparePortfolioScenarios
);
document.getElementById("portfolio-refresh").addEventListener("click", loadPortfolios);
document.getElementById("portfolio-archived-toggle").addEventListener("click", (event) => {
    showArchivedPortfolios = !showArchivedPortfolios;
    event.currentTarget.textContent = showArchivedPortfolios ? "Activos" : "Archivados";
    loadPortfolios();
});

async function loadProblems() {
    problemsList.innerHTML = '<p class="muted">Cargando problemas...</p>';
    refreshButton.disabled = true;

    try {
        const problems = await requestJSON(
            `${API_URL}/problemas/${showArchivedProblems ? "archivados/" : ""}`
        );

        if (!Array.isArray(problems)) {
            throw new Error("La API no devolvió una lista de problemas.");
        }

        if (problems.length === 0) {
            problemsList.innerHTML = showArchivedProblems
                ? '<p class="muted">No hay problemas archivados.</p>'
                : '<p class="muted">No hay problemas activos disponibles.</p>';
            selectedProblemId = null;
            emptyState.hidden = false;
            problemContent.hidden = true;
            return;
        }

        problemsList.innerHTML = problems.map((problem) => {
            const id = getProblemId(problem);
            const selected = String(id) === String(selectedProblemId);

            return `
                <div class="problem-card ${selected ? "selected" : ""}">
                    <span class="problem-card-title">
                        ${escapeHTML(problem.nombre || `Problema ${id}`)}
                    </span>
                    <span class="problem-card-meta">
                        ${escapeHTML(getObjectiveLabel(problem.tipo_objetivo))}
                    </span>
                    ${showArchivedProblems
                        ? `<button class="secondary-button" data-action="restore" data-id="${escapeHTML(id)}" type="button">Restaurar</button>`
                        : `<button class="secondary-button" data-action="select" data-id="${escapeHTML(id)}" type="button">Abrir</button>`}
                </div>
            `;
        }).join("");

        problemsList.querySelectorAll("[data-action='select']").forEach((button) => {
            button.addEventListener("click", () => {
                loadProblem(button.dataset.id);
            });
        });
        problemsList.querySelectorAll("[data-action='restore']").forEach((button) => {
            button.addEventListener("click", async () => {
                try {
                    await requestJSON(
                        `${API_URL}/problemas/${encodeURIComponent(button.dataset.id)}/restaurar/`,
                        { method: "POST" }
                    );
                    await loadProblems();
                    await refreshDashboardAfterMutation();
                } catch (error) {
                    problemsList.insertAdjacentHTML(
                        "afterbegin",
                        `<p class="message error-message">${escapeHTML(error.message)}</p>`
                    );
                }
            });
        });

        if (selectedProblemId !== null) {
            const stillExists = problems.some(
                (problem) =>
                    String(getProblemId(problem)) === String(selectedProblemId)
            );

            if (!stillExists) {
                selectedProblemId = null;
                emptyState.hidden = false;
                problemContent.hidden = true;
            }
        }

        if (selectedProblemId === null && !showArchivedProblems) {
            await loadProblem(getProblemId(problems[0]));
        } else if (selectedProblemId === null) {
            emptyState.hidden = false;
            problemContent.hidden = true;
        }
    } catch (error) {
        if (error.status === 401 || error.status === 403) {
            showAuthentication("Tu sesión terminó. Inicia sesión nuevamente.");
            return;
        }
        problemsList.innerHTML = `
            <p class="muted">
                No fue posible cargar los problemas.
                ${escapeHTML(error.message)}
            </p>
        `;
    } finally {
        refreshButton.disabled = false;
    }
}

async function loadProblem(problemId) {
    selectedProblemId = problemId;
    lastProblemExecutionId = null;

    emptyState.hidden = true;
    problemContent.hidden = false;
    errorMessage.hidden = true;
    resultsSection.hidden = true;

    document.getElementById("problem-title").textContent = "Cargando...";
    document.getElementById("variables-list").innerHTML = "";
    document.getElementById("objective-formula").textContent = "Cargando...";
    document.getElementById("constraints-list").innerHTML = "";

    try {
        const problem = await requestJSON(
            `${API_URL}/problemas/${encodeURIComponent(problemId)}/`
        );

        renderProblem(problem);

        problemsList.querySelectorAll("[data-action='select']").forEach((button) => {
            button.classList.toggle(
                "selected",
                button.dataset.id === String(problemId)
            );
        });
    } catch (error) {
        showError(`No se pudo cargar el problema: ${error.message}`);
        document.getElementById("problem-title").textContent = "Error al cargar";
    }
}

function renderProblem(problem) {
    const variables = problem.variables || [];
    const objectiveTerms = problem.terminos_objetivo || [];
    const constraints = problem.restricciones || [];

    document.getElementById("problem-title").textContent =
        problem.nombre || "Problema sin nombre";

    document.getElementById("problem-type").textContent =
        getObjectiveLabel(problem.tipo_objetivo);

    document.getElementById("problem-description").textContent =
        problem.descripcion || "Este problema no tiene una descripción.";

    const boundsText = (variable) => {
        const lower = variable.limite_inferior;
        const upper = variable.limite_superior;
        const hasLower = lower !== null && lower !== undefined;
        const hasUpper = upper !== null && upper !== undefined;
        if (variable.tipo === "BIN") return "0 o 1";
        if (hasLower && hasUpper) return `entre ${formatNumber(lower)} y ${formatNumber(upper)}`;
        if (hasLower) return `≥ ${formatNumber(lower)}`;
        if (hasUpper) return `≤ ${formatNumber(upper)}`;
        return "sin límites";
    };
    const describeVariable = (variable) =>
        `${getVariableType(variable.tipo)} · ${boundsText(variable)}`;
    const shared = variables.length > 1 &&
        variables.every((variable) => describeVariable(variable) === describeVariable(variables[0]));

    document.getElementById("variables-list").innerHTML =
        variables.length > 0
            ? `
                ${shared ? `<p class="variables-summary">${escapeHTML(summarizeVariables(variables, boundsText))}</p>` : ""}
                <ul class="variable-rows">
                    ${variables.map((variable) => {
                        const label = variable.descripcion?.trim() ||
                            humanizeName(variable.nombre);
                        return `
                            <li class="variable-row">
                                <span class="variable-symbol">${mathName(variable.nombre)}</span>
                                <span class="variable-text">
                                    <span class="variable-label">${escapeHTML(label)}</span>
                                    ${variable.unidad ? `<span class="variable-unit">${escapeHTML(variable.unidad)}</span>` : ""}
                                </span>
                                ${shared ? "" : `<span class="variable-meta">${escapeHTML(describeVariable(variable))}</span>`}
                            </li>`;
                    }).join("")}
                </ul>`
            : '<p class="muted">Este modelo no tiene variables registradas.</p>';

    const objectivePrefix = getObjectiveLabel(problem.tipo_objetivo);

    document.getElementById("objective-formula").innerHTML =
        `${escapeHTML(objectivePrefix)} <i>Z</i> = ${formatExpressionHTML(objectiveTerms, variables)}`;

    document.getElementById("constraints-list").innerHTML =
        constraints.length > 0
            ? constraints.map((constraint, index) => {
                const name = constraint.nombre || `Restricción ${index + 1}`;
                const description = constraint.descripcion?.trim();
                return `
                    <div class="constraint-row" data-constraint-name="${escapeHTML(name)}">
                        <span class="constraint-text">
                            <span class="constraint-title">${escapeHTML(description || humanizeName(name))}</span>
                            ${description ? `<span class="constraint-name">${escapeHTML(humanizeName(name))}</span>` : ""}
                        </span>
                        <span class="constraint-formula">
                            ${formatExpressionHTML(constraint.terminos || [], variables)}
                            ${escapeHTML(getOperator(constraint.operador))}
                            ${escapeHTML(formatNumber(constraint.lado_derecho))}
                        </span>
                        <span class="constraint-status" data-constraint-status hidden></span>
                    </div>
                `;
            }).join("")
            : '<p class="muted">Este modelo no tiene restricciones registradas.</p>';
}

// «4 variables continuas · todas ≥ 0» cuando todas comparten tipo y límites.
function summarizeVariables(variables, boundsText) {
    const plural = { CONT: "continuas", ENT: "enteras", BIN: "binarias" };
    const type = plural[variables[0].tipo] || getVariableType(variables[0].tipo).toLowerCase();
    const bounds = boundsText(variables[0]);
    if (variables[0].tipo === "BIN") return `${variables.length} variables binarias (0 o 1)`;
    return bounds === "sin límites"
        ? `${variables.length} variables ${type} · sin límites`
        : `${variables.length} variables ${type} · todas ${bounds}`;
}

// Marca en el modelo qué restricciones limitan el resultado y cuánta
// holgura dejan las demás, a partir del análisis del solucionador.
function markConstraintAnalysis(result) {
    const rows = document.querySelectorAll("#constraints-list [data-constraint-name]");
    const analysis = new Map(
        (result?.detalles?.restricciones_analisis || []).map((item) => [item.nombre, item])
    );
    rows.forEach((row) => {
        const status = row.querySelector("[data-constraint-status]");
        const item = analysis.get(row.dataset.constraintName);
        row.classList.toggle("is-binding", Boolean(item?.activa));
        if (!item || result?.estado !== "OPT") {
            status.hidden = true;
            status.textContent = "";
            return;
        }
        status.hidden = false;
        const slack = smartNumber(Math.abs(Number(item.holgura)));
        const used = smartNumber(item.lado_izquierdo);
        const bound = smartNumber(item.lado_derecho);
        const usage = item.operador === "GE"
            ? `${used} (mínimo ${bound})`
            : item.operador === "LE"
                ? `${used} de ${bound}`
                : `${used} (= ${bound})`;
        status.textContent = item.activa
            ? `Limita el resultado · ${usage}`
            : item.operador === "GE"
                ? `${usage} · supera el mínimo en ${slack}`
                : item.operador === "LE"
                    ? `${usage} · sobran ${slack}`
                    : `${usage} · diferencia de ${slack}`;
    });
}

function showError(message) {
    errorMessage.textContent = message;
    errorMessage.hidden = false;
}

function getStatusLabel(status) {
    const labels = {
        OPT: "Óptimo",
        INF: "Infactible",
        UNB: "No acotado",
        TIME: "Tiempo agotado",
        ERR: "Error",
        PEND: "Pendiente"
    };

    return labels[status] || status || "Sin estado";
}

async function solveProblem() {
    if (selectedProblemId === null) {
        showError("Primero selecciona un problema.");
        return;
    }

    solveButton.disabled = true;
    solveButton.textContent = "Resolviendo...";
    errorMessage.hidden = true;
    resultsSection.hidden = true;
    markConstraintAnalysis(null);
    lastProblemExecutionId = null;
    document.querySelector('[data-report-message="problem"]').hidden = true;

    try {
        const submission = await requestJSON(
            `${API_URL}/problemas/${encodeURIComponent(selectedProblemId)}/resolver/`,
            { method: "POST" }
        );
        const result = await waitForOptimizationJob(
            submission,
            (jobStatus) => {
                solveButton.textContent = jobStatus === "queued"
                    ? "En cola..."
                    : "Calculando...";
            }
        );

        renderProblemResult(result);
    } catch (error) {
        showError(`No se pudo resolver el problema: ${error.message}`);
    } finally {
        solveButton.disabled = false;
        solveButton.innerHTML = "<span>▶</span> Resolver problema";
    }
}

function renderProblemResult(result) {
    const status = result.estado;
    const isOptimal = status === "OPT";
    lastProblemExecutionId = result.id;
    resetExplanation("problem", result);
    markConstraintAnalysis(result);

    document.getElementById("result-status").textContent =
        getStatusLabel(status);

    document.getElementById("result-status").classList.toggle(
        "bad",
        !isOptimal
    );

    document.getElementById("result-objective").textContent =
        result.valor_objetivo === null ||
        result.valor_objetivo === undefined
            ? "No disponible"
            : smartNumber(result.valor_objetivo);

    const values = result.valores || [];

    document.getElementById("solution-values").innerHTML =
        values.length > 0
            ? values.map((item) => `
                <div class="solution-card">
                    <span>${escapeHTML(item.variable_nombre || `Variable ${item.variable}`)}</span>
                    <strong>${escapeHTML(smartNumber(item.valor))}</strong>
                </div>
            `).join("")
            : '<p class="muted">No hay valores de solución disponibles.</p>';

    document.getElementById("result-message").textContent =
        result.mensaje || "El solucionador terminó la ejecución.";

    resultsSection.hidden = false;
    resultsSection.scrollIntoView({
        behavior: "smooth",
        block: "nearest"
    });
}

async function manageProblem(action) {
    if (selectedProblemId === null) return;
    const url = `${API_URL}/problemas/${encodeURIComponent(selectedProblemId)}/`;
    if (action === "edit") {
        window.dispatchEvent(new CustomEvent("problem:edit", {
            detail: { id: selectedProblemId }
        }));
        return;
    }

    try {
        if (action === "duplicate") {
            await requestJSON(`${url}duplicar/`, { method: "POST" });
        } else if (action === "archive") {
            await requestJSON(`${url}archivar/`, { method: "DELETE" });
            selectedProblemId = null;
            await loadProblems();
            await refreshDashboardAfterMutation();
            return;
        } else if (action === "delete") {
            const problemName = document.getElementById("problem-title").textContent;
            if (!window.confirm(
                `¿Eliminar permanentemente "${problemName}" y todo su historial? Esta acción no se puede deshacer.`
            )) {
                return;
            }
            await requestJSON(url, { method: "DELETE" });
            selectedProblemId = null;
            await loadProblems();
            await refreshDashboardAfterMutation();
            return;
        } else if (action === "history") {
            const history = await requestJSON(`${url}historial/`);
            showHistory(history, document.getElementById("problem-history-list"));
            document.getElementById("problem-history").hidden = false;
            return;
        }
        await loadProblems();
        await refreshDashboardAfterMutation();
    } catch (error) {
        showError(`No se pudo completar la acción: ${error.message}`);
    }
}

document.getElementById("dashboard-retry").addEventListener("click", () => {
    loadDashboard({ force: true });
});

document.getElementById("dashboard-refresh").addEventListener("click", () => {
    refreshDashboardAfterMutation();
});

const appSidebar = document.getElementById("app-sidebar");
const appMain = document.querySelector(".app-main");
const sidebarToggle = document.getElementById("sidebar-toggle");
const sidebarBackdrop = document.getElementById("sidebar-backdrop");
const profileDrawer = document.getElementById("profile-drawer");
const profileBackdrop = document.getElementById("profile-backdrop");
const profileDrawerClose = document.getElementById("profile-drawer-close");
let profileTrigger = null;

function setSidebarOpen(open, restoreFocus = false) {
    document.body.classList.toggle("sidebar-open", open);
    sidebarToggle.setAttribute("aria-expanded", String(open));
    sidebarToggle.setAttribute(
        "aria-label",
        open ? "Cerrar navegación" : "Abrir navegación"
    );
    sidebarBackdrop.hidden = !open;
    if (open) {
        appSidebar.querySelector("a")?.focus();
    } else if (restoreFocus) {
        sidebarToggle.focus();
    }
}

sidebarToggle.addEventListener("click", () => {
    setSidebarOpen(sidebarToggle.getAttribute("aria-expanded") !== "true");
});
sidebarBackdrop.addEventListener("click", () => setSidebarOpen(false, true));

function openProfileDrawer(trigger) {
    profileTrigger = trigger;
    profileDrawer.hidden = false;
    profileDrawer.setAttribute("aria-hidden", "false");
    profileBackdrop.hidden = false;
    document.body.classList.add("profile-open");
    setSidebarOpen(false);
    profileDrawerClose.focus();
}

function closeProfileDrawer() {
    if (profileDrawer.hidden) return;
    profileDrawer.hidden = true;
    profileDrawer.setAttribute("aria-hidden", "true");
    profileBackdrop.hidden = true;
    document.body.classList.remove("profile-open");
    profileTrigger?.focus();
    profileTrigger = null;
}

profileDrawerClose.addEventListener("click", closeProfileDrawer);
profileBackdrop.addEventListener("click", closeProfileDrawer);
appSidebar.addEventListener("click", (event) => {
    const profileButton = event.target.closest("[data-sidebar-profile]");
    if (profileButton) {
        openProfileDrawer(profileButton);
        return;
    }

    const link = event.target.closest("a[href^='#']");
    if (!link) return;

    appSidebar.querySelectorAll(".sidebar-link").forEach((item) => {
        item.classList.toggle("is-active", item === link);
        if (item === link) {
            item.setAttribute("aria-current", "page");
        } else {
            item.removeAttribute("aria-current");
        }
    });
    setSidebarOpen(false);
});
document.querySelector(".dashboard-user-card").addEventListener("click", (event) => {
    openProfileDrawer(event.currentTarget);
});
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("sidebar-open")) {
        setSidebarOpen(false, true);
    }
    if (event.key === "Escape" && !profileDrawer.hidden) {
        closeProfileDrawer();
    }
    if (event.key !== "Tab" || profileDrawer.hidden) return;
    const focusable = profileDrawer.querySelectorAll(
        "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
});
window.addEventListener("resize", () => {
    if (window.innerWidth > 1000 && document.body.classList.contains("sidebar-open")) {
        setSidebarOpen(false);
    }
});
window.addEventListener("hashchange", () => {
    syncAppView();
});

// El acceso «Asistente IA» lleva directo a la descripción del asistente.
document.querySelectorAll("[data-focus-ai]").forEach((link) => {
    link.addEventListener("click", () => {
        requestAnimationFrame(() => {
            const target = document.getElementById("problem-ai-assistant")
                || document.getElementById("problem-author-root");
            target?.scrollIntoView({ behavior: "smooth", block: "start" });
            document.getElementById("problem-ai-description")
                ?.focus({ preventScroll: true });
        });
    });
});

function syncAppView() {
    const targetId = window.location.hash.slice(1);
    const activeView = targetId === "portfolio-panel"
        ? "analysis"
        : targetId === "problem-workspace"
            ? "models"
            : "dashboard";
    appMain.dataset.activeView = activeView;
    appMain.querySelectorAll("[data-app-page]").forEach((page) => {
        page.hidden = page.dataset.appPage !== activeView;
    });
    appSidebar.querySelectorAll(".sidebar-link").forEach((item) => {
        const href = item.getAttribute("href");
        const active = activeView === "dashboard"
            ? href === "#dashboard"
            : activeView === "analysis"
                ? href === "#portfolio-panel"
                : href === "#problem-workspace";
        item.classList.toggle("is-active", active);
        if (active) {
            item.setAttribute("aria-current", "page");
        } else {
            item.removeAttribute("aria-current");
        }
    });
}

function navigateAppView(hash) {
    if (window.location.hash === hash) {
        syncAppView();
        return;
    }
    window.location.hash = hash;
    syncAppView();
}

const profileForm = document.getElementById("profile-form");
const profilePhotoInput = document.getElementById("profile-photo-input");

profilePhotoInput.addEventListener("change", () => {
    const file = profilePhotoInput.files[0];
    if (!file) {
        if (profilePreviewUrl) URL.revokeObjectURL(profilePreviewUrl);
        profilePreviewUrl = null;
        updateProfileFormState();
        return;
    }
    if (profilePreviewUrl) URL.revokeObjectURL(profilePreviewUrl);
    profilePreviewUrl = null;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        profilePhotoInput.value = "";
        showProfileMessage("Elige una imagen JPEG, PNG o WebP.", true);
        updateProfileFormState();
        return;
    }
    if (file.size > 768 * 1024) {
        profilePhotoInput.value = "";
        showProfileMessage("La imagen debe pesar 768 KiB o menos.", true);
        updateProfileFormState();
        return;
    }
    profilePreviewUrl = URL.createObjectURL(file);
    showProfileMessage("");
    updateProfileFormState();
});

profileForm.addEventListener("input", () => {
    showProfileMessage("");
    updateProfileFormState();
});

document.getElementById("profile-reset").addEventListener("click", () => {
    profileForm.reset();
    document.getElementById("profile-display-name").value =
        profileSnapshot.nombre_visible;
    document.getElementById("profile-description").value =
        profileSnapshot.descripcion;
    if (profilePreviewUrl) URL.revokeObjectURL(profilePreviewUrl);
    profilePreviewUrl = null;
    showProfileMessage("");
    updateProfileFormState();
});

profileForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showProfileMessage("");
    const submit = profileForm.querySelector("button[type='submit']");
    profileSaving = true;
    submit.textContent = "Guardando...";
    updateProfileFormState();
    try {
        const profile = await requestJSON(`${API_URL}/profile/`, {
            method: "PATCH",
            body: new FormData(profileForm)
        });
        const username = document.getElementById("account-name").textContent
            .replace(/^Conectado como /, "");
        renderUserProfile(profile, username);
        profilePhotoInput.value = "";
        if (profilePreviewUrl) URL.revokeObjectURL(profilePreviewUrl);
        profilePreviewUrl = null;
        showProfileMessage("Perfil actualizado.");
    } catch (error) {
        showProfileMessage(error.message, true);
    } finally {
        profileSaving = false;
        submit.textContent = "Guardar perfil";
        updateProfileFormState();
    }
});

document.getElementById("profile-remove-photo").addEventListener("click", async () => {
    showProfileMessage("");
    const removeButton = document.getElementById("profile-remove-photo");
    const pendingName = document.getElementById("profile-display-name").value;
    const pendingDescription =
        document.getElementById("profile-description").value;
    profileSaving = true;
    removeButton.disabled = true;
    removeButton.textContent = "Quitando...";
    updateProfileFormState();
    try {
        const data = new FormData();
        data.set("quitar_foto", "true");
        const profile = await requestJSON(`${API_URL}/profile/`, {
            method: "PATCH",
            body: data
        });
        const username = document.getElementById("account-name").textContent
            .replace(/^Conectado como /, "");
        renderUserProfile(profile, username);
        document.getElementById("profile-display-name").value = pendingName;
        document.getElementById("profile-description").value = pendingDescription;
        profilePhotoInput.value = "";
        if (profilePreviewUrl) URL.revokeObjectURL(profilePreviewUrl);
        profilePreviewUrl = null;
        updateProfileFormState();
        showProfileMessage("Foto de perfil eliminada.");
    } catch (error) {
        showProfileMessage(error.message, true);
    } finally {
        profileSaving = false;
        removeButton.textContent = "Quitar foto";
        updateProfileFormState();
    }
});

document.getElementById("dashboard-problems").addEventListener("click", (event) => {
    const button = event.target.closest("[data-dashboard-problem]");
    if (!button) return;
    loadProblem(button.dataset.dashboardProblem);
    document.querySelector(".details-panel")?.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
});

document.getElementById("dashboard-jobs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-job-open]");
    if (!button) return;
    openRecentJob(button.dataset.jobOpen, button);
});

document.getElementById("dashboard-portfolios").addEventListener("click", (event) => {
    const button = event.target.closest("[data-dashboard-portfolio-action]");
    if (!button) return;
    navigateAppView("#portfolio-panel");
    managePortfolio(
        button.dataset.dashboardPortfolioAction,
        button.dataset.dashboardPortfolioId,
        button
    );
    document.querySelector(".portfolio-panel")?.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
});

refreshButton.addEventListener("click", loadProblems);
document.getElementById("archived-toggle").addEventListener("click", (event) => {
    showArchivedProblems = !showArchivedProblems;
    event.currentTarget.textContent = showArchivedProblems ? "Activos" : "Archivados";
    selectedProblemId = null;
    loadProblems();
});
solveButton.addEventListener("click", solveProblem);
document.getElementById("edit-problem-button").addEventListener("click", () => manageProblem("edit"));
document.getElementById("duplicate-problem-button").addEventListener("click", () => manageProblem("duplicate"));
document.getElementById("archive-problem-button").addEventListener("click", () => manageProblem("archive"));
document.getElementById("delete-problem-button").addEventListener("click", () => manageProblem("delete"));
document.getElementById("problem-history-button").addEventListener("click", () => manageProblem("history"));
async function refreshSavedProblem(event) {
    selectedProblemId = event.detail.id;
    await loadProblems();
    await loadProblem(selectedProblemId);
    await refreshDashboardAfterMutation();
}

window.addEventListener("problem:created", refreshSavedProblem);
window.addEventListener("problem:updated", refreshSavedProblem);

document.querySelectorAll("[data-password-toggle]").forEach((button) => {
    const input = document.getElementById(button.dataset.passwordToggle);
    if (!input) return;
    button.setAttribute("aria-controls", input.id);
    button.addEventListener("click", () => {
        setPasswordVisibility(button, input.type === "password");
    });
});

loginTab.addEventListener("click", () => setAuthTab("login"));
registerTab.addEventListener("click", () => setAuthTab("register"));

if (authTabs) {
    authTabs.addEventListener("keydown", (event) => {
        const tabs = [loginTab, registerTab].filter((tab) => !tab.hidden);
        const currentIndex = tabs.indexOf(document.activeElement);
        if (currentIndex === -1) return;

        let nextIndex;
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
            nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
            nextIndex = (currentIndex + 1) % tabs.length;
        } else if (event.key === "Home") {
            nextIndex = 0;
        } else if (event.key === "End") {
            nextIndex = tabs.length - 1;
        } else {
            return;
        }

        event.preventDefault();
        setAuthTab(tabs[nextIndex] === registerTab ? "register" : "login", {
            focus: true
        });
    });
}

document.getElementById("login-form").addEventListener("submit", (event) => {
    submitAuthentication(event, "login");
});

document.getElementById("register-form").addEventListener("submit", (event) => {
    submitAuthentication(event, "registro");
});

const resendVerificationButton = document.getElementById("resend-verification-button");
const resendVerificationForm = document.getElementById("resend-verification-form");
const passwordResetButton = document.getElementById("password-reset-button");
const passwordResetForm = document.getElementById("password-reset-form");

resendVerificationButton.addEventListener("click", () => {
    toggleAuthHelpPanel(resendVerificationButton, resendVerificationForm);
});
passwordResetButton.addEventListener("click", () => {
    toggleAuthHelpPanel(passwordResetButton, passwordResetForm);
});

[
    [resendVerificationForm, resendVerificationButton],
    [passwordResetForm, passwordResetButton]
].forEach(([form, toggle]) => {
    form.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        closeAuthHelpPanels();
        toggle.focus();
    });
});

resendVerificationForm.addEventListener("submit", (event) => {
    submitAuthRequest(event, "verify/resend", "Si la cuenta existe y está pendiente, recibirás un correo.");
});
passwordResetForm.addEventListener("submit", (event) => {
    submitAuthRequest(event, "password-reset", "Si la cuenta existe, recibirás instrucciones por correo.");
});

document.getElementById("password-confirm-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!resetCredentials) return;
    const form = event.currentTarget;
    const submit = startAuthFormBusy(form, "Guardando…");
    if (!submit) return;

    setAuthMessage("");
    const password = new FormData(form).get("password");
    try {
        const result = await requestJSON(`${API_URL}/auth/password-reset/confirm/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...resetCredentials, password })
        });
        showAuthMessage(result.detail || "Contraseña actualizada. Ya puedes entrar.");
        form.reset();
        resetPasswordToggles(form);
        resetCredentials = null;
    } catch (error) {
        showAuthMessage(error.message, true);
    } finally {
        finishAuthFormBusy(form);
    }
});

// «Ver una demo»: cuenta temporal con los ejemplos ya resueltos.
document.getElementById("demo-button").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const label = button.querySelector("[data-demo-start-label]");
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    label.textContent = "Preparando la demo…";
    try {
        const user = await requestJSON(`${API_URL}/auth/demo/`, { method: "POST" });
        showApplication(user);
        await loadProblems();
        const message = document.getElementById("demo-data-message");
        message.classList.remove("error-message");
        message.hidden = false;
        try {
            await loadDemoData((text) => { message.textContent = `Cargando ejemplos: ${text}`; });
            message.textContent = "Ejemplos listos: abre «Ejemplo · Cartera balanceada» en Análisis o los modelos de ejemplo en Modelos.";
        } catch (error) {
            message.textContent = `No se pudieron cargar todos los ejemplos: ${error.message}`;
            message.classList.add("error-message");
        }
        await Promise.all([loadProblems(), loadPortfolios()]);
        await refreshDashboardAfterMutation();
    } catch (error) {
        setAuthMessage(`No se pudo abrir la demo: ${error.message}`, "error");
    } finally {
        button.disabled = false;
        button.removeAttribute("aria-busy");
        label.textContent = "Ver una demo sin registrarte";
    }
});

document.getElementById("demo-signup-button").addEventListener("click", async () => {
    try {
        await requestJSON(`${API_URL}/auth/logout/`, { method: "POST" });
    } finally {
        window.location.href = "/?registro=1";
    }
});

document.getElementById("logout-button").addEventListener("click", async () => {
    try {
        await requestJSON(`${API_URL}/auth/logout/`, { method: "POST" });
        showAuthentication();
    } catch (error) {
        showAuthentication(`No se pudo cerrar sesión: ${error.message}`, "error");
    }
});

document.getElementById("export-account-button").addEventListener("click", async () => {
    try {
        const response = await fetch(`${API_URL}/auth/export/`, {
            credentials: "same-origin"
        });
        if (!response.ok) {
            throw new Error(`No se pudo exportar la cuenta (${response.status}).`);
        }
        const blob = await response.blob();
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = "optportfolio-datos.json";
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    } catch (error) {
        window.alert(error.message);
    }
});

document.getElementById("delete-account-button").addEventListener("click", () => {
    const dialog = document.getElementById("delete-account-dialog");
    document.getElementById("delete-account-confirmation").value = "";
    document.getElementById("delete-account-password").value = "";
    document.getElementById("delete-account-message").hidden = true;
    dialog.showModal();
});
document.getElementById("cancel-delete-account").addEventListener("click", () => {
    document.getElementById("delete-account-dialog").close();
});
document.getElementById("change-password-button").addEventListener("click", () => {
    document.getElementById("change-password-form").reset();
    document.getElementById("change-password-message").hidden = true;
    document.getElementById("change-password-dialog").showModal();
});
document.getElementById("cancel-change-password").addEventListener("click", () => {
    document.getElementById("change-password-dialog").close();
});
document.getElementById("change-password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = document.getElementById("change-password-message");
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
        const result = await requestJSON(`${API_URL}/auth/change-password/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        message.classList.remove("error-message");
        message.textContent = result.detail;
        message.hidden = false;
        event.currentTarget.reset();
    } catch (error) {
        message.classList.add("error-message");
        message.textContent = error.message;
        message.hidden = false;
    }
});
document.getElementById("delete-account-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = document.getElementById("delete-account-message");
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
        await requestJSON(`${API_URL}/auth/delete/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        document.getElementById("delete-account-dialog").close();
        showAuthentication("La cuenta y sus datos fueron eliminados.", "success");
    } catch (error) {
        message.textContent = error.message;
        message.hidden = false;
    }
});

async function initialize() {
    const params = new URLSearchParams(window.location.search);
    const verificationToken = params.get("verify");
    const resetUid = params.get("reset_uid");
    const resetToken = params.get("reset_token");
    if (verificationToken || (resetUid && resetToken)) {
        window.history.replaceState({}, document.title, window.location.pathname);
    }
    if (verificationToken) {
        try {
            const result = await requestJSON(`${API_URL}/auth/verify/`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: verificationToken })
            });
            showAuthMessage(result.detail);
        } catch (error) {
            showAuthMessage(error.message, true);
        }
    }
    if (resetUid && resetToken) {
        resetCredentials = { uid: resetUid, token: resetToken };
        document.getElementById("password-confirm-form").hidden = false;
        loginForm.hidden = true;
        registerForm.hidden = true;
        authTabs.hidden = true;
        authHelpActions.hidden = true;
        authTitle.textContent = "Restablece tu contraseña";
        authSubtitle.textContent =
            "Crea una nueva contraseña para volver a entrar a tu cuenta.";
        showAuthentication();
        return;
    }
    try {
        const user = await requestJSON(`${API_URL}/auth/me/`);
        showApplication(user);
        await loadProblems();
    } catch (error) {
        if (error.status === 401) {
            try {
                const config = await requestJSON(`${API_URL}/auth/config/`);
                const registrationEnabled = Boolean(config.registration_enabled);
                document.getElementById("demo-access").hidden = !config.demo_enabled;
                document.querySelectorAll("[data-demo-ttl]").forEach((element) => {
                    element.textContent = String(config.demo_ttl_hours || 24);
                });
                registerTab.hidden = !registrationEnabled;
                authTabs.hidden = !registrationEnabled;
                const currentTone = authMessage.classList.contains("error-message")
                    ? "error"
                    : "success";
                showAuthentication(
                    registrationEnabled
                        ? authMessage.textContent
                        : "El registro de nuevas cuentas está cerrado.",
                    registrationEnabled ? currentTone : "info"
                );
                if (registrationEnabled && params.get("registro") === "1") {
                    window.history.replaceState({}, document.title, window.location.pathname);
                    setAuthTab("register");
                }
            } catch (configError) {
                showAuthentication(
                    `No fue posible conectar: ${configError.message}`,
                    "error"
                );
            }
            return;
        }
        showAuthentication(`No fue posible conectar: ${error.message}`, "error");
    }
}

const themeToggle = document.getElementById("theme-toggle");

function applyTheme(theme, persist = true) {
    const isDark = theme === "dark";
    document.body.classList.toggle("dark", isDark);
    if (persist) {
        localStorage.setItem("theme", isDark ? "dark" : "light");
    }
    if (themeToggle) {
        themeToggle.setAttribute("aria-pressed", String(isDark));
        themeToggle.setAttribute(
            "aria-label",
            isDark
                ? "Tema: oscuro. Activar modo claro."
                : "Tema: claro. Activar modo oscuro."
        );
        themeToggle.title = themeToggle.getAttribute("aria-label");
    }
    if (Object.keys(dashboardCharts).length) applyChartTheme();
}

if (themeToggle) {
    themeToggle.addEventListener("click", () => {
        animateThemeToggle();
        applyTheme(
            document.body.classList.contains("dark") ? "light" : "dark"
        );
    });
}
applyTheme(localStorage.getItem("theme") === "dark" ? "dark" : "light", false);

// Datos de ejemplo: dos modelos y un portafolio ya resueltos para que una
// cuenta nueva (o una demo) nunca se vea vacía. Usa la API normal, así que
// respeta los límites del plan y no duplica ejemplos ya cargados.
const demoVariable = (nombre, descripcion, unidad, tipo, superior = null) => ({
    nombre, descripcion, unidad, tipo, limite_inferior: "0", limite_superior: superior
});
const demoTerms = (names, coefficients) =>
    names.map((variable_nombre, index) => ({
        variable_nombre,
        coeficiente: String(coefficients[index])
    }));

const DEMO_FURNITURE = ["mesas", "sillas", "estantes"];
const DEMO_ROUTES = ["norte_a", "norte_b", "norte_c", "sur_a", "sur_b", "sur_c"];
const DEMO_PROBLEMS = [
    {
        nombre: "Ejemplo · Plan de producción de muebles",
        descripcion: "Cuántas mesas, sillas y estantes fabricar a la semana para maximizar la utilidad con las horas de carpintería y pintura y la madera disponibles.",
        tipo_objetivo: "MAX",
        variables: [
            demoVariable("mesas", "Mesas fabricadas por semana", "unidades", "ENT"),
            demoVariable("sillas", "Sillas fabricadas por semana", "unidades", "ENT", "50"),
            demoVariable("estantes", "Estantes fabricados por semana", "unidades", "ENT")
        ],
        terminos_objetivo: demoTerms(DEMO_FURNITURE, [40, 30, 25]),
        restricciones: [
            { nombre: "horas_carpinteria", operador: "LE", lado_derecho: "240", terminos: demoTerms(DEMO_FURNITURE, [4, 2, 3]) },
            { nombre: "horas_pintura", operador: "LE", lado_derecho: "120", terminos: demoTerms(DEMO_FURNITURE, [2, 1, 2]) },
            { nombre: "madera_m2", operador: "LE", lado_derecho: "300", terminos: demoTerms(DEMO_FURNITURE, [5, 2, 4]) }
        ]
    },
    {
        nombre: "Ejemplo · Distribución desde dos bodegas",
        descripcion: "Cuánto enviar desde las bodegas Norte y Sur a tres tiendas para cubrir la demanda al menor costo de transporte.",
        tipo_objetivo: "MIN",
        variables: DEMO_ROUTES.map((route) => demoVariable(
            route,
            `Unidades enviadas de la bodega ${route.startsWith("norte") ? "Norte" : "Sur"} a la tienda ${route.slice(-1).toUpperCase()}`,
            "unidades",
            "CONT"
        )),
        terminos_objetivo: demoTerms(DEMO_ROUTES, [4, 6, 9, 5, 3, 4]),
        restricciones: [
            { nombre: "capacidad_norte", operador: "LE", lado_derecho: "120", terminos: demoTerms(DEMO_ROUTES, [1, 1, 1, 0, 0, 0]) },
            { nombre: "capacidad_sur", operador: "LE", lado_derecho: "100", terminos: demoTerms(DEMO_ROUTES, [0, 0, 0, 1, 1, 1]) },
            { nombre: "demanda_tienda_a", operador: "GE", lado_derecho: "60", terminos: demoTerms(DEMO_ROUTES, [1, 0, 0, 1, 0, 0]) },
            { nombre: "demanda_tienda_b", operador: "GE", lado_derecho: "70", terminos: demoTerms(DEMO_ROUTES, [0, 1, 0, 0, 1, 0]) },
            { nombre: "demanda_tienda_c", operador: "GE", lado_derecho: "50", terminos: demoTerms(DEMO_ROUTES, [0, 0, 1, 0, 0, 1]) }
        ]
    }
];

const DEMO_PORTFOLIO = {
    nombre: "Ejemplo · Cartera balanceada",
    activos: ["Acciones EE. UU.", "Acciones emergentes", "Bonos del Tesoro", "Oro"],
    categorias: ["Renta variable", "Renta variable", "Renta fija", "Materias primas"],
    rendimientos_esperados: [0.09, 0.11, 0.04, 0.05],
    // Volatilidades de 16 %, 24 %, 6 % y 15 % con correlaciones ilustrativas.
    covarianza: [
        [0.0256, 0.0288, -0.00192, 0.0012],
        [0.0288, 0.0576, -0.00144, 0.0054],
        [-0.00192, -0.00144, 0.0036, 0.0018],
        [0.0012, 0.0054, 0.0018, 0.0225]
    ],
    aversion_riesgo: 2,
    pesos_minimos: [0, 0, 0.1, 0],
    pesos_maximos: [0.6, 0.4, 0.7, 0.25],
    limites_categoria: { "Renta variable": 0.7 },
    periodos_por_anio: 1,
    escenarios_estres: {
        "Recesión": [-0.25, -0.35, 0.06, 0.08],
        "Inflación alta": [-0.08, -0.12, -0.1, 0.15]
    }
};

let demoLoading = false;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// El servidor limita los cálculos por minuto; si pide esperar, se espera y se
// reintenta en lugar de dejar el ejemplo sin resolver.
async function solveDemoItem(url, onProgress) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const job = await requestJSON(url, { method: "POST" });
            return await waitForOptimizationJob(job);
        } catch (error) {
            if (error.status !== 429 || attempt === 2) throw error;
            const seconds = Math.min(
                Number(error.message.match(/(\d+)\s*(?:seconds?|segundos?)/i)?.[1]) || 60,
                90
            );
            for (let remaining = seconds; remaining > 0; remaining -= 1) {
                onProgress(`Esperando el límite de cálculos… ${remaining} s`);
                await sleep(1000);
            }
        }
    }
    return null;
}

async function loadDemoData(onProgress) {
    const [problems, portfolios] = await Promise.all([
        requestJSON(`${API_URL}/problemas/`),
        requestJSON(`${API_URL}/portafolios/`)
    ]);
    const problemsByName = new Map(problems.map((item) => [item.nombre, item]));
    const portfoliosByName = new Map(portfolios.map((item) => [item.nombre, item]));
    const jsonOptions = (payload) => ({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    // Cada tarea crea el ejemplo si falta, o lo resuelve si quedó sin resolver.
    const tasks = [];
    for (const problem of DEMO_PROBLEMS) {
        const existing = problemsByName.get(problem.nombre);
        if (existing) {
            const runs = await requestJSON(`${API_URL}/problemas/${encodeURIComponent(existing.id)}/historial/`);
            if (runs.length) continue;
        }
        tasks.push({ kind: "problemas", payload: problem, id: existing?.id });
    }
    const existingPortfolio = portfoliosByName.get(DEMO_PORTFOLIO.nombre);
    let portfolioPending = !existingPortfolio;
    if (existingPortfolio) {
        const runs = await requestJSON(`${API_URL}/portafolios/${encodeURIComponent(existingPortfolio.id)}/historial/`);
        portfolioPending = runs.length === 0;
    }
    if (portfolioPending) {
        tasks.push({ kind: "portafolios", payload: DEMO_PORTFOLIO, id: existingPortfolio?.id });
    }

    for (const [index, task] of tasks.entries()) {
        const step = (text) => onProgress(`${index + 1} de ${tasks.length} · ${text}`);
        step("Creando…");
        const id = task.id
            ?? (await requestJSON(`${API_URL}/${task.kind}/`, jsonOptions(task.payload))).id;
        step("Resolviendo…");
        await solveDemoItem(
            `${API_URL}/${task.kind}/${encodeURIComponent(id)}/resolver/`,
            (text) => step(text)
        );
    }
    return tasks.length;
}

async function handleDemoDataClick(button) {
    if (demoLoading) return;
    demoLoading = true;
    const label = button.querySelector("[data-demo-label]") || button;
    const originalText = label.textContent;
    const message = document.getElementById("demo-data-message");
    message.hidden = true;
    message.classList.remove("error-message");
    document.querySelectorAll("[data-load-demo]").forEach((item) => { item.disabled = true; });
    button.setAttribute("aria-busy", "true");
    try {
        const created = await loadDemoData((text) => { label.textContent = text; });
        message.textContent = created
            ? "Ejemplos listos: abre «Ejemplo · Cartera balanceada» en Análisis o los modelos de ejemplo en Modelos."
            : "Los ejemplos ya estaban cargados en tu cuenta.";
        await Promise.all([loadProblems(), loadPortfolios()]);
        await refreshDashboardAfterMutation();
    } catch (error) {
        message.textContent = `No se pudieron cargar todos los ejemplos: ${error.message}`;
        message.classList.add("error-message");
        await refreshDashboardAfterMutation();
    } finally {
        message.hidden = false;
        label.textContent = originalText;
        button.removeAttribute("aria-busy");
        document.querySelectorAll("[data-load-demo]").forEach((item) => { item.disabled = false; });
        demoLoading = false;
    }
}

document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-load-demo]");
    if (!button) return;
    if (button.closest("#profile-drawer")) {
        closeProfileDrawer();
        navigateAppView("#dashboard");
    }
    handleDemoDataClick(button);
});

initialize();
