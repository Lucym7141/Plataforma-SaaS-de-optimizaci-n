
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

function showApplication(user) {
    authPanel.hidden = true;
    appContent.hidden = false;
    accountControls.hidden = false;
    statusLabel.hidden = true;
    document.getElementById("account-name").textContent =
        `Conectado como ${user.username}`;
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
        showApplication(user);
        await loadProblems();
    } catch (error) {
        authMessage.textContent = error.message;
        authMessage.hidden = false;
    }
}

async function loadProblems() {
    problemsList.innerHTML = '<p class="muted">Cargando problemas...</p>';
    refreshButton.disabled = true;

    try {
        const problems = await requestJSON(`${API_URL}/problemas/`);

        if (!Array.isArray(problems)) {
            throw new Error("La API no devolvió una lista de problemas.");
        }

        if (problems.length === 0) {
            problemsList.innerHTML =
                '<p class="muted">No hay problemas activos disponibles.</p>';
            selectedProblemId = null;
            emptyState.hidden = false;
            problemContent.hidden = true;
            return;
        }

        problemsList.innerHTML = problems.map((problem) => {
            const id = getProblemId(problem);
            const selected = String(id) === String(selectedProblemId);

            return `
                <button
                    type="button"
                    class="problem-card ${selected ? "selected" : ""}"
                    data-problem-id="${escapeHTML(id)}"
                >
                    <span class="problem-card-title">
                        ${escapeHTML(problem.nombre || `Problema ${id}`)}
                    </span>
                    <span class="problem-card-meta">
                        ${escapeHTML(getObjectiveLabel(problem.tipo_objetivo))}
                    </span>
                </button>
            `;
        }).join("");

        problemsList.querySelectorAll("[data-problem-id]").forEach((button) => {
            button.addEventListener("click", () => {
                loadProblem(button.dataset.problemId);
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

        if (selectedProblemId === null) {
            await loadProblem(getProblemId(problems[0]));
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

        problemsList.querySelectorAll("[data-problem-id]").forEach((button) => {
            button.classList.toggle(
                "selected",
                button.dataset.problemId === String(problemId)
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

refreshButton.addEventListener("click", loadProblems);
solveButton.addEventListener("click", solveProblem);

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

document.getElementById("logout-button").addEventListener("click", async () => {
    try {
        await requestJSON(`${API_URL}/auth/logout/`, { method: "POST" });
        showAuthentication();
    } catch (error) {
        showAuthentication(`No se pudo cerrar sesión: ${error.message}`);
    }
});

async function initialize() {
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
                        ? ""
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
