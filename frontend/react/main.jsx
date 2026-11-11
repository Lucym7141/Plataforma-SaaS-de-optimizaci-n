import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

const initialPreview = {
    displayName: "Usuario",
    description: "",
    imageUrl: null,
    nameLength: 0,
    descriptionLength: 0
};

function ProfilePreview() {
    const [preview, setPreview] = useState(
        () => window.profilePreviewData || initialPreview
    );

    useEffect(() => {
        const updatePreview = () => {
            setPreview(window.profilePreviewData || initialPreview);
        };
        window.addEventListener("profile:preview", updatePreview);
        window.dispatchEvent(new Event("profile:preview-ready"));
        return () => {
            window.removeEventListener("profile:preview", updatePreview);
        };
    }, []);

    const hasPhoto = Boolean(preview.imageUrl);

    return (
        <>
            <div className="profile-preview-orbit" aria-hidden="true" />
            <div className="profile-preview-user" data-react-component="profile-preview">
                {hasPhoto ? (
                    <img
                        id="profile-preview-photo"
                        className="profile-preview-avatar"
                        src={preview.imageUrl}
                        alt=""
                    />
                ) : (
                    <span
                        id="profile-preview-avatar"
                        className="profile-preview-avatar"
                        aria-hidden="true"
                    >
                        {preview.displayName.charAt(0).toUpperCase() || "U"}
                    </span>
                )}
                <div className="profile-preview-copy">
                    <span className="profile-preview-label">VISTA PREVIA</span>
                    <strong id="profile-preview-name">{preview.displayName}</strong>
                    <span id="profile-preview-description">
                        {preview.description || "Tu descripción aparecerá aquí."}
                    </span>
                </div>
            </div>
        </>
    );
}

function emptyVariable(index) {
    return {
        nombre: `x${index + 1}`,
        descripcion: "",
        unidad: "",
        tipo: "CONT",
        limite_inferior: "0",
        limite_superior: "",
        coeficiente_objetivo: "0"
    };
}

function emptyConstraint(index, variableCount) {
    return {
        nombre: `restriccion_${index + 1}`,
        operador: "LE",
        lado_derecho: "0",
        coeficientes: Array(variableCount).fill("0")
    };
}

const optimizationTemplates = [
    {
        id: "investment",
        title: "Asignación de inversión",
        category: "Finanzas",
        description: "Distribuye el capital entre bonos y acciones con topes por activo.",
        name: "Asignación simple de inversión",
        objectiveType: "MAX",
        variables: [
            {
                nombre: "bonos",
                descripcion: "Capital asignado a bonos",
                unidad: "unidades de capital",
                tipo: "CONT",
                limite_inferior: "0",
                limite_superior: "1",
                coeficiente_objetivo: "0.04"
            },
            {
                nombre: "acciones",
                descripcion: "Capital asignado a acciones",
                unidad: "unidades de capital",
                tipo: "CONT",
                limite_inferior: "0",
                limite_superior: "1",
                coeficiente_objetivo: "0.10"
            }
        ],
        constraints: [
            { nombre: "presupuesto_total", operador: "EQ", lado_derecho: "1", coeficientes: ["1", "1"] },
            { nombre: "tope_acciones", operador: "LE", lado_derecho: "0.6", coeficientes: ["0", "1"] }
        ]
    },
    {
        id: "regulated-portfolio",
        title: "Portafolio regulado (Ejercicio 5)",
        category: "Finanzas",
        description: "Maximiza el rendimiento anual con presupuesto, límites por activo y riesgo ponderado máximo de 4.2.",
        name: "Ejercicio 5 - Portafolio financiero con riesgo",
        objectiveType: "MAX",
        variables: [
            { nombre: "x1", descripcion: "Bonos del Tesoro", unidad: "millones de USD", tipo: "CONT", limite_inferior: "0", limite_superior: "", coeficiente_objetivo: "50000" },
            { nombre: "x2", descripcion: "Acciones tecnológicas", unidad: "millones de USD", tipo: "CONT", limite_inferior: "0", limite_superior: "", coeficiente_objetivo: "140000" },
            { nombre: "x3", descripcion: "Bienes raíces", unidad: "millones de USD", tipo: "CONT", limite_inferior: "0", limite_superior: "", coeficiente_objetivo: "90000" },
            { nombre: "x4", descripcion: "Bonos corporativos", unidad: "millones de USD", tipo: "CONT", limite_inferior: "0", limite_superior: "", coeficiente_objetivo: "80000" },
            { nombre: "x5", descripcion: "Fondos energéticos", unidad: "millones de USD", tipo: "CONT", limite_inferior: "0", limite_superior: "", coeficiente_objetivo: "120000" }
        ],
        constraints: [
            { nombre: "presupuesto_total", operador: "EQ", lado_derecho: "10", coeficientes: ["1", "1", "1", "1", "1"] },
            { nombre: "minimo_bonos_tesoro", operador: "GE", lado_derecho: "2", coeficientes: ["1", "0", "0", "0", "0"] },
            { nombre: "tope_acciones_tecnologicas", operador: "LE", lado_derecho: "1.5", coeficientes: ["0", "1", "0", "0", "0"] },
            { nombre: "minimo_bienes_raices_energia", operador: "GE", lado_derecho: "3", coeficientes: ["0", "0", "1", "0", "1"] },
            { nombre: "riesgo_ponderado_maximo", operador: "LE", lado_derecho: "42", coeficientes: ["1", "8", "4", "3", "6"] }
        ]
    },
    {
        id: "transport",
        title: "Transporte y distribución",
        category: "Logística",
        description: "Minimiza costos de envío respetando oferta de plantas y demanda de destinos.",
        name: "Plan de transporte",
        objectiveType: "MIN",
        variables: [
            { nombre: "planta_a_destino_1", descripcion: "Envío de planta A a destino 1", unidad: "unidades", tipo: "CONT", limite_inferior: "0", limite_superior: "", coeficiente_objetivo: "4" },
            { nombre: "planta_a_destino_2", descripcion: "Envío de planta A a destino 2", unidad: "unidades", tipo: "CONT", limite_inferior: "0", limite_superior: "", coeficiente_objetivo: "6" },
            { nombre: "planta_b_destino_1", descripcion: "Envío de planta B a destino 1", unidad: "unidades", tipo: "CONT", limite_inferior: "0", limite_superior: "", coeficiente_objetivo: "5" },
            { nombre: "planta_b_destino_2", descripcion: "Envío de planta B a destino 2", unidad: "unidades", tipo: "CONT", limite_inferior: "0", limite_superior: "", coeficiente_objetivo: "3" }
        ],
        constraints: [
            { nombre: "oferta_planta_a", operador: "LE", lado_derecho: "100", coeficientes: ["1", "1", "0", "0"] },
            { nombre: "oferta_planta_b", operador: "LE", lado_derecho: "80", coeficientes: ["0", "0", "1", "1"] },
            { nombre: "demanda_destino_1", operador: "GE", lado_derecho: "70", coeficientes: ["1", "0", "1", "0"] },
            { nombre: "demanda_destino_2", operador: "GE", lado_derecho: "60", coeficientes: ["0", "1", "0", "1"] }
        ]
    },
    {
        id: "diet",
        title: "Plan de dieta",
        category: "Nutrición",
        description: "Minimiza el costo de dos alimentos cumpliendo requisitos nutricionales ilustrativos.",
        name: "Plan de dieta de mínimo costo",
        objectiveType: "MIN",
        variables: [
            { nombre: "legumbres", descripcion: "Porciones de legumbres", unidad: "porciones", tipo: "CONT", limite_inferior: "0", limite_superior: "", coeficiente_objetivo: "1.2" },
            { nombre: "cereal", descripcion: "Porciones de cereal", unidad: "porciones", tipo: "CONT", limite_inferior: "0", limite_superior: "", coeficiente_objetivo: "0.8" }
        ],
        constraints: [
            { nombre: "proteina_minima", operador: "GE", lado_derecho: "40", coeficientes: ["8", "2"] },
            { nombre: "energia_minima", operador: "GE", lado_derecho: "60", coeficientes: ["3", "10"] }
        ]
    },
    {
        id: "production",
        title: "Plan de producción",
        category: "Operaciones",
        description: "Maximiza utilidad con límites de horas de trabajo y materia prima.",
        name: "Plan de producción",
        objectiveType: "MAX",
        variables: [
            { nombre: "producto_a", descripcion: "Unidades producidas del producto A", unidad: "unidades", tipo: "ENT", limite_inferior: "0", limite_superior: "", coeficiente_objetivo: "30" },
            { nombre: "producto_b", descripcion: "Unidades producidas del producto B", unidad: "unidades", tipo: "ENT", limite_inferior: "0", limite_superior: "", coeficiente_objetivo: "45" }
        ],
        constraints: [
            { nombre: "horas_trabajo", operador: "LE", lado_derecho: "100", coeficientes: ["2", "4"] },
            { nombre: "materia_prima", operador: "LE", lado_derecho: "80", coeficientes: ["3", "2"] }
        ]
    }
];

function csrfToken() {
    return document.cookie
        .split("; ")
        .find((cookie) => cookie.startsWith("csrftoken="))
        ?.slice("csrftoken=".length);
}

function formatApiError(data) {
    const messages = [];
    const collect = (value) => {
        if (typeof value === "string") {
            messages.push(value);
        } else if (Array.isArray(value)) {
            value.forEach(collect);
        } else if (value && typeof value === "object") {
            Object.values(value).forEach(collect);
        }
    };
    collect(data);
    return messages.join(" ") || "No se pudo guardar el modelo.";
}

function ProblemAuthor() {
    const [open, setOpen] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [loadingExisting, setLoadingExisting] = useState(false);
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [objectiveType, setObjectiveType] = useState("MAX");
    const [variables, setVariables] = useState([emptyVariable(0)]);
    const [constraints, setConstraints] = useState([]);
    const [saving, setSaving] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [problemDescriptionText, setProblemDescriptionText] = useState("");
    const [assistantMessage, setAssistantMessage] = useState("");
    const [assistantError, setAssistantError] = useState(false);
    const [message, setMessage] = useState("");
    const [isError, setIsError] = useState(false);

    const generateFromDescription = async (event) => {
        event.preventDefault();
        setGenerating(true);
        setAssistantMessage("");
        setAssistantError(false);
        try {
            const headers = { "Content-Type": "application/json" };
            const token = csrfToken();
            if (token) headers["X-CSRFToken"] = token;
            const response = await fetch("/api/problemas/generar/", {
                method: "POST",
                credentials: "same-origin",
                headers,
                body: JSON.stringify({ texto: problemDescriptionText.trim() })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(formatApiError(result));

            const objectiveByName = new Map(
                result.terminos_objetivo.map((term) => [
                    term.variable_nombre,
                    String(term.coeficiente)
                ])
            );
            const nextVariables = result.variables.map((variable) => ({
                nombre: variable.nombre,
                descripcion: variable.descripcion || "",
                unidad: variable.unidad || "",
                tipo: variable.tipo,
                limite_inferior: variable.limite_inferior ?? "",
                limite_superior: variable.limite_superior ?? "",
                coeficiente_objetivo: objectiveByName.get(variable.nombre) || "0"
            }));
            setEditingId(null);
            setName(result.nombre);
            setDescription(result.descripcion || "");
            setObjectiveType(result.tipo_objetivo);
            setVariables(nextVariables);
            setConstraints(result.restricciones.map((constraint) => {
                const coefficients = new Map(
                    constraint.terminos.map((term) => [
                        term.variable_nombre,
                        String(term.coeficiente)
                    ])
                );
                return {
                    nombre: constraint.nombre,
                    operador: constraint.operador,
                    lado_derecho: String(constraint.lado_derecho),
                    coeficientes: nextVariables.map((variable) =>
                        coefficients.get(variable.nombre) || "0"
                    )
                };
            }));
            setOpen(true);
            setAssistantMessage(
                "Borrador generado. Revisa y corrige cada valor antes de crear el modelo."
            );
        } catch (error) {
            setAssistantError(true);
            setAssistantMessage(error.message);
        } finally {
            setGenerating(false);
        }
    };

    const useTemplate = (template) => {
        setEditingId(null);
        setName(template.name);
        setDescription(template.description);
        setObjectiveType(template.objectiveType);
        setVariables(template.variables.map((variable) => ({ ...variable })));
        setConstraints(template.constraints.map((constraint) => ({
            ...constraint,
            coeficientes: [...constraint.coeficientes]
        })));
        setOpen(true);
        setIsError(false);
        setMessage(`Plantilla «${template.title}» cargada. Revisa los datos antes de crear el modelo.`);
    };

    useEffect(() => {
        const loadProblemForEditing = async (event) => {
            const id = event.detail?.id;
            if (!id) return;
            setOpen(true);
            setLoadingExisting(true);
            setEditingId(id);
            setMessage("");
            setIsError(false);
            try {
                const response = await fetch(
                    `/api/problemas/${encodeURIComponent(id)}/`,
                    { credentials: "same-origin" }
                );
                const problem = await response.json();
                if (!response.ok) throw new Error(formatApiError(problem));

                const objectiveByName = new Map(
                    problem.terminos_objetivo.map((term) => [
                        term.variable_nombre ||
                            String(term.variable),
                        term.coeficiente
                    ])
                );
                const variablesById = new Map(
                    problem.variables.map((variable) => [
                        String(variable.id),
                        variable.nombre
                    ])
                );
                const nextVariables = problem.variables.map((variable) => {
                    const objectiveCoefficient =
                        objectiveByName.get(variable.nombre) ??
                        objectiveByName.get(String(variable.id)) ??
                        "0";
                    return {
                        nombre: variable.nombre,
                        descripcion: variable.descripcion || "",
                        unidad: variable.unidad || "",
                        tipo: variable.tipo,
                        limite_inferior: variable.limite_inferior ?? "",
                        limite_superior: variable.limite_superior ?? "",
                        coeficiente_objetivo: String(objectiveCoefficient)
                    };
                });
                setName(problem.nombre || "");
                setDescription(problem.descripcion || "");
                setObjectiveType(problem.tipo_objetivo);
                setVariables(nextVariables);
                setConstraints(problem.restricciones.map((constraint) => {
                    const coefficients = new Map(
                        constraint.terminos.map((term) => [
                            term.variable_nombre ||
                                variablesById.get(String(term.variable)),
                            String(term.coeficiente)
                        ])
                    );
                    return {
                        nombre: constraint.nombre,
                        operador: constraint.operador,
                        lado_derecho: String(constraint.lado_derecho),
                        coeficientes: nextVariables.map((variable) =>
                            coefficients.get(variable.nombre) || "0"
                        )
                    };
                }));
            } catch (error) {
                setOpen(false);
                setEditingId(null);
                setIsError(true);
                setMessage(`No se pudo cargar el modelo: ${error.message}`);
            } finally {
                setLoadingExisting(false);
            }
        };
        window.addEventListener("problem:edit", loadProblemForEditing);
        return () => {
            window.removeEventListener("problem:edit", loadProblemForEditing);
        };
    }, []);

    const updateVariable = (index, field, value) => {
        setVariables((current) => current.map((variable, itemIndex) =>
            itemIndex === index
                ? { ...variable, [field]: value }
                : variable
        ));
    };

    const addVariable = () => {
        setVariables((current) => [...current, emptyVariable(current.length)]);
        setConstraints((current) => current.map((constraint) => ({
            ...constraint,
            coeficientes: [...constraint.coeficientes, "0"]
        })));
    };

    const removeVariable = (index) => {
        if (variables.length === 1) return;
        setVariables((current) => current.filter((_, itemIndex) =>
            itemIndex !== index
        ));
        setConstraints((current) => current.map((constraint) => ({
            ...constraint,
            coeficientes: constraint.coeficientes.filter(
                (_, itemIndex) => itemIndex !== index
            )
        })));
    };

    const updateConstraint = (index, field, value) => {
        setConstraints((current) => current.map((constraint, itemIndex) =>
            itemIndex === index
                ? { ...constraint, [field]: value }
                : constraint
        ));
    };

    const updateConstraintCoefficient = (constraintIndex, variableIndex, value) => {
        setConstraints((current) => current.map((constraint, itemIndex) => {
            if (itemIndex !== constraintIndex) return constraint;
            const coefficients = [...constraint.coeficientes];
            coefficients[variableIndex] = value;
            return { ...constraint, coeficientes: coefficients };
        }));
    };

    const resetForm = () => {
        setName("");
        setDescription("");
        setObjectiveType("MAX");
        setVariables([emptyVariable(0)]);
        setConstraints([]);
    };

    const cancelEditing = () => {
        setOpen(false);
        setEditingId(null);
        setLoadingExisting(false);
        resetForm();
        setMessage("");
        setIsError(false);
    };

    const submit = async (event) => {
        event.preventDefault();
        if (loadingExisting) return;
        setSaving(true);
        setMessage("");
        setIsError(false);
        const payload = {
            nombre: name.trim(),
            descripcion: description.trim(),
            tipo_objetivo: objectiveType,
            variables: variables.map((variable) => ({
                nombre: variable.nombre.trim(),
                descripcion: variable.descripcion.trim(),
                unidad: variable.unidad.trim(),
                tipo: variable.tipo,
                limite_inferior: variable.tipo === "BIN"
                    ? "0"
                    : variable.limite_inferior || null,
                limite_superior: variable.tipo === "BIN"
                    ? "1"
                    : variable.limite_superior || null
            })),
            terminos_objetivo: variables.map((variable) => ({
                variable_nombre: variable.nombre.trim(),
                coeficiente: variable.coeficiente_objetivo || "0"
            })),
            restricciones: constraints.map((constraint) => ({
                nombre: constraint.nombre.trim(),
                operador: constraint.operador,
                lado_derecho: constraint.lado_derecho,
                terminos: variables.map((variable, index) => ({
                    variable_nombre: variable.nombre.trim(),
                    coeficiente: constraint.coeficientes[index] || "0"
                }))
            }))
        };

        try {
            const headers = { "Content-Type": "application/json" };
            const token = csrfToken();
            if (token) headers["X-CSRFToken"] = token;
            const response = await fetch(
                editingId
                    ? `/api/problemas/${encodeURIComponent(editingId)}/`
                    : "/api/problemas/",
                {
                    method: editingId ? "PUT" : "POST",
                    credentials: "same-origin",
                    headers,
                    body: JSON.stringify(payload)
                }
            );
            const data = await response.json();
            if (!response.ok) throw new Error(formatApiError(data));
            window.dispatchEvent(new CustomEvent(
                editingId ? "problem:updated" : "problem:created",
                {
                    detail: { id: data.id }
                }
            ));
            resetForm();
            setOpen(false);
            setMessage(editingId
                ? `Modelo "${data.nombre}" actualizado.`
                : `Modelo "${data.nombre}" creado y abierto.`);
            setEditingId(null);
        } catch (error) {
            setIsError(true);
            setMessage(error.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="react-problem-author">
            <section className="problem-ai-assistant">
                <h3>Asistente de modelos con IA</h3>
                <p className="muted">
                    Describe el objetivo, las decisiones y las restricciones para recibir
                    un borrador editable. La IA puede equivocarse: revisa los datos antes
                    de guardar o resolver.
                </p>
                <p id="problem-ai-privacy" className="problem-ai-privacy">
                    Al generar, el texto se envía a Azure OpenAI. No se guarda hasta que
                    confirmes la creación del modelo.
                </p>
                <form onSubmit={generateFromDescription}>
                    <label htmlFor="problem-ai-description">
                        Descripción del problema
                    </label>
                    <textarea
                        id="problem-ai-description"
                        value={problemDescriptionText}
                        onChange={(event) =>
                            setProblemDescriptionText(event.target.value)
                        }
                        minLength={20}
                        maxLength={6000}
                        rows={5}
                        required
                        placeholder="Ejemplo: Maximizar la utilidad produciendo dos productos. Cada unidad de A aporta 30 y usa 2 horas; cada unidad de B aporta 45 y usa 4 horas. Hay 100 horas disponibles. Las unidades deben ser enteras."
                        aria-describedby="problem-ai-privacy"
                    />
                    <button
                        className="primary-button"
                        type="submit"
                        disabled={generating || problemDescriptionText.trim().length < 20}
                        aria-busy={generating}
                    >
                        {generating
                            ? "Generando borrador..."
                            : "Generar borrador con IA"}
                    </button>
                    {assistantMessage && (
                        <p
                            className={assistantError
                                ? "message error-message"
                                : "message success-message"}
                            role={assistantError ? "alert" : "status"}
                        >
                            {assistantMessage}
                        </p>
                    )}
                </form>
            </section>
            <details className="problem-template-library">
                <summary>Biblioteca de plantillas</summary>
                <p className="muted">
                    Carga un modelo de ejemplo en el constructor; podrás ajustarlo antes de guardarlo.
                    Los valores son ilustrativos y debes adaptarlos a tu caso.
                </p>
                <div className="problem-template-grid">
                    {optimizationTemplates.map((template) => (
                        <article className="problem-template-card" key={template.id}>
                            <span className="problem-template-category">{template.category}</span>
                            <h3>{template.title}</h3>
                            <p>{template.description}</p>
                            <button
                                className="secondary-button"
                                type="button"
                                onClick={() => useTemplate(template)}
                            >
                                Usar plantilla
                            </button>
                        </article>
                    ))}
                </div>
            </details>
            <button
                className="primary-button"
                type="button"
                aria-expanded={open}
                aria-controls="problem-author-form"
                onClick={() => {
                    if (open) {
                        cancelEditing();
                    } else {
                        setOpen(true);
                        setEditingId(null);
                        resetForm();
                        setMessage("");
                    }
                }}
            >
                {open ? "Cancelar" : "＋ Crear problema"}
            </button>
            {message && (
                <p className={isError ? "message error-message" : "message success-message"}
                    role={isError ? "alert" : "status"}>
                    {message}
                </p>
            )}
            {open && (
                loadingExisting ? (
                    <p className="muted" role="status">Cargando modelo para editar...</p>
                ) : (
                <form
                    id="problem-author-form"
                    className="problem-author-form"
                    onSubmit={submit}
                    aria-busy={saving}>
                    <h3>
                        {editingId
                            ? "Editar modelo de optimización"
                            : "Nuevo modelo de optimización"}
                    </h3>
                    <label>
                        Nombre del modelo
                        <input
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            maxLength={150}
                            required
                        />
                    </label>
                    <label>
                        Descripción (opcional)
                        <textarea
                            value={description}
                            onChange={(event) => setDescription(event.target.value)}
                            rows={2}
                        />
                    </label>
                    <label>
                        Objetivo
                        <select
                            value={objectiveType}
                            onChange={(event) => setObjectiveType(event.target.value)}
                        >
                            <option value="MAX">Maximizar</option>
                            <option value="MIN">Minimizar</option>
                        </select>
                    </label>

                    <div className="problem-author-section">
                        <div className="problem-author-section-heading">
                            <h4>Variables y función objetivo</h4>
                            <button
                                className="secondary-button"
                                type="button"
                                disabled={variables.length >= 100}
                                onClick={addVariable}
                            >
                                Añadir variable
                            </button>
                        </div>
                        {variables.map((variable, index) => (
                            <fieldset className="problem-author-variable" key={index}>
                                <legend>Variable {index + 1}</legend>
                                <label>
                                    Nombre
                                    <input
                                        value={variable.nombre}
                                        onChange={(event) => updateVariable(
                                            index, "nombre", event.target.value
                                        )}
                                        maxLength={100}
                                        required
                                    />
                                </label>
                                <label>
                                    Tipo
                                    <select
                                        value={variable.tipo}
                                        onChange={(event) => updateVariable(
                                            index, "tipo", event.target.value
                                        )}
                                    >
                                        <option value="CONT">Continua</option>
                                        <option value="ENT">Entera</option>
                                        <option value="BIN">Binaria</option>
                                    </select>
                                </label>
                                <label>
                                    Límite inferior
                                    <input
                                        type="number"
                                        step="any"
                                        value={variable.tipo === "BIN"
                                            ? "0"
                                            : variable.limite_inferior}
                                        disabled={variable.tipo === "BIN"}
                                        onChange={(event) => updateVariable(
                                            index, "limite_inferior", event.target.value
                                        )}
                                    />
                                </label>
                                <label>
                                    Límite superior
                                    <input
                                        type="number"
                                        step="any"
                                        value={variable.tipo === "BIN"
                                            ? "1"
                                            : variable.limite_superior}
                                        disabled={variable.tipo === "BIN"}
                                        onChange={(event) => updateVariable(
                                            index, "limite_superior", event.target.value
                                        )}
                                    />
                                </label>
                                <label>
                                    Coeficiente objetivo
                                    <input
                                        type="number"
                                        step="any"
                                        value={variable.coeficiente_objetivo}
                                        onChange={(event) => updateVariable(
                                            index, "coeficiente_objetivo", event.target.value
                                        )}
                                        required
                                    />
                                </label>
                                <label>
                                    Unidad (opcional)
                                    <input
                                        value={variable.unidad}
                                        onChange={(event) => updateVariable(
                                            index, "unidad", event.target.value
                                        )}
                                        maxLength={50}
                                    />
                                </label>
                                <label className="problem-author-variable-description">
                                    Descripción (opcional)
                                    <input
                                        value={variable.descripcion}
                                        onChange={(event) => updateVariable(
                                            index, "descripcion", event.target.value
                                        )}
                                    />
                                </label>
                                <button
                                    className="secondary-button"
                                    type="button"
                                    disabled={variables.length === 1}
                                    onClick={() => removeVariable(index)}
                                >
                                    Quitar variable
                                </button>
                            </fieldset>
                        ))}
                    </div>

                    <div className="problem-author-section">
                        <div className="problem-author-section-heading">
                            <h4>Restricciones</h4>
                            <button
                                className="secondary-button"
                                type="button"
                                disabled={constraints.length >= 200}
                                onClick={() => setConstraints((current) => [
                                    ...current,
                                    emptyConstraint(current.length, variables.length)
                                ])}
                            >
                                Añadir restricción
                            </button>
                        </div>
                        {constraints.length === 0 && (
                            <p className="muted">Sin restricciones. Puedes añadirlas si el modelo las necesita.</p>
                        )}
                        {constraints.map((constraint, constraintIndex) => (
                            <fieldset className="problem-author-constraint" key={constraintIndex}>
                                <legend>Restricción {constraintIndex + 1}</legend>
                                <label>
                                    Nombre
                                    <input
                                        value={constraint.nombre}
                                        onChange={(event) => updateConstraint(
                                            constraintIndex, "nombre", event.target.value
                                        )}
                                        maxLength={150}
                                        required
                                    />
                                </label>
                                <label>
                                    Operador
                                    <select
                                        value={constraint.operador}
                                        onChange={(event) => updateConstraint(
                                            constraintIndex, "operador", event.target.value
                                        )}
                                    >
                                        <option value="LE">≤</option>
                                        <option value="GE">≥</option>
                                        <option value="EQ">=</option>
                                    </select>
                                </label>
                                <label>
                                    Lado derecho
                                    <input
                                        type="number"
                                        step="any"
                                        value={constraint.lado_derecho}
                                        onChange={(event) => updateConstraint(
                                            constraintIndex, "lado_derecho", event.target.value
                                        )}
                                        required
                                    />
                                </label>
                                {variables.map((variable, variableIndex) => (
                                    <label key={variableIndex}>
                                        Coeficiente de {variable.nombre || `x${variableIndex + 1}`}
                                        <input
                                            type="number"
                                            step="any"
                                            value={constraint.coeficientes[variableIndex] || ""}
                                            onChange={(event) => updateConstraintCoefficient(
                                                constraintIndex,
                                                variableIndex,
                                                event.target.value
                                            )}
                                            required
                                        />
                                    </label>
                                ))}
                                <button
                                    className="secondary-button"
                                    type="button"
                                    onClick={() => setConstraints((current) =>
                                        current.filter((_, index) =>
                                            index !== constraintIndex
                                        )
                                    )}
                                >
                                    Quitar restricción
                                </button>
                            </fieldset>
                        ))}
                    </div>
                    <div className="problem-author-actions">
                        <button className="primary-button" type="submit" disabled={saving}>
                            {saving
                                ? (editingId ? "Guardando cambios..." : "Creando modelo...")
                                : (editingId ? "Guardar cambios" : "Crear y abrir modelo")}
                        </button>
                    </div>
                </form>
                )
            )}
        </section>
    );
}

const rootElement = document.getElementById("profile-preview-root");
if (rootElement) {
    createRoot(rootElement).render(<ProfilePreview />);
}

const authorRoot = document.getElementById("problem-author-root");
if (authorRoot) {
    createRoot(authorRoot).render(<ProblemAuthor />);
}
