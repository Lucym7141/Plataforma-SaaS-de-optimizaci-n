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
    await expect(page.locator("#portfolio-form")).toBeVisible();
}

test("CSV import can be reviewed, optimized, and plotted", async ({ page }) => {
    await signIn(page);

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

    await card.getByRole("button", { name: "Optimizar" }).click();
    await expect(page.locator("#portfolio-result")).toBeVisible();
    await expect(page.locator("#portfolio-result-values")).toContainText(
        "Volatilidad anualizada"
    );
    await expect(page.locator("#portfolio-result-values")).toContainText(
        "Contribución al riesgo"
    );

    await card.getByRole("button", { name: "Frontera eficiente" }).click();
    await expect(page.locator("#frontier-section")).toBeVisible();
    await expect(page.locator("#frontier-chart svg polyline")).toBeVisible();
});

test("a signed-in browser can log out and sign in again", async ({ page }) => {
    await signIn(page);
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
    const problemPanel = page.locator(".problems-panel");
    await expect(problemPanel).toContainText("E2E private problem");
    await expect(problemPanel).not.toContainText("Other user's private problem");

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
