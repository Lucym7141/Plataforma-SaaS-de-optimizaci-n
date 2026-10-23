
const API_URL = "/api";

const authPanel = document.getElementById("auth-panel");
const authMessage = document.getElementById("auth-message");
const appContent = document.getElementById("app-content");
const accountControls = document.querySelector(".account-controls");
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
let resetCredentials = null;
let showArchivedProblems = false;
let showArchivedPortfolios = false;

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

function showAuthentication(message = "") {
    authPanel.hidden = false;
    appContent.hidden = true;
    accountControls.hidden = true;
    statusLabel.hidden = false;
    statusLabel.innerHTML = '<span class="status-dot"></span> Acceso seguro';
    authMessage.textContent = message;
    authMessage.hidden = !message;
}

function showAuthMessage(message, isError = false) {
    authMessage.textContent = message;
    authMessage.classList.toggle("error-message", isError);
    authMessage.hidden = !message;
}

function showApplication(user) {
    authPanel.hidden = true;
    appContent.hidden = false;
    accountControls.hidden = false;
    statusLabel.hidden = true;
    document.getElementById("account-name").textContent =
        `Conectado como ${user.username}`;
    loadPortfolios();
}

async function submitAuthentication(event, endpoint) {
    event.preventDefault();
    authMessage.hidden = true;

    const formData = new FormData(event.currentTarget);
    const payload = Object.fromEntries(formData.entries());

    try {
        const user = await requestJSON(`${API_URL}/auth/${endpoint}/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        if (endpoint === "registro") {
            showAuthMessage(user.detail || "Revisa tu correo para activar la cuenta.");
            event.currentTarget.reset();
            return;
        }
        showApplication(user);
        await loadProblems();
    } catch (error) {
        showAuthMessage(error.message, true);
    }
}

async function submitAuthRequest(event, endpoint, successMessage) {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
        const response = await requestJSON(`${API_URL}/auth/${endpoint}/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        showAuthMessage(response.detail || successMessage);
        event.currentTarget.reset();
    } catch (error) {
        showAuthMessage(error.message, true);
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
            const result = await requestJSON(`${url}resolver/`, { method: "POST" });
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

    try {
        const result = await requestJSON(
            `${API_URL}/problemas/${encodeURIComponent(selectedProblemId)}/resolver/`,
            { method: "POST" }
        );

        const status = result.estado;
        const isOptimal = status === "OPT";

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
    try {
        if (action === "edit") {
            const problem = await requestJSON(url);
            const name = window.prompt("Nombre del problema", problem.nombre);
            if (name === null) return;
            const description = window.prompt(
                "Descripción del problema",
                problem.descripcion || ""
            );
            if (description === null) return;
            const variableNames = new Map(
                problem.variables.map((variable) => [String(variable.id), variable.nombre])
            );
            const payload = {
                nombre: name.trim(),
                descripcion: description,
                tipo_objetivo: problem.tipo_objetivo,
                variables: problem.variables.map(({ id, ...variable }) => variable),
                terminos_objetivo: problem.terminos_objetivo.map((term) => ({
                    variable_nombre: term.variable_nombre || variableNames.get(String(term.variable)),
                    coeficiente: term.coeficiente
                })),
                restricciones: problem.restricciones.map((constraint) => ({
                    nombre: constraint.nombre,
                    descripcion: constraint.descripcion,
                    operador: constraint.operador,
                    lado_derecho: constraint.lado_derecho,
                    terminos: constraint.terminos.map((term) => ({
                        variable_nombre: term.variable_nombre || variableNames.get(String(term.variable)),
                        coeficiente: term.coeficiente
                    }))
                }))
            };
            await requestJSON(url, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            await loadProblems();
            await loadProblem(selectedProblemId);
            return;
        }
        if (action === "duplicate") {
            await requestJSON(`${url}duplicar/`, { method: "POST" });
        } else if (action === "archive") {
            await requestJSON(`${url}archivar/`, { method: "DELETE" });
            selectedProblemId = null;
            await loadProblems();
            return;
        } else if (action === "history") {
            const history = await requestJSON(`${url}historial/`);
            showHistory(history, document.getElementById("problem-history-list"));
            document.getElementById("problem-history").hidden = false;
            return;
        }
        await loadProblems();
    } catch (error) {
        showError(`No se pudo completar la acción: ${error.message}`);
    }
}

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
document.getElementById("problem-history-button").addEventListener("click", () => manageProblem("history"));

document.getElementById("login-tab").addEventListener("click", () => {
    document.getElementById("login-form").hidden = false;
    document.getElementById("register-form").hidden = true;
    document.getElementById("login-tab").classList.add("selected");
    document.getElementById("register-tab").classList.remove("selected");
    document.getElementById("login-tab").setAttribute("aria-selected", "true");
    document.getElementById("register-tab").setAttribute("aria-selected", "false");
    document.getElementById("auth-title").textContent = "Inicia sesión";
    authMessage.hidden = true;
});

document.getElementById("register-tab").addEventListener("click", () => {
    document.getElementById("login-form").hidden = true;
    document.getElementById("register-form").hidden = false;
    document.getElementById("login-tab").classList.remove("selected");
    document.getElementById("register-tab").classList.add("selected");
    document.getElementById("login-tab").setAttribute("aria-selected", "false");
    document.getElementById("register-tab").setAttribute("aria-selected", "true");
    document.getElementById("auth-title").textContent = "Crea tu cuenta";
    authMessage.hidden = true;
});

document.getElementById("login-form").addEventListener("submit", (event) => {
    submitAuthentication(event, "login");
});

document.getElementById("register-form").addEventListener("submit", (event) => {
    submitAuthentication(event, "registro");
});

document.getElementById("resend-verification-button").addEventListener("click", () => {
    const form = document.getElementById("resend-verification-form");
    form.hidden = !form.hidden;
});
document.getElementById("password-reset-button").addEventListener("click", () => {
    const form = document.getElementById("password-reset-form");
    form.hidden = !form.hidden;
});
document.getElementById("resend-verification-form").addEventListener("submit", (event) => {
    submitAuthRequest(event, "verify/resend", "Si la cuenta existe y está pendiente, recibirás un correo.");
});
document.getElementById("password-reset-form").addEventListener("submit", (event) => {
    submitAuthRequest(event, "password-reset", "Si la cuenta existe, recibirás instrucciones por correo.");
});
document.getElementById("password-confirm-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!resetCredentials) return;
    const password = new FormData(event.currentTarget).get("password");
    try {
        const result = await requestJSON(`${API_URL}/auth/password-reset/confirm/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...resetCredentials, password })
        });
        showAuthMessage(result.detail || "Contraseña actualizada. Ya puedes entrar.");
        event.currentTarget.reset();
        resetCredentials = null;
    } catch (error) {
        showAuthMessage(error.message, true);
    }
});

document.getElementById("logout-button").addEventListener("click", async () => {
    try {
        await requestJSON(`${API_URL}/auth/logout/`, { method: "POST" });
        showAuthentication();
    } catch (error) {
        showAuthentication(`No se pudo cerrar sesión: ${error.message}`);
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
        showAuthentication("La cuenta y sus datos fueron eliminados.");
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
        document.getElementById("login-form").hidden = true;
        document.getElementById("register-form").hidden = true;
        document.querySelector(".auth-tabs").hidden = true;
        document.getElementById("auth-title").textContent =
            "Restablece tu contraseña";
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
                document.getElementById("register-tab").hidden =
                    !config.registration_enabled;
                showAuthentication(
                    config.registration_enabled
                        ? authMessage.textContent
                        : "El registro de nuevas cuentas está cerrado."
                );
            } catch (configError) {
                showAuthentication(`No fue posible conectar: ${configError.message}`);
            }
            return;
        }
        showAuthentication(`No fue posible conectar: ${error.message}`);
    }
}

initialize();
