
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
        throw error;
    }

    return data;
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

function renderFrontier(result) {
    const points = result.puntos || [];
    if (!points.length) {
        throw new Error("No se recibieron puntos para la frontera eficiente.");
    }
    const width = 700;
    const height = 360;
    const padding = { left: 72, right: 24, top: 24, bottom: 58 };
    const xValues = points.map((point) => Number(point.volatilidad_portafolio));
    const yValues = points.map((point) => Number(point.rendimientos_portafolio));
    const xMin = Math.min(...xValues);
    const xMax = Math.max(...xValues);
    const yMin = Math.min(...yValues);
    const yMax = Math.max(...yValues);
    const xSpan = xMax - xMin || 1;
    const ySpan = yMax - yMin || 1;
    const x = (value) => padding.left +
        ((value - xMin) / xSpan) * (width - padding.left - padding.right);
    const y = (value) => height - padding.bottom -
        ((value - yMin) / ySpan) * (height - padding.top - padding.bottom);
    const coordinates = points.map((point) =>
        `${x(Number(point.volatilidad_portafolio))},${y(Number(point.rendimientos_portafolio))}`
    ).join(" ");
    const circles = points.map((point) => `
        <circle cx="${x(Number(point.volatilidad_portafolio))}"
            cy="${y(Number(point.rendimientos_portafolio))}" r="4">
            <title>Volatilidad ${escapeHTML(formatNumber(point.volatilidad_portafolio))};
                rendimiento ${escapeHTML(formatNumber(point.rendimientos_portafolio))}</title>
        </circle>`).join("");
    document.getElementById("frontier-chart").innerHTML = `
        <svg class="frontier-svg" viewBox="0 0 ${width} ${height}" role="img"
            aria-label="Frontera eficiente: volatilidad frente a rendimiento">
            <line class="chart-axis" x1="${padding.left}" y1="${height - padding.bottom}"
                x2="${width - padding.right}" y2="${height - padding.bottom}"></line>
            <line class="chart-axis" x1="${padding.left}" y1="${padding.top}"
                x2="${padding.left}" y2="${height - padding.bottom}"></line>
            <polyline class="frontier-line" points="${coordinates}"></polyline>
            ${circles}
            <text class="chart-label" x="${width / 2}" y="${height - 12}" text-anchor="middle">Volatilidad (desviación estándar)</text>
            <text class="chart-label" transform="translate(18 ${height / 2}) rotate(-90)" text-anchor="middle">Rendimiento esperado</text>
            <text class="chart-tick" x="${padding.left}" y="${height - padding.bottom + 20}">${escapeHTML(formatNumber(xMin))}</text>
            <text class="chart-tick" x="${width - padding.right}" y="${height - padding.bottom + 20}" text-anchor="end">${escapeHTML(formatNumber(xMax))}</text>
            <text class="chart-tick" x="${padding.left - 8}" y="${height - padding.bottom}" text-anchor="end">${escapeHTML(formatNumber(yMin))}</text>
            <text class="chart-tick" x="${padding.left - 8}" y="${padding.top + 4}" text-anchor="end">${escapeHTML(formatNumber(yMax))}</text>
        </svg>`;
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
    const form = document.getElementById("portfolio-comparison-form");
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

function formatExpression(terms, variables = []) {
    if (!terms || terms.length === 0) {
        return "0";
    }

    return terms.map((term, index) => {
        const coefficient = Number(term.coeficiente);
        const variableName = getVariableName(term, variables);

        if (!Number.isFinite(coefficient)) {
            return `${term.coeficiente} · ${variableName}`;
        }

        const sign = coefficient < 0 ? "−" : "+";
        const absoluteValue = Math.abs(coefficient);
        const coefficientText = formatNumber(absoluteValue);

        let part = `${coefficientText} · ${variableName}`;

        if (index === 0) {
            return coefficient < 0 ? `−${part}` : part;
        }

        return `${sign} ${part}`;
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
    statusLabel.hidden = false;
    statusLabel.innerHTML = '<span class="status-dot"></span> Acceso seguro';
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

function showApplication(user) {
    document.body.classList.add("authenticated");
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

function showHistory(items, target, portfolio = false) {
    target.innerHTML = items.length
        ? items.map((item) => {
            const date = item.creada_en || item.iniciada_en;
            if (portfolio) {
                return `<div class="solution-card">
                    <span>${escapeHTML(new Date(date).toLocaleString())}</span>
                    <strong>Rendimiento ${formatNumber(item.rendimientos_portafolio)} · Volatilidad ${formatNumber(item.volatilidad_portafolio)}</strong>
                </div>
                <div class="muted">${escapeHTML(JSON.stringify(item.ponderaciones))}</div>`;
            }
            return `<div class="solution-card">
                <span>${escapeHTML(new Date(date).toLocaleString())} · ${escapeHTML(getStatusLabel(item.estado))}</span>
                <strong>${escapeHTML(formatNumber(item.valor_objetivo))}</strong>
            </div>`;
        }).join("")
        : '<p class="muted">Todavía no hay ejecuciones.</p>';
}

function portfolioPayload() {
    const form = document.getElementById("portfolio-form");
    const parseOptionalJson = (value, fallback) =>
        value.trim() ? JSON.parse(value) : fallback;
    const assetNames = form.elements.activos.value.split(",").map((name) => name.trim());
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
    form.elements.aversion_riesgo.value = portfolio.aversion_riesgo;
}

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
                button.dataset.id
            ));
        });
    } catch (error) {
        list.innerHTML = `<p class="muted">${escapeHTML(error.message)}</p>`;
    }
}

async function managePortfolio(action, id) {
    const url = `${API_URL}/portafolios/${encodeURIComponent(id)}/`;
    const message = document.getElementById("portfolio-message");
    message.hidden = true;
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
            const result = await requestJSON(`${url}resolver/`, { method: "POST" });
            lastPortfolioExecutionId = result.id;
            document.getElementById("portfolio-result-values").innerHTML = `
                <div class="solution-card"><span>Rendimiento esperado</span><strong>${formatNumber(result.rendimientos_portafolio)}</strong></div>
                <div class="solution-card"><span>Volatilidad</span><strong>${formatNumber(result.volatilidad_portafolio)}</strong></div>
                <div class="solution-card"><span>Utilidad ajustada por riesgo</span><strong>${formatNumber(result.utilidad_riesgo)}</strong></div>
                <div class="solution-card"><span>Rendimiento anualizado (aprox.)</span><strong>${formatNumber(result.rendimiento_anualizado * 100)} %</strong></div>
                <div class="solution-card"><span>Volatilidad anualizada (aprox.)</span><strong>${formatNumber(result.volatilidad_anualizada * 100)} %</strong></div>
                ${result.ponderaciones.map((weight, index) => `<div class="solution-card"><span>${escapeHTML(result.modelo_snapshot.activos[index])}</span><strong>${formatNumber(weight * 100)} %</strong></div>`).join("")}`;
            document.getElementById("portfolio-result-values").innerHTML +=
                result.contribuciones_riesgo.map((risk, index) => `
                    <div class="solution-card">
                        <span>Contribución al riesgo · ${escapeHTML(result.modelo_snapshot.activos[index])}</span>
                        <strong>${formatNumber(risk.contribucion_volatilidad * 100)} % (${formatNumber(risk.proporcion_volatilidad * 100)} % del riesgo)</strong>
                    </div>`).join("") +
                Object.entries(result.resultados_estres || {}).map(([scenario, value]) => `
                    <div class="solution-card">
                        <span>Escenario · ${escapeHTML(scenario)}</span>
                        <strong>${formatNumber(value * 100)} %</strong>
                    </div>`).join("");
            document.getElementById("portfolio-result").hidden = false;
            renderPortfolioComparisonInputs(result);
            await managePortfolio("history", id);
            return;
        }
        if (action === "frontier") {
            const result = await requestJSON(`${url}frontera/`);
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

    document.getElementById("variables-list").innerHTML =
        variables.length > 0
            ? variables.map((variable) => {
                const bounds = [];

                if (variable.limite_inferior !== null &&
                    variable.limite_inferior !== undefined) {
                    bounds.push(`Mín. ${formatNumber(variable.limite_inferior)}`);
                }

                if (variable.limite_superior !== null &&
                    variable.limite_superior !== undefined) {
                    bounds.push(`Máx. ${formatNumber(variable.limite_superior)}`);
                }

                return `
                    <div class="variable-card">
                        <span class="variable-name">${escapeHTML(variable.nombre)}</span>
                        <span class="variable-meta">
                            ${escapeHTML(getVariableType(variable.tipo))}
                        </span>
                        <span class="variable-meta">
                            ${escapeHTML(bounds.length ? bounds.join(" · ") : "Sin límites indicados")}
                        </span>
                    </div>
                `;
            }).join("")
            : '<p class="muted">Este modelo no tiene variables registradas.</p>';

    const objectivePrefix = getObjectiveLabel(problem.tipo_objetivo);

    document.getElementById("objective-formula").textContent =
        `${objectivePrefix} Z = ${formatExpression(objectiveTerms, variables)}`;

    document.getElementById("constraints-list").innerHTML =
        constraints.length > 0
            ? constraints.map((constraint, index) => {
                const expression = formatExpression(
                    constraint.terminos || [],
                    variables
                );

                return `
                    <div class="constraint-row">
                        <span class="constraint-name">
                            ${escapeHTML(constraint.nombre || `Restricción ${index + 1}`)}
                        </span>
                        <span class="constraint-formula">
                            ${escapeHTML(expression)}
                            ${escapeHTML(getOperator(constraint.operador))}
                            ${escapeHTML(formatNumber(constraint.lado_derecho))}
                        </span>
                    </div>
                `;
            }).join("")
            : '<p class="muted">Este modelo no tiene restricciones registradas.</p>';
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
    lastProblemExecutionId = null;
    document.querySelector('[data-report-message="problem"]').hidden = true;

    try {
        const result = await requestJSON(
            `${API_URL}/problemas/${encodeURIComponent(selectedProblemId)}/resolver/`,
            { method: "POST" }
        );

        const status = result.estado;
        const isOptimal = status === "OPT";
        lastProblemExecutionId = result.id;

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
                : formatNumber(result.valor_objetivo);

        const values = result.valores || [];

        document.getElementById("solution-values").innerHTML =
            values.length > 0
                ? values.map((item) => `
                    <div class="solution-card">
                        <span>${escapeHTML(item.variable_nombre || `Variable ${item.variable}`)}</span>
                        <strong>${escapeHTML(formatNumber(item.valor))}</strong>
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
    } catch (error) {
        showError(`No se pudo resolver el problema: ${error.message}`);
    } finally {
        solveButton.disabled = false;
        solveButton.innerHTML = "<span>▶</span> Resolver problema";
    }
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

document.getElementById("dashboard-portfolios").addEventListener("click", (event) => {
    const button = event.target.closest("[data-dashboard-portfolio-action]");
    if (!button) return;
    navigateAppView("#portfolio-panel");
    managePortfolio(
        button.dataset.dashboardPortfolioAction,
        button.dataset.dashboardPortfolioId
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

        let nextIndex = currentIndex;
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

initialize();
