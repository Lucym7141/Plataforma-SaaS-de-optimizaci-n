const { test, expect } = require("@playwright/test");

const username = "e2e-user";
const password = process.env.E2E_TEST_PASSWORD ||
    "Local-E2E-Password-947!";

async function signIn(page) {
    await page.goto("/");
    await expect(page.locator("#auth-panel")).toBeVisible();
    await page.locator("#login-username").fill(username);
    await page.locator("#login-password").fill(password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page.locator("#app-content")).toBeVisible();
    await expect(page.locator("#dashboard")).toBeVisible();
}

async function openView(page, hash, view) {
    await page.locator(`.sidebar-nav a[href="${hash}"]`).click();
    await expect(page.locator(`[data-app-page="${view}"]`).first()).toBeVisible();
}

test("auth screen exposes accessible tabs, labels, and password visibility", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#auth-panel")).toBeVisible();
    await expect(page.locator(".auth-visual")).toBeVisible();
    await expect(page.locator("#login-form")).toBeVisible();
    await expect(page.locator("#login-tab")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#login-username")).toHaveAccessibleName("Usuario");
    await expect(page.locator("#login-password")).toHaveAccessibleName("Contraseña");

    const loginPassword = page.locator("#login-password");
    const passwordToggle = page.locator(
        '[data-password-toggle="login-password"]'
    );
    await loginPassword.fill("Clave-de-prueba-123!");
    await passwordToggle.click();
    await expect(loginPassword).toHaveAttribute("type", "text");
    await expect(passwordToggle).toHaveAttribute("aria-pressed", "true");
    await expect(passwordToggle).toHaveAccessibleName("Ocultar contraseña");
    await passwordToggle.click();
    await expect(loginPassword).toHaveAttribute("type", "password");
    await expect(passwordToggle).toHaveAttribute("aria-pressed", "false");

    await page.locator("#login-tab").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#register-tab")).toBeFocused();
    await expect(page.locator("#register-tab")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#register-form")).toBeVisible();
    await expect(page.locator("#login-form")).toBeHidden();
    await expect(page.locator("#auth-title")).toHaveText("Crea tu cuenta");
    await expect(page.locator("#register-username")).toHaveAccessibleName("Usuario");
    await expect(page.locator("#register-email")).toHaveAccessibleName("Correo");
    await expect(page.locator("#register-password")).toHaveAccessibleName("Contraseña");
    await expect(page.locator("#register-password")).toHaveAttribute(
        "aria-describedby",
        "register-password-hint"
    );

    await page.keyboard.press("ArrowLeft");
    await expect(page.locator("#login-tab")).toBeFocused();
    await expect(page.locator("#login-form")).toBeVisible();
    await expect(page.locator("#register-form")).toBeHidden();

    const resetButton = page.locator("#password-reset-button");
    const resetForm = page.locator("#password-reset-form");
    await resetButton.click();
    await expect(resetForm).toBeVisible();
    await expect(resetButton).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#reset-email")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(resetForm).toBeHidden();
    await expect(resetButton).toHaveAttribute("aria-expanded", "false");
    await expect(resetButton).toBeFocused();
});

test("premium button opens the public informative plans in a new tab", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("#pricing-section")).toHaveCount(0);
    await page.goto("/planes");
    await expect(page.locator("#pricing-title")).toHaveText(
        "Planes de suscripción de Vértice"
    );
    await expect(page.locator(".pricing-card")).toHaveCount(3);
    await expect(page.locator("#subscription-plans"))
        .toContainText("Hasta 3 modelos de optimización");
    await expect(page.locator("#subscription-plans"))
        .toContainText("Hasta 50 activos por portafolio");

    await page.goto("/");
    const premiumButton = page.locator("#premium-link");
    await expect(premiumButton).toHaveText(/Hazte premium/i);
    await expect(premiumButton).toHaveAttribute("target", "_blank");
    expect(await premiumButton.evaluate((element) =>
        element.compareDocumentPosition(
            document.querySelector("#notification-toggle")
        ) & Node.DOCUMENT_POSITION_FOLLOWING
    )).toBeTruthy();

    const plansPagePromise = page.waitForEvent("popup");
    await premiumButton.click();
    const plansPage = await plansPagePromise;
    await expect(plansPage).toHaveURL(/\/planes\/$/);
    await expect(plansPage.locator("#pricing-title")).toHaveText(
        "Planes de suscripción de Vértice"
    );
    const pricing = plansPage.locator(".public-plans-main");
    await expect(pricing).toBeVisible();
    await expect(pricing.locator(".pricing-card")).toHaveCount(3);
    await expect(pricing).toContainText("Gratis");
    await expect(pricing.locator(".pricing-card").nth(1))
        .toContainText(/3[.,]95/);
    await expect(pricing.locator(".pricing-card").nth(2))
        .toContainText("Profesional Pro");
    await expect(pricing.locator(".pricing-card").nth(2))
        .toContainText(/10[.,]50/);
    await expect(pricing).toContainText(
        "no procesa pagos, activa suscripciones ni aplica los límites"
    );
    await expect(pricing.locator(".pricing-card").nth(1))
        .toContainText("Profesional");
    await plansPage.setViewportSize({ width: 390, height: 844 });
    await expect(plansPage.locator(".plans-sidebar")).toBeVisible();
    expect(await plansPage.evaluate(() => (
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1
    ))).toBe(false);
    await plansPage.close();

    for (const selector of [
        ".plans-sidebar-link[href='/']",
        ".plans-back-link",
        ".plans-footer a"
    ]) {
        const returnPagePromise = page.waitForEvent("popup");
        await premiumButton.click();
        const returnPage = await returnPagePromise;
        await returnPage.locator(selector).click();
        await expect.poll(() => returnPage.isClosed()).toBe(true);
        await expect(page).toHaveURL(/\/$/);
        await expect(page.locator("#auth-panel")).toBeVisible();
    }
});

test("login submit announces loading and error states without blocking recovery", async ({ page }) => {
    let releaseRequest;
    const requestGate = new Promise((resolve) => {
        releaseRequest = resolve;
    });
    await page.route("**/api/auth/login/", async (route) => {
        await requestGate;
        await route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({
                detail: "Credenciales incorrectas para la prueba."
            })
        });
    });

    await page.goto("/");
    await page.locator("#login-username").fill(username);
    await page.locator("#login-password").fill(password);
    const form = page.locator("#login-form");
    const submit = form.locator('button[type="submit"]');
    await submit.click();

    await expect(submit).toBeDisabled();
    await expect(submit).toHaveText("Iniciando sesión…");
    await expect(form).toHaveAttribute("aria-busy", "true");

    releaseRequest();
    const message = page.locator("#auth-message");
    await expect(message).toBeVisible();
    await expect(message).toHaveText("Credenciales incorrectas para la prueba.");
    await expect(message).toHaveAttribute("role", "alert");
    await expect(message).toHaveClass(/error-message/);
    await expect(submit).toBeEnabled();
    await expect(submit).toHaveText("Iniciar sesión");
    await expect(form).not.toHaveAttribute("aria-busy", "true");
});

test("registration reports loading and success accessibly", async ({ page }) => {
    let releaseRequest;
    const requestGate = new Promise((resolve) => {
        releaseRequest = resolve;
    });
    await page.route("**/api/auth/registro/", async (route) => {
        await requestGate;
        await route.fulfill({
            status: 201,
            contentType: "application/json",
            body: JSON.stringify({
                detail: "Revisa tu correo para activar la cuenta."
            })
        });
    });

    await page.goto("/");
    await page.locator("#register-tab").click();
    await page.locator("#register-username").fill("auth-ui-user");
    await page.locator("#register-email").fill("auth-ui@example.com");
    await page.locator("#register-password").fill("Clave-de-prueba-123!");
    const form = page.locator("#register-form");
    const submit = form.locator('button[type="submit"]');
    await submit.click();

    await expect(submit).toBeDisabled();
    await expect(submit).toHaveText("Creando cuenta…");
    await expect(form).toHaveAttribute("aria-busy", "true");

    releaseRequest();
    const message = page.locator("#auth-message");
    await expect(message).toBeVisible();
    await expect(message).toHaveText("Revisa tu correo para activar la cuenta.");
    await expect(message).toHaveAttribute("role", "status");
    await expect(message).toHaveClass(/success-message/);
    await expect(page.locator("#register-username")).toHaveValue("");
    await expect(page.locator("#register-email")).toHaveValue("");
    await expect(page.locator("#register-password")).toHaveValue("");
    await expect(submit).toBeEnabled();
    await expect(submit).toHaveText("Crear cuenta");
    await expect(form).not.toHaveAttribute("aria-busy", "true");
});

test("auth motion respects reduced motion and mobile layout avoids overflow", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#auth-panel")).toBeVisible();
    await expect(page.locator(".auth-art-card")).toHaveCSS(
        "animation-name",
        "auth-float"
    );
    await expect(page.locator("#login-form")).toHaveCSS(
        "animation-name",
        "auth-form-enter"
    );

    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator(".auth-art-card")).toHaveCSS("animation-name", "none");
    await expect(page.locator("#login-form")).toHaveCSS("animation-name", "none");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.locator("#auth-panel")).toBeVisible();
    await expect(page.locator(".auth-visual")).toBeHidden();
    await expect(page.locator("#login-username")).toBeVisible();
    await page.locator("#register-tab").click();
    await expect(page.locator("#register-form")).toBeVisible();
    const hasHorizontalOverflow = await page.evaluate(() => (
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1
    ));
    expect(hasHorizontalOverflow).toBe(false);
});

test("CSV import can be reviewed, optimized, and plotted", async ({ page }) => {
    await signIn(page);
    await openView(page, "#portfolio-panel", "analysis");

    const name = `E2E portfolio ${Date.now()}`;
    await page.locator(".csv-import summary").click();
    await page.locator("#portfolio-import-name").fill(name);
    await page.locator("#portfolio-import-file").setInputFiles({
        name: "portfolio.csv",
        mimeType: "text/csv",
        buffer: Buffer.from([
            "asset,expected_return,cov:Treasury,cov:Equity,category,min_weight,max_weight",
            "Treasury,0.04,0.01,0,Rates,0.1,1",
            "Equity,0.10,0,0.04,Growth,0,0.9"
        ].join("\n"))
    });
    await page.getByRole("button", { name: "Validar y previsualizar" }).click();
    await expect(page.locator("#portfolio-import-preview")).toContainText(name);

    const beforeSave = await page.evaluate(async () => {
        const response = await fetch("/api/portafolios/");
        return response.json();
    });
    expect(beforeSave.some((portfolio) => portfolio.nombre === name)).toBe(false);

    await page.getByRole("button", { name: "Guardar portafolio" }).click();
    const card = page.locator(".portfolio-card").filter({ hasText: name });
    await expect(card).toBeVisible();
    await expect(card).toContainText("Treasury, Equity");

    await card.getByRole("button", { name: "Editar" }).click();
    await page.locator("#portfolio-stress").fill(
        '{"Recesión": [-0.15, -0.30]}'
    );
    await page.locator("#portfolio-form")
        .getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.locator("#portfolio-message")).toContainText(
        "Portafolio guardado."
    );

    await card.getByRole("button", { name: "Optimizar" }).click();
    await expect(page.locator("#portfolio-result")).toBeVisible();
    await expect(page.locator("#portfolio-result-values")).toContainText(
        "Volatilidad anualizada"
    );
    await expect(page.locator("#portfolio-result-values")).toContainText(
        "Contribución al riesgo"
    );
    const pdfDownloadPromise = page.waitForEvent("download");
    await page.locator(
        '[data-report-target="portfolio"][data-report-format="pdf"]'
    ).click();
    const pdfDownload = await pdfDownloadPromise;
    expect(pdfDownload.suggestedFilename()).toMatch(/\.pdf$/);
    expect(await pdfDownload.failure()).toBeNull();

    const excelDownloadPromise = page.waitForEvent("download");
    await page.locator(
        '[data-report-target="portfolio"][data-report-format="xlsx"]'
    ).click();
    const excelDownload = await excelDownloadPromise;
    expect(excelDownload.suggestedFilename()).toMatch(/\.xlsx$/);
    expect(await excelDownload.failure()).toBeNull();

    const comparison = page.locator("#portfolio-comparison");
    const comparisonForm = page.locator("#portfolio-comparison-form");
    await expect(comparison).toBeVisible();
    await comparisonForm.getByLabel("Peso actual de Treasury (%)").fill("80");
    await comparisonForm.getByLabel("Peso actual de Equity (%)").fill("0");
    await comparisonForm.getByRole("button", {
        name: "Comparar escenarios"
    }).click();
    await expect(page.locator("#portfolio-comparison-message")).toContainText(
        "debe sumar 100 %"
    );

    await comparisonForm.getByLabel("Peso actual de Treasury (%)").fill("100");
    await comparisonForm.getByRole("button", {
        name: "Comparar escenarios"
    }).click();
    const comparisonTable = page.locator(
        "#portfolio-comparison-results .comparison-table:not(.risk-scenarios-table)"
    );
    await expect(comparisonTable).toBeVisible();
    await expect(comparisonTable).toContainText("Rendimiento esperado del período");
    await expect(comparisonTable.locator("tbody tr").nth(0).locator("td").nth(0))
        .toHaveText("4 %");
    await expect(comparisonTable.locator("tbody tr").nth(0).locator("td").nth(1))
        .toHaveText("8,8 %");
    await expect(comparisonTable).toContainText("Volatilidad anualizada");
    const allocationRows = page.locator(".allocation-chart-row");
    await expect(allocationRows).toHaveCount(2);
    await expect(allocationRows.nth(0).locator(".allocation-value").nth(0))
        .toContainText("100 %");
    await expect(allocationRows.nth(0).locator(".allocation-value").nth(1))
        .toContainText("20 %");
    await expect(allocationRows.nth(1).locator(".allocation-value").nth(1))
        .toContainText("80 %");
    const riskReview = page.locator(".risk-review");
    await expect(riskReview).toContainText("no una verificación de cumplimiento regulatorio");
    await expect(riskReview).toContainText("Concentración actual");
    await expect(riskReview).toContainText("El escenario simulado «Recesión»");
    await expect(riskReview).toHaveCSS("border-left-color", "rgb(169, 97, 0)");
    await expect(riskReview.locator(".risk-scenarios-table")).toContainText("-15 %");
    await expect(riskReview.locator(".risk-scenarios-table")).toContainText("-27 %");
    await page.setViewportSize({ width: 390, height: 844 });
    const comparisonRightEdge = await page.locator(
        "#portfolio-comparison-results"
    ).evaluate((element) => element.getBoundingClientRect().right);
    expect(comparisonRightEdge).toBeLessThanOrEqual(391);

    await card.getByRole("button", { name: "Frontera eficiente" }).click();
    await expect(page.locator("#frontier-section")).toBeVisible();
    await expect(page.locator("#frontier-chart svg polyline")).toBeVisible();
});

test("dashboard shows active activity and does not refresh when archived lists change", async ({ page }) => {
    await signIn(page);

    await expect(page.locator("#app-sidebar")).toBeVisible();
    await expect(page.locator("#app-sidebar .sidebar-link-icon svg")).toHaveCount(4);
    await expect(page.locator(".dashboard-create-link .button-icon")).toBeVisible();
    await expect(page.locator("#dashboard-refresh .button-icon")).toBeVisible();
    await expect(page.locator(".topbar .brand-wordmark")).toHaveAttribute(
        "alt",
        "Vértice Financial Optimization"
    );
    await expect(page.locator(".topbar .brand-wordmark")).toHaveJSProperty(
        "naturalWidth",
        959
    );
    await expect(page.locator(".sidebar-brand-logo")).toHaveJSProperty(
        "naturalWidth",
        959
    );
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
        "href",
        /brand-icon\.png$/
    );
    await expect(page.locator("#app-sidebar .sidebar-link[aria-current='page']"))
        .toContainText("Escritorio");
    await expect(page.locator("#dashboard-greeting"))
        .toHaveText(`Escritorio de ${username}`);
    await expect(page.locator("#dashboard-user-name")).toHaveText(username);
    await expect(page.locator("#dashboard-user-avatar")).toHaveText(
        username.charAt(0).toUpperCase()
    );
    await expect(page.locator("#dashboard-date")).not.toBeEmpty();
    await expect(page.locator("#dashboard-status")).toBeHidden();
    await expect(page.locator("#app-sidebar").getByRole("button", {
        name: "Mi perfil"
    })).toBeVisible();
    await page.locator(".dashboard-user-card").click();
    await expect(page.getByRole("dialog", { name: "Mi perfil" })).toBeVisible();
    await page.locator("#profile-drawer-close").click();
    await expect(page.getByRole("dialog", { name: "Mi perfil" })).toBeHidden();
    await expect(page.locator("#dashboard-problems")).toContainText(
        "E2E private problem"
    );
    await expect(page.locator("#dashboard-activity-history"))
        .toContainText("E2E private problem");
    const notificationToggle = page.locator("#notification-toggle");
    await expect(notificationToggle).toHaveAttribute("aria-label", /sin leer/i);
    await notificationToggle.click();
    await expect(page.locator("#notifications-panel")).toBeVisible();
    await expect(page.locator("#notifications-list")).toContainText(
        "E2E private problem"
    );
    await page.locator("#notifications-mark-read").click();
    await expect(page.locator("#notification-count")).toBeHidden();
    await page.reload();
    await expect(page.locator("#app-content")).toBeVisible();
    await expect(page.locator("#notification-count")).toBeHidden();
    await expect(
        page.locator('script[src*="vendor/chart.umd.min.js"]')
    ).toHaveCount(1);
    expect(await page.evaluate(() => typeof window.Chart)).toBe("function");

    const recentProblem = page.locator("#dashboard-problems .activity-item")
        .filter({ hasText: "E2E private problem" });
    await openView(page, "#problem-workspace", "models");
    await recentProblem.getByRole("button", { name: "Abrir" }).click();
    await expect(page.locator("#problem-title")).toHaveText(
        "E2E private problem"
    );

    await openView(page, "#portfolio-panel", "analysis");
    const name = `Dashboard portfolio ${Date.now()}`;
    await page.locator("#portfolio-name").fill(name);
    await page.locator("#portfolio-assets").fill("Bono, Acción");
    await page.locator("#portfolio-returns").fill("[0.04, 0.10]");
    await page.locator("#portfolio-covariance").fill(
        "[[0.01, 0], [0, 0.04]]"
    );
    await page.getByRole("button", { name: "Guardar portafolio" }).click();
    await expect(page.locator("#portfolio-list")).toContainText(name);
    await expect(page.locator("#dashboard-portfolios")).toContainText(name);
    await expect(page.locator("#dashboard-activity-history")).toContainText(name);
    await expect(page.locator("#kpi-portafolios")).not.toHaveText("—");

    const recentPortfolio = page.locator("#dashboard-portfolios .activity-item")
        .filter({ hasText: name });
    await openView(page, "#problem-workspace", "models");
    await recentPortfolio.getByRole("button", { name: "Historial" }).click();
    await expect(page.locator("#portfolio-history")).toBeVisible();
    await expect(page.locator("#portfolio-history-list")).toContainText(
        "Todavía no hay ejecuciones."
    );

    const summaryRequests = [];
    page.on("request", (request) => {
        if (new URL(request.url()).pathname === "/api/resumen/") {
            summaryRequests.push(request.url());
        }
    });

    await openView(page, "#problem-workspace", "models");
    await page.locator("#archived-toggle").click();
    await expect(page.locator("#problems-list")).toContainText(
        "No hay problemas archivados."
    );
    await openView(page, "#portfolio-panel", "analysis");
    await page.locator("#portfolio-archived-toggle").click();
    await expect(page.locator("#portfolio-list")).toContainText(
        "No hay portafolios archivados."
    );

    expect(summaryRequests).toHaveLength(0);
});

test("dashboard empty states guide first-time users and fit mobile screens", async ({ page }) => {
    await page.route("**/api/resumen/", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
            problemas: 0,
            problemas_archivados: 0,
            portafolios: 0,
            portafolios_archivados: 0,
            analitica: {
                problemas_por_objetivo: [],
                portafolios_por_cantidad_activos: [],
                activos_totales: 0
            },
            ultimos_problemas: [],
            ultimos_portafolios: []
        })
    }));

    await signIn(page);
    await openView(page, "#problem-workspace", "models");
    await expect(page.locator("#dashboard-status")).toBeHidden();
    const emptyStates = page.locator(".dashboard-empty-state");
    await expect(emptyStates).toHaveCount(2);
    await expect(emptyStates.nth(0)).toContainText("Aún no tienes modelos");
    await expect(emptyStates.nth(0).getByRole("link", {
        name: "Crear modelo"
    })).toHaveAttribute("href", "#problem-workspace");
    await expect(emptyStates.nth(1)).toContainText("Aún no tienes portafolios");
    await expect(emptyStates.nth(1).getByRole("link", {
        name: "Crear portafolio"
    })).toHaveAttribute("href", "#portfolio-panel");
    await expect(page.locator("#dashboard-activity-history"))
        .toContainText("Aún no hay actividad");

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileWidth = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
        overflowingElements: Array.from(document.querySelectorAll("body *"))
            .filter((element) => !element.closest(".table-scroll"))
            .map((element) => ({
                tag: element.tagName,
                id: element.id,
                className: typeof element.className === "string" ? element.className : "",
                right: Math.round(element.getBoundingClientRect().right),
                width: Math.round(element.getBoundingClientRect().width)
            }))
            .filter((element) =>
                element.right > window.innerWidth + 1 && element.width > 0
            )
            .slice(0, 8)
    }));
    expect(mobileWidth).toMatchObject({
        viewport: 390,
        document: 390,
        overflowingElements: []
    });
});

test("sidebar navigation works as a keyboard-accessible mobile drawer", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    await expect(page.locator("#portfolio-panel")).toBeHidden();
    await expect(page.locator("#problem-workspace")).toBeHidden();
    await expect(page.locator("#dashboard-problems")).toBeHidden();
    await expect(page.locator("#dashboard-activity-history")).toBeHidden();
    await expect(page.locator("#dashboard-summary-title")).toBeVisible();

    const toggle = page.locator("#sidebar-toggle");
    const sidebar = page.locator("#app-sidebar");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(sidebar).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();

    await toggle.click();
    await sidebar.getByRole("link", { name: "Análisis" }).click();
    await expect(page).toHaveURL(/#portfolio-panel$/);
    await expect(page.locator("#portfolio-form")).toBeVisible();
    await expect(page.locator("#analysis-page-title"))
        .toHaveText("Análisis de portafolio");
    await expect(page.locator("#dashboard")).toBeHidden();
    await expect(sidebar.locator(".sidebar-link[aria-current='page']"))
        .toContainText("Análisis");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await toggle.click();
    await sidebar.getByRole("link", { name: "Modelos" }).click();
    await expect(page).toHaveURL(/#problem-workspace$/);
    await expect(page.locator("#problem-workspace")).toBeVisible();
    await expect(page.locator("#models-page-title"))
        .toHaveText("Tus modelos y asistente IA");
    await expect(page.locator("#problem-ai-description")).toBeVisible();
    await expect(page.locator("#portfolio-panel")).toBeHidden();

    const profileTrigger = sidebar.getByRole("button", { name: "Mi perfil" });
    await toggle.click();
    const currentUrl = page.url();
    const currentScroll = await page.evaluate(() => window.scrollY);
    await profileTrigger.click();
    await expect(page.getByRole("dialog", { name: "Mi perfil" })).toBeVisible();
    await expect(page.locator("#profile-drawer-close")).toBeFocused();
    expect(page.url()).toBe(currentUrl);
    expect(await page.evaluate(() => window.scrollY)).toBe(currentScroll);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Mi perfil" })).toBeHidden();
    await expect(profileTrigger).toBeFocused();
});

test("dashboard manual refresh fetches complete aggregate analytics", async ({ page }) => {
    await signIn(page);
    await expect(page.locator(".app-footer")).toBeVisible();
    await expect(page.locator("#footer-year")).toHaveText(
        String(new Date().getFullYear())
    );
    const refresh = page.getByRole("button", {
        name: "Actualizar resumen y gráficos"
    });
    const responsePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname === "/api/resumen/" &&
        response.request().method() === "GET"
    );

    await refresh.click();

    const response = await responsePromise;
    expect(response.ok()).toBe(true);
    const summary = await response.json();
    expect(summary.analitica.problemas_por_objetivo).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ tipo_objetivo: "MAX", total: 1 })
        ])
    );
    const portfolioBuckets =
        summary.analitica.portafolios_por_cantidad_activos;
    expect(portfolioBuckets.reduce(
        (total, bucket) => total + bucket.total_portafolios,
        0
    )).toBe(summary.portafolios);
    const knownAssetMinimum = portfolioBuckets.reduce(
        (total, bucket) => total + (
            bucket.cantidad_activos === "5+"
                ? 5 * bucket.total_portafolios
                : Number(bucket.cantidad_activos) * bucket.total_portafolios
        ),
        0
    );
    expect(summary.analitica.activos_totales).toBeGreaterThanOrEqual(
        knownAssetMinimum
    );
    await expect(page.locator("#dashboard-status")).toBeHidden();
    await expect(page.locator("#kpi-activos-totales")).toHaveText(
        String(summary.analitica.activos_totales)
    );
    await expect(page.locator("#chart-problemas")).toHaveAttribute(
        "aria-label",
        "Todos los problemas activos agrupados por objetivo"
    );
    await expect(page.locator("#app-sidebar a[href='#portfolio-panel']"))
        .toBeVisible();
    await expect(page.locator("#app-sidebar a[href='#problem-workspace']"))
        .toBeVisible();
});

test("dashboard cards use subtle motion and disable it for reduced-motion preferences", async ({ page }) => {
    await signIn(page);
    const card = page.locator(".kpi-card").first();
    await card.hover();
    await expect.poll(() => card.evaluate((element) =>
        getComputedStyle(element).transform
    )).toMatch(/^matrix\(/);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(() => card.evaluate((element) =>
        getComputedStyle(element).animationName
    )).toBe("none");
    await card.hover();
    await expect.poll(() => card.evaluate((element) =>
        getComputedStyle(element).transform
    )).toBe("none");
});

test("dashboard pie charts animate and respect motion preferences", async ({ page }) => {
    await signIn(page);
    const chartMotion = () => page.evaluate(() => {
        const objectives = window.Chart.getChart(
            document.getElementById("chart-problemas")
        );
        const portfolios = window.Chart.getChart(
            document.getElementById("chart-portafolios")
        );
        return {
            objectivesType: objectives.config.type,
            objectivesDuration: objectives.options.animation.duration,
            objectivesRotates: objectives.options.animation.animateRotate,
            portfoliosType: portfolios.config.type,
            portfoliosDuration: portfolios.options.animation.duration,
            portfoliosRotates: portfolios.options.animation.animateRotate
        };
    });

    await expect.poll(chartMotion).toEqual({
        objectivesType: "pie",
        objectivesDuration: 1250,
        objectivesRotates: true,
        portfoliosType: "pie",
        portfoliosDuration: 1250,
        portfoliosRotates: true
    });

    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(() => page.evaluate(() =>
        window.Chart.getChart(
            document.getElementById("chart-problemas")
        ).options.animation === false
    )).toBe(true);
    await expect.poll(() => page.evaluate(() =>
        window.Chart.getChart(
            document.getElementById("chart-portafolios")
        ).options.animation === false
    )).toBe(true);

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect.poll(chartMotion).toEqual({
        objectivesType: "pie",
        objectivesDuration: 1250,
        objectivesRotates: true,
        portfoliosType: "pie",
        portfoliosDuration: 1250,
        portfoliosRotates: true
    });
});

test("user can customize profile details and photo", async ({ page }) => {
    const profileResponse = page.waitForResponse((response) =>
        new URL(response.url()).pathname === "/api/profile/" &&
        response.request().method() === "GET"
    );
    await signIn(page);
    await profileResponse;
    await page.getByRole("button", { name: "Mi perfil", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Mi perfil" })).toBeVisible();
    for (const action of [
        "Exportar mis datos",
        "Cambiar contraseña",
        "Eliminar cuenta",
        "Cerrar sesión"
    ]) {
        await expect(page.locator("#profile-drawer").getByRole("button", {
            name: new RegExp(action)
        })).toBeVisible();
    }
    await expect(page.locator("#profile-drawer .profile-form-fields label svg"))
        .toHaveCount(3);
    await expect(page.locator("#profile-drawer .account-action-icon svg"))
        .toHaveCount(4);
    await expect(page.locator("#profile-drawer .account-settings-heading h3 svg"))
        .toBeVisible();
    await expect(page.locator("#profile-drawer .account-action-button").first())
        .not.toHaveCSS("animation-name", "none");
    await expect(page.locator("[data-react-component='profile-preview']"))
        .toBeVisible();
    const displayName = page.locator("#profile-display-name");
    const description = page.locator("#profile-description");
    const initialName = await displayName.inputValue();
    const initialDescription = await description.inputValue();
    await displayName.fill("Cambio temporal");
    await description.fill("Vista previa sin guardar");
    await expect(page.locator("#profile-preview-name")).toHaveText(
        "Cambio temporal"
    );
    await expect(page.locator("#profile-preview-description")).toHaveText(
        "Vista previa sin guardar"
    );
    await expect(page.locator("#profile-name-count")).toHaveText("15/80");
    await page.locator("#profile-reset").click();
    await expect(displayName).toHaveValue(initialName);
    await expect(description).toHaveValue(initialDescription);
    await expect(page.locator("#profile-reset")).toBeDisabled();
    await page.locator("#profile-photo-input").setInputFiles({
        name: "not-an-image.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("not an image")
    });
    await expect(page.locator("#profile-message")).toHaveText(
        "Elige una imagen JPEG, PNG o WebP."
    );
    await expect(page.locator("#profile-photo-input")).toHaveValue("");
    await expect(page.getByRole("button", { name: "Guardar perfil" }))
        .toBeDisabled();
    await page.locator("#profile-photo-input").setInputFiles({
        name: "too-large.png",
        mimeType: "image/png",
        buffer: Buffer.alloc(768 * 1024 + 1)
    });
    await expect(page.locator("#profile-message")).toHaveText(
        "La imagen debe pesar 768 KiB o menos."
    );
    await expect(page.locator("#profile-photo-input")).toHaveValue("");
    await displayName.fill("Ada Inversiones");
    await description.fill("Analista de portafolios");
    await page.getByRole("button", { name: "Guardar perfil" }).click();
    await expect(page.locator("#dashboard-greeting")).toHaveText(
        "Escritorio de Ada Inversiones"
    );
    await expect(page.locator("#profile-message")).toHaveText(
        "Perfil actualizado."
    );

    await page.locator("#profile-photo-input").setInputFiles({
        name: "avatar.png",
        mimeType: "image/png",
        buffer: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAE0lEQVR4nGNsYGhggAEmOAsvBwAzBAEI14KrBQAAAABJRU5ErkJggg==",
            "base64"
        )
    });
    await page.getByRole("button", { name: "Guardar perfil" }).click();

    await expect(page.locator("#dashboard-greeting")).toHaveText(
        "Escritorio de Ada Inversiones"
    );
    await expect(page.locator("#dashboard-user-bio")).toHaveText(
        "Analista de portafolios"
    );
    await expect(page.locator("#dashboard-user-photo")).toBeVisible();
    await expect(page.locator("#profile-preview-photo")).toBeVisible();
    await expect(page.locator("#profile-message")).toHaveText(
        "Perfil actualizado."
    );

    await page.reload();
    await expect(page.locator("#app-content")).toBeVisible();
    await expect(page.locator("#dashboard-greeting")).toHaveText(
        "Escritorio de Ada Inversiones"
    );
    await expect(page.locator("#dashboard-user-photo")).toBeVisible();
    await page.getByRole("button", { name: "Mi perfil", exact: true }).click();
    await page.locator("#profile-remove-photo").click();
    await expect(page.locator("#dashboard-user-photo")).toBeHidden();
    await expect(page.locator("#dashboard-user-avatar")).toBeVisible();
});

test("theme toggle communicates and persists the active theme", async ({ page }) => {
    await signIn(page);
    const toggle = page.locator("#theme-toggle");

    await expect(toggle.locator(".theme-icon-sun")).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(page.locator("body")).toHaveClass(/dark/);
    await expect(toggle.locator(".theme-icon-moon")).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(toggle).toHaveAttribute("aria-label", /oscuro/i);

    await page.reload();
    await expect(page.locator("body")).toHaveClass(/dark/);
    await expect(page.locator("#theme-toggle .theme-icon-moon")).toBeVisible();
    await page.locator("#theme-toggle").click();
    await expect(page.locator("body")).not.toHaveClass(/dark/);
});

test("summary errors offer retry without blocking the rest of the app", async ({ page }) => {
    let failSummary = true;
    await page.route("**/api/resumen/", async (route) => {
        if (!failSummary) {
            await route.continue();
            return;
        }
        await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ detail: "Fallo de prueba del resumen." })
        });
    });

    await signIn(page);
    await openView(page, "#portfolio-panel", "analysis");
    await expect(page.locator("#portfolio-form")).toBeVisible();
    await openView(page, "#dashboard", "dashboard");
    await expect(page.locator("#dashboard-status")).toContainText(
        "No se pudo cargar el resumen"
    );
    await expect(page.locator("#dashboard-retry")).toBeVisible();

    failSummary = false;
    await page.locator("#dashboard-retry").click();
    await expect(page.locator("#dashboard-status")).toBeHidden();
    await expect(page.locator("#kpi-problemas")).not.toHaveText("—");
});

test("a signed-in browser can log out and sign in again", async ({ page }) => {
    await signIn(page);
    await page.getByRole("button", { name: "Mi perfil", exact: true }).click();
    await expect(page.locator("#account-settings-title")).toBeVisible();
    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page.locator("#auth-panel")).toBeVisible();
    await expect(page.locator("#app-content")).toBeHidden();

    await page.locator("#login-username").fill(username);
    await page.locator("#login-password").fill(password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page.locator("#app-content")).toBeVisible();
});

test("private models are only shown to their owner", async ({ page }) => {
    await signIn(page);
    await openView(page, "#problem-workspace", "models");
    const problemPanel = page.locator(".problems-panel");
    await expect(problemPanel).toContainText("E2E private problem");
    await expect(problemPanel).not.toContainText("Other user's private problem");

    await page.getByRole("button", { name: "Mi perfil", exact: true }).click();
    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page.locator("#auth-panel")).toBeVisible();
    await page.locator("#login-username").fill(
        "e2e-other"
    );
    await page.locator("#login-password").fill(
        process.env.E2E_OTHER_PASSWORD || "Other-E2E-Password-947!"
    );
    await page.getByRole("button", { name: "Iniciar sesión" }).click();

    await expect(problemPanel).toContainText("Other user's private problem");
    await expect(problemPanel).not.toContainText("E2E private problem");
});

test("user can create a complete optimization model from the React workspace", async ({ page }) => {
    await signIn(page);
    await openView(page, "#problem-workspace", "models");
    const root = page.locator("#problem-author-root");
    await root.getByRole("button", { name: "Crear problema" }).click();

    const form = page.locator("#problem-author-form");
    const name = `Modelo React ${Date.now()}`;
    await form.getByLabel("Nombre del modelo").fill(name);
    await form.locator("textarea").fill(
        "Maximizar utilidad respetando capacidad."
    );
    await form.locator("select").first().selectOption("MAX");

    const firstVariable = form.locator(".problem-author-variable").nth(0);
    await firstVariable.getByLabel("Nombre").fill("x");
    await firstVariable.getByLabel("Tipo").selectOption("ENT");
    await firstVariable.getByLabel("Límite inferior").fill("0");
    await firstVariable.getByLabel("Límite superior").fill("10");
    await firstVariable.getByLabel("Coeficiente objetivo").fill("3");

    await form.getByRole("button", { name: "Añadir variable" }).click();
    const secondVariable = form.locator(".problem-author-variable").nth(1);
    await secondVariable.getByLabel("Nombre").fill("y");
    await secondVariable.getByLabel("Coeficiente objetivo").fill("5");

    await form.getByRole("button", { name: "Añadir restricción" }).click();
    const constraint = form.locator(".problem-author-constraint").first();
    await constraint.getByLabel("Nombre").fill("capacidad");
    await constraint.getByLabel("Operador").selectOption("LE");
    await constraint.getByLabel("Lado derecho").fill("12");
    await constraint.getByLabel("Coeficiente de x").fill("2");
    await constraint.getByLabel("Coeficiente de y").fill("3");

    const responsePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname === "/api/problemas/" &&
        response.request().method() === "POST"
    );
    await form.getByRole("button", { name: "Crear y abrir modelo" }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(201);
    const created = await response.json();
    expect(created.nombre).toBe(name);
    expect(created.variables).toHaveLength(2);
    expect(created.terminos_objetivo).toHaveLength(2);
    expect(created.restricciones).toHaveLength(1);
    expect(created.restricciones[0].terminos).toHaveLength(2);

    await expect(page.locator("#problem-title")).toHaveText(name);
    await expect(page.locator("#objective-formula")).toContainText(
        "3 · x + 5 · y"
    );
    await expect(page.locator("#constraints-list")).toContainText("capacidad");
    await expect(page.locator("#kpi-problemas")).toHaveText("2");

    await page.locator("#edit-problem-button").click();
    await expect(form.getByLabel("Nombre del modelo")).toHaveValue(name);
    await expect(form.locator(".problem-author-variable")).toHaveCount(2);
    await expect(form.locator(".problem-author-constraint")).toHaveCount(1);

    const updatedName = `${name} editado`;
    await form.getByLabel("Nombre del modelo").fill(updatedName);
    await form.locator("select").first().selectOption("MIN");
    await form.locator(".problem-author-variable").nth(0)
        .getByLabel("Límite superior").fill("11");
    await form.locator(".problem-author-variable").nth(1)
        .getByLabel("Nombre").fill("z");
    await form.locator(".problem-author-variable").nth(1)
        .getByLabel("Coeficiente objetivo").fill("7");
    await form.locator(".problem-author-constraint").first()
        .getByLabel("Lado derecho").fill("15");

    const updateResponsePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname === `/api/problemas/${created.id}/` &&
        response.request().method() === "PUT"
    );
    await form.getByRole("button", { name: "Guardar cambios" }).click();
    const updateResponse = await updateResponsePromise;
    expect(updateResponse.status()).toBe(200);
    const updated = await updateResponse.json();
    expect(updated.nombre).toBe(updatedName);
    expect(updated.tipo_objetivo).toBe("MIN");
    expect(updated.terminos_objetivo).toHaveLength(2);
    expect(updated.terminos_objetivo.find((term) =>
        term.variable_nombre === "z"
    ).coeficiente).toBe("7.000000");
    expect(updated.variables.find((variable) =>
        variable.nombre === "x"
    ).limite_superior).toBe("11.000000");
    expect(updated.restricciones[0].lado_derecho).toBe("15.000000");
    expect(updated.restricciones[0].terminos.find((term) =>
        term.variable_nombre === "z"
    ).coeficiente).toBe("3.000000");
    await expect(page.locator("#problem-title")).toHaveText(updatedName);
    await expect(page.locator("#objective-formula")).toContainText(
        "3 · x + 7 · z"
    );
    await expect(page.locator("#problem-type")).toContainText("Minimizar");

    page.once("dialog", (dialog) => dialog.accept());
    const deleteResponsePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname === `/api/problemas/${created.id}/` &&
        response.request().method() === "DELETE"
    );
    await page.getByRole("button", { name: "Eliminar permanentemente" }).click();
    const deleteResponse = await deleteResponsePromise;
    expect(deleteResponse.status()).toBe(204);
    await expect(page.locator(".problems-panel")).not.toContainText(updatedName);
    await expect(page.locator("#kpi-problemas")).toHaveText("1");
});

test("user can load and create a model from the template library", async ({ page }) => {
    await signIn(page);
    await openView(page, "#problem-workspace", "models");
    const root = page.locator("#problem-author-root");
    const library = root.locator(".problem-template-library");
    await library.locator("summary").click();

    const expectedTemplates = [
        ["Asignación de inversión", 2, "MAX"],
        ["Portafolio regulado (Ejercicio 5)", 5, "MAX"],
        ["Transporte y distribución", 4, "MIN"],
        ["Plan de dieta", 2, "MIN"],
        ["Plan de producción", 2, "MAX"]
    ];
    const form = page.locator("#problem-author-form");
    for (const [title, variableCount, objective] of expectedTemplates) {
        const card = library.locator(".problem-template-card")
            .filter({ hasText: title });
        await card.getByRole("button", { name: "Usar plantilla" }).click();
        await expect(form).toBeVisible();
        await expect(form.locator(".problem-author-variable"))
            .toHaveCount(variableCount);
        await expect(form.locator("select").first()).toHaveValue(objective);
    }

    await library.locator(".problem-template-card")
        .filter({ hasText: "Portafolio regulado (Ejercicio 5)" })
        .getByRole("button", { name: "Usar plantilla" }).click();
    const portfolioName = `Ejercicio 5 ${Date.now()}`;
    await form.getByLabel("Nombre del modelo").fill(portfolioName);
    await expect(form.locator(".problem-author-constraint")).toHaveCount(5);
    const portfolioCreatePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname === "/api/problemas/" &&
        response.request().method() === "POST"
    );
    await form.getByRole("button", { name: "Crear y abrir modelo" }).click();
    const portfolioCreate = await portfolioCreatePromise;
    expect(portfolioCreate.status()).toBe(201);
    const createdPortfolioModel = await portfolioCreate.json();
    expect(createdPortfolioModel.variables).toHaveLength(5);
    expect(createdPortfolioModel.restricciones).toHaveLength(5);
    const solvePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname ===
            `/api/problemas/${createdPortfolioModel.id}/resolver/` &&
        response.request().method() === "POST"
    );
    await page.getByRole("button", { name: "Resolver problema" }).click();
    const solveResponse = await solvePromise;
    expect(solveResponse.status()).toBe(200);
    const solution = await solveResponse.json();
    expect(solution.estado).toBe("OPT");
    expect(Number(solution.valor_objetivo)).toBeCloseTo(953333.33, 1);
    const allocations = Object.fromEntries(
        solution.valores.map((value) => [
            value.variable_nombre,
            Number(value.valor)
        ])
    );
    expect(allocations.x1).toBeCloseTo(2, 5);
    expect(allocations.x2).toBeCloseTo(0, 5);
    expect(allocations.x3).toBeCloseTo(0, 5);
    expect(allocations.x4).toBeCloseTo(8 / 3, 5);
    expect(allocations.x5).toBeCloseTo(16 / 3, 5);

    page.once("dialog", (dialog) => dialog.accept());
    const portfolioDeletePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname ===
            `/api/problemas/${createdPortfolioModel.id}/` &&
        response.request().method() === "DELETE"
    );
    await page.getByRole("button", { name: "Eliminar permanentemente" }).click();
    const portfolioDelete = await portfolioDeletePromise;
    expect(portfolioDelete.status()).toBe(204);

    await library.locator(".problem-template-card")
        .filter({ hasText: "Transporte y distribución" })
        .getByRole("button", { name: "Usar plantilla" }).click();
    const name = `Plantilla transporte ${Date.now()}`;
    await form.getByLabel("Nombre del modelo").fill(name);
    await expect(form.locator(".problem-author-constraint")).toHaveCount(4);
    const createResponsePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname === "/api/problemas/" &&
        response.request().method() === "POST"
    );
    await form.getByRole("button", { name: "Crear y abrir modelo" }).click();
    const createResponse = await createResponsePromise;
    expect(createResponse.status()).toBe(201);
    const created = await createResponse.json();
    expect(created.nombre).toBe(name);
    expect(created.tipo_objetivo).toBe("MIN");
    expect(created.variables).toHaveLength(4);
    expect(created.terminos_objetivo).toHaveLength(4);
    expect(created.restricciones).toHaveLength(4);
    await expect(page.locator("#problem-title")).toHaveText(name);

    page.once("dialog", (dialog) => dialog.accept());
    const deleteResponsePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname === `/api/problemas/${created.id}/` &&
        response.request().method() === "DELETE"
    );
    await page.getByRole("button", { name: "Eliminar permanentemente" }).click();
    const deleteResponse = await deleteResponsePromise;
    expect(deleteResponse.status()).toBe(204);
});

test("user can generate a model draft with AI and confirm before saving", async ({ page }) => {
    await signIn(page);
    await openView(page, "#problem-workspace", "models");
    const text = "Maximiza utilidad produciendo x e y con capacidad total de doce.";
    let receivedText;
    await page.route("**/api/problemas/generar/", async (route) => {
        receivedText = route.request().postDataJSON().texto;
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                nombre: "Plan sugerido",
                descripcion: "Borrador generado; revisa los coeficientes.",
                tipo_objetivo: "MAX",
                variables: [
                    {
                        nombre: "x",
                        descripcion: "Producto X",
                        unidad: "unidades",
                        tipo: "ENT",
                        limite_inferior: "0",
                        limite_superior: "10"
                    },
                    {
                        nombre: "y",
                        descripcion: "Producto Y",
                        unidad: "unidades",
                        tipo: "CONT",
                        limite_inferior: "0",
                        limite_superior: null
                    }
                ],
                terminos_objetivo: [
                    { variable_nombre: "x", coeficiente: "3.000000" },
                    { variable_nombre: "y", coeficiente: "5.000000" }
                ],
                restricciones: [
                    {
                        nombre: "capacidad",
                        operador: "LE",
                        lado_derecho: "12.000000",
                        terminos: [
                            { variable_nombre: "x", coeficiente: "2.000000" },
                            { variable_nombre: "y", coeficiente: "3.000000" }
                        ]
                    }
                ]
            })
        });
    });

    const before = await page.evaluate(async () => {
        const response = await fetch("/api/problemas/");
        return response.json();
    });
    const assistant = page.locator(".problem-ai-assistant");
    const description = assistant.getByLabel("Descripción del problema");
    await description.fill(text);
    await assistant.getByRole("button", {
        name: "Generar borrador con IA"
    }).click();
    expect(receivedText).toBe(text);

    const form = page.locator("#problem-author-form");
    await expect(form.getByLabel("Nombre del modelo")).toHaveValue("Plan sugerido");
    await expect(form.locator("textarea").first())
        .toHaveValue("Borrador generado; revisa los coeficientes.");
    await expect(form.locator(".problem-author-variable")).toHaveCount(2);
    await expect(form.locator(".problem-author-constraint")).toHaveCount(1);
    await expect(assistant).toContainText("Revisa y corrige cada valor");
    const afterDraft = await page.evaluate(async () => {
        const response = await fetch("/api/problemas/");
        return response.json();
    });
    expect(afterDraft).toHaveLength(before.length);

    const name = `Modelo IA ${Date.now()}`;
    await form.getByLabel("Nombre del modelo").fill(name);
    const createResponsePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname === "/api/problemas/" &&
        response.request().method() === "POST"
    );
    await form.getByRole("button", { name: "Crear y abrir modelo" }).click();
    const createResponse = await createResponsePromise;
    expect(createResponse.status()).toBe(201);
    const created = await createResponse.json();
    expect(created.nombre).toBe(name);

    page.once("dialog", (dialog) => dialog.accept());
    const deleteResponsePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname === `/api/problemas/${created.id}/` &&
        response.request().method() === "DELETE"
    );
    await page.getByRole("button", { name: "Eliminar permanentemente" }).click();
    const deleteResponse = await deleteResponsePromise;
    expect(deleteResponse.status()).toBe(204);
});
