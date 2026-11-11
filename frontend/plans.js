const plansTarget = document.getElementById("subscription-plans");
const plansMessage = document.getElementById("pricing-message");
const plansYear = document.getElementById("plans-year");

if (plansYear) plansYear.textContent = new Date().getFullYear();

document.querySelectorAll("[data-return-to-workspace]").forEach((link) => {
    link.addEventListener("click", (event) => {
        if (!window.opener || window.opener.closed) return;

        let openerWindow;
        try {
            openerWindow = window.opener;
            if (openerWindow.location.origin !== window.location.origin) return;
        } catch {
            return;
        }

        event.preventDefault();
        window.opener = null;
        openerWindow.focus();
        window.close();
    });
});

function featureIcon(feature, index) {
    const text = feature.toLocaleLowerCase("es");
    const paths = /export|descarg|informe|reporte/.test(text)
        ? '<path d="M12 3v11m0 0 4-4m-4 4-4-4"/><path d="M5 15v4h14v-4"/>'
        : /soporte|ayuda|asesor/.test(text)
            ? '<path d="M4 13v-2a8 8 0 0 1 16 0v2"/><path d="M4 12h3v6H6a2 2 0 0 1-2-2v-2Zm16 0h-3v6h1a2 2 0 0 0 2-2v-2Z"/>'
            : /modelo|proye|escenario|análisis|analisis/.test(text)
                ? '<path d="M4 19V5m0 14h16"/><path d="m7 15 4-4 3 2 5-6"/>'
                : index % 2 === 0
                    ? '<path d="m5 12 4 4L19 6"/>'
                    : '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/>';
    const icon = document.createElement("span");
    icon.className = "plan-feature-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none">${paths}</svg>`;
    return icon;
}

function renderPlans(plans) {
    if (!Array.isArray(plans)) {
        throw new Error("La respuesta de planes tiene un formato inválido.");
    }

    plansTarget.replaceChildren();
    plans.forEach((plan) => {
        const card = document.createElement("article");
        card.className = `pricing-card${plan.featured ? " is-featured" : ""}`;

        if (plan.featured) {
            const badge = document.createElement("span");
            badge.className = "pricing-featured-badge";
            badge.textContent = "Destacado";
            card.append(badge);
        }

        const title = document.createElement("h2");
        title.textContent = plan.name;
        const description = document.createElement("p");
        description.className = "pricing-card-description";
        description.textContent = plan.description;
        const price = document.createElement("p");
        price.className = "pricing-card-price";
        if (plan.price === null) {
            price.textContent = "Precio por definir";
        } else if (plan.price === 0) {
            price.textContent = "Gratis";
        } else {
            price.textContent = new Intl.NumberFormat(
                navigator.language || "es",
                { style: "currency", currency: plan.currency }
            ).format(plan.price);
            const intervalLabels = {
                monthly: " / mes",
                yearly: " / año",
                one_time: " · pago único"
            };
            const interval = document.createElement("small");
            interval.textContent = intervalLabels[plan.interval] || "";
            price.append(interval);
        }

        const heading = document.createElement("div");
        heading.className = "pricing-card-heading";
        heading.append(title, description);
        const featureList = document.createElement("ul");
        featureList.className = "pricing-features";
        const features = plan.features.length
            ? plan.features
            : ["Funciones por definir."];
        features.forEach((feature, index) => {
            const item = document.createElement("li");
            item.append(featureIcon(feature, index));
            const text = document.createElement("span");
            text.textContent = feature;
            item.append(text);
            featureList.append(item);
        });
        card.append(heading, price, featureList);
        const infoBadge = document.createElement("p");
        infoBadge.className = "pricing-info-badge";
        infoBadge.textContent = "Plan informativo";
        card.append(infoBadge);
        plansTarget.append(card);
    });
}

async function loadPlans() {
    try {
        const response = await fetch("/api/planes/", {
            headers: { Accept: "application/json" }
        });
        if (!response.ok) {
            throw new Error(`No se pudieron cargar los planes (${response.status}).`);
        }
        renderPlans(await response.json());
    } catch (error) {
        plansTarget.replaceChildren();
        plansMessage.textContent = error.message;
        plansMessage.classList.add("error-message");
        plansMessage.hidden = false;
    }
}

loadPlans();
