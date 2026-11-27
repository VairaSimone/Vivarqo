const { test, expect } = await import(process.env.PLAYWRIGHT_TEST_MODULE);

const owner = { email: "e2e-owner@vivarqo.test", password: "Vivarqo-E2E-Only-2026!" };

async function signIn(page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    new URL(response.url()).pathname === "/api/v1/auth/login"
  );
  await page.getByRole("button", { name: "Accedi" }).click();
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(200);
  await page.waitForURL(/\/today(?:\?.*)?$/);
  // Dismiss the required-only cookie acknowledgement so it cannot intercept
  // clicks in the authenticated E2E flows.
  const cookieNotice = page.getByRole("region", { name: "Informativa sui cookie" });
  if (await cookieNotice.isVisible()) {
    await cookieNotice.getByRole("button", { name: "Ho capito" }).click();
  }
}

async function enableAllCategories(page) {
  await page.goto("/settings/categories");
  for (const name of ["Pesci", "Uccelli", "Cani e gatti"]) {
    const category = page.getByRole("button", { name: new RegExp(name) });
    if (await category.getAttribute("aria-pressed") !== "true") await category.click();
  }
  await page.getByRole("button", { name: "Conferma selezione" }).click();
  await page.waitForURL(/\/settings(?:\?.*)?$/);
  await page.goto("/today");
}

async function createAnimal(page, name) {
  const result = await page.evaluate(async ({ name }) => {
    const csrf = await fetch("/api/v1/auth/csrf", { credentials: "same-origin" }).then((response) => response.json());
    const response = await fetch("/api/v1/animals", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf.csrfToken },
      body: JSON.stringify({ name, species: "Cane meticcio", category: "dogs_cats", sex: "unknown" })
    });
    return { status: response.status, body: await response.json() };
  }, { name });
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return result.body.animal;
}

test("aquariums, aviaries and companion-care records support editing and archival", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  await enableAllCategories(page);

  const aquariumName = "E2E Aquarium " + Date.now();
  await page.goto("/aquariums");
  await page.getByLabel("Nome").fill(aquariumName);
  await page.getByLabel("Volume (litri)").fill("120");
  await page.getByRole("button", { name: "Crea" }).click();
  const aquarium = page.locator(".ecosys-item").filter({ hasText: aquariumName });
  await expect(aquarium).toBeVisible();
  await page.getByRole("button", { name: "Modifica acquario" }).click();
  await page.locator(".ecosys-form-panel").getByLabel("Nome", { exact: true }).fill(aquariumName + " updated");
  await page.getByRole("button", { name: "Salva modifiche" }).click();
  await expect(page.getByText(aquariumName + " updated", { exact: true })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await aquarium.getByRole("button", { name: "Archivia", exact: true }).click();
  await expect(page.getByText(aquariumName + " updated", { exact: true })).toHaveCount(0);

  const aviaryName = "E2E Aviary " + Date.now();
  await page.goto("/aviaries");
  await page.getByLabel("Nome").fill(aviaryName);
  await page.getByLabel("Capienza").fill("8");
  await page.getByRole("button", { name: "Crea" }).click();
  const aviary = page.locator(".ecosys-item").filter({ hasText: aviaryName });
  await expect(aviary).toBeVisible();
  await page.getByRole("button", { name: "Modifica voliera" }).click();
  await page.locator(".ecosys-form-panel").getByLabel("Nome", { exact: true }).fill(aviaryName + " updated");
  await page.getByRole("button", { name: "Salva modifiche" }).click();
  await expect(page.getByText(aviaryName + " updated", { exact: true })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await aviary.getByRole("button", { name: "Archivia", exact: true }).click();
  await expect(page.getByText(aviaryName + " updated", { exact: true })).toHaveCount(0);

  const animalName = "E2E Companion " + Date.now();
  await createAnimal(page, animalName);
  await page.goto("/companion-care");
  await expect(page.getByLabel("Animale")).toBeVisible();
  await page.getByLabel("Descrizione").fill("Vaccino annuale E2E");
  await page.getByLabel("Data evento").fill("2026-11-26");
  await page.getByRole("button", { name: "Registra evento" }).click();
  await expect(page.getByText("Vaccino annuale E2E", { exact: true })).toBeVisible();
  const record = page.locator(".ecosys-reading").filter({ hasText: "Vaccino annuale E2E" });
  await record.getByRole("button", { name: "Modifica" }).click();
  await page.getByLabel("Descrizione").fill("Vaccino aggiornato E2E");
  await page.getByRole("button", { name: "Salva modifiche" }).click();
  await expect(page.getByText("Vaccino aggiornato E2E", { exact: true })).toBeVisible();
  const updatedRecord = page.locator(".ecosys-reading").filter({ hasText: "Vaccino aggiornato E2E" });
  page.once("dialog", (dialog) => dialog.accept());
  await updatedRecord.getByRole("button", { name: "Elimina" }).click();
  await expect(page.getByText("Vaccino aggiornato E2E", { exact: true })).toHaveCount(0);
});
