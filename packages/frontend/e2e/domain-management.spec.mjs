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

async function createAnimal(page, name, options = {}) {
  const result = await page.evaluate(async ({ name, options }) => {
    const csrf = await fetch("/api/v1/auth/csrf", { credentials: "same-origin" }).then((response) => response.json());
    const response = await fetch("/api/v1/animals", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf.csrfToken },
      body: JSON.stringify({
        name,
        species: options.species ?? "Cane meticcio",
        category: options.category ?? "dogs_cats",
        sex: options.sex ?? "unknown",
        domainProfile: options.domainProfile ?? {},
      })
    });
    return { status: response.status, body: await response.json() };
  }, { name, options });
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return result.body.animal;
}


test("animal list supports multi-selection and atomic bulk weight records", async ({ page }) => {
  await signIn(page);
  await enableAllCategories(page);

  const firstName = "E2E Bulk animal A " + Date.now();
  const secondName = "E2E Bulk animal B " + Date.now();
  await createAnimal(page, firstName);
  await createAnimal(page, secondName);

  await page.goto("/animals");
  await page.getByLabel("Seleziona " + firstName).check();
  await page.getByLabel("Seleziona " + secondName).check();
  const bulkAction = page.getByRole("button", { name: "Registra su 2 animali" });
  await expect(bulkAction).toBeVisible();
  await bulkAction.click();

  await page.getByRole("dialog").locator('input[type="number"]').last().fill("1250");
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    new URL(response.url()).pathname === "/api/v1/care-records/bulk"
  );
  await page.getByRole("dialog").getByRole("button", { name: "Registra", exact: true }).click();
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(201);
  expect((await response.json()).createdCount).toBe(2);
  await expect(page.getByRole("button", { name: "Registra su 2 animali" })).toHaveCount(0);
});


test("bulk animal creation respects each row category", async ({ page }) => {
  await signIn(page);
  await enableAllCategories(page);
  await page.goto("/animals");
  await page.getByRole("button", { name: "Crea animali multipli" }).click();

  const stamp = Date.now();
  const rows = [
    "E2E Bulk reptile " + stamp + " | Python regius | reptiles | female | Pastel |",
    "E2E Bulk fish " + stamp + " | Betta splendens | fish | unknown | |"
  ].join("\n");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Animali da creare").fill(rows);

  const requestPromise = page.waitForRequest((request) =>
    request.method() === "POST" && new URL(request.url()).pathname === "/api/v1/animals/bulk"
  );
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/animals/bulk"
  );
  await dialog.getByRole("button", { name: "Crea", exact: true }).click();
  const request = await requestPromise;
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(201);
  expect(request.postDataJSON().animals.map((animal) => animal.category)).toEqual(["reptiles", "fish"]);
});

test("companion animals do not expose reptile prey fields or shed actions", async ({ page }) => {
  await signIn(page);
  await enableAllCategories(page);
  const dog = await createAnimal(page, "E2E Companion care " + Date.now(), {
    domainProfile: { breed: "Labrador", allergies: "Polline", chronicConditions: "Nessuna" },
  });

  await page.goto("/feeding?create=1&animalId=" + encodeURIComponent(dog.id));
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Stato della preda", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("Collega preda all'inventario", { exact: true })).toHaveCount(0);

  const requestPromise = page.waitForRequest((request) =>
    request.method() === "POST" && new URL(request.url()).pathname === "/api/v1/feeding-sessions"
  );
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/feeding-sessions"
  );
  await dialog.getByRole("button", { name: "Registra sessione", exact: true }).click();
  const request = await requestPromise;
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(201);
  const entry = request.postDataJSON().entries[0];
  expect(entry).not.toHaveProperty("preyState");
  expect(entry).not.toHaveProperty("inventoryItemId");

  await page.goto("/animals/" + encodeURIComponent(dog.id));
  await expect(page.getByRole("button", { name: "Registra muta", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "Storico cure" }).click();
  await expect(page.getByRole("heading", { name: "Registra muta", exact: true })).toHaveCount(0);

  await page.getByRole("tab", { name: "Panoramica" }).click();
  await expect(page.getByText("Labrador", { exact: true })).toBeVisible();
  await expect(page.getByText("Polline", { exact: true })).toBeVisible();

  const protectedRequests = await page.evaluate(async ({ animalId }) => {
    const csrf = await fetch("/api/v1/auth/csrf", { credentials: "same-origin" }).then((response) => response.json());
    async function request(path, method, body) {
      const response = await fetch("/api/v1" + path, {
        method,
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf.csrfToken },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json().catch(() => ({})) };
    }
    const now = new Date().toISOString();
    return {
      getSheds: await request("/animals/" + animalId + "/sheds", "GET"),
      postShed: await request("/animals/" + animalId + "/sheds", "POST", { occurredAt: now, outcome: "complete" }),
      bulkShed: await request("/care-records/bulk", "POST", { kind: "shed", animalIds: [animalId], occurredAt: now, outcome: "complete" }),
      preyFields: await request("/feeding-sessions", "POST", {
        performedAt: now,
        entries: [{ animalId, outcome: "ate", preyState: "live" }],
      }),
    };
  }, { animalId: dog.id });
  expect(protectedRequests.getSheds.status).toBe(404);
  expect(protectedRequests.postShed.status).toBe(404);
  expect(protectedRequests.bulkShed.status).toBe(400);
  expect(protectedRequests.bulkShed.body.code).toBe("SHED_REPTILE_ONLY");
  expect(protectedRequests.preyFields.status).toBe(400);
  expect(protectedRequests.preyFields.body.code).toBe("CATEGORY_FIELD_NOT_ALLOWED");
});

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
  await page.getByRole("button", { name: "Archivia", exact: true }).click();
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
  await page.getByRole("button", { name: "Archivia", exact: true }).click();
  await expect(page.getByText(aviaryName + " updated", { exact: true })).toHaveCount(0);

  const animalName = "E2E Companion " + Date.now();
  const companionAnimal = await createAnimal(page, animalName);
  await page.goto("/companion-care");
  const companionSelector = page.getByLabel("Animale");
  await expect(companionSelector).toBeVisible();
  await companionSelector.selectOption(companionAnimal.id);
  await expect(companionSelector).toHaveValue(companionAnimal.id);
  await page.getByLabel("Descrizione").fill("Vaccino annuale E2E");
  await page.getByLabel("Data evento").fill("2026-11-26");
  const careCreatedResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    new URL(response.url()).pathname === "/api/v1/companion-care"
  );
  await page.getByRole("button", { name: "Registra evento" }).click();
  const careResponse = await careCreatedResponse;
  expect(careResponse.status(), await careResponse.text()).toBe(201);
  const createdCare = await careResponse.json();
  expect(createdCare.record.animalId).toBe(companionAnimal.id);
  const record = page.locator(".ecosys-reading").filter({ hasText: "Vaccino annuale E2E" });
  await expect(record).toBeVisible();
  await record.getByRole("button", { name: "Modifica" }).click();
  await page.getByLabel("Descrizione").fill("Vaccino aggiornato E2E");
  await page.getByRole("button", { name: "Salva modifiche" }).click();
  const updatedRecord = page.locator(".ecosys-reading").filter({ hasText: "Vaccino aggiornato E2E" });
  await expect(updatedRecord).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await updatedRecord.getByRole("button", { name: "Elimina" }).click();
  await expect(updatedRecord).toHaveCount(0);
});


test("dogs and cats can track mating, pregnancy and litter outcomes", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  await enableAllCategories(page);

  const stamp = Date.now();
  const female = await createAnimal(page, "E2E Mother " + stamp, { sex: "female" });
  const male = await createAnimal(page, "E2E Father " + stamp, { sex: "male" });
  const differentSpeciesMale = await createAnimal(page, "E2E Other species " + stamp, { sex: "male", species: "Gatto europeo" });

  await page.goto("/companion-reproduction");
  const femaleSelect = page.getByLabel("Femmina / madre");
  const maleSelect = page.getByLabel("Maschio / padre");
  await expect(femaleSelect.locator(`option[value="${female.id}"]`)).toHaveCount(1);
  await expect(maleSelect.locator(`option[value="${male.id}"]`)).toHaveCount(1);
  await expect(maleSelect.locator(`option[value="${differentSpeciesMale.id}"]`)).toHaveCount(0);
  await femaleSelect.selectOption(female.id);
  await maleSelect.selectOption(male.id);
  await page.getByLabel("Data accoppiamento").fill("2026-11-20");
  await page.getByLabel("Stato").selectOption("pregnant");
  await page.getByLabel("Gravidanza confermata il").fill("2026-11-24");
  await page.getByLabel("Data presunta parto").fill("2027-01-20");

  const createdResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/companion-reproductions"
  );
  await page.getByRole("button", { name: "Salva registro" }).click();
  const created = await createdResponse;
  expect(created.status(), await created.text()).toBe(201);
  const createdBody = await created.json();
  expect(createdBody.record.femaleAnimalId).toBe(female.id);
  expect(createdBody.record.maleAnimalId).toBe(male.id);

  const pregnantRow = page.locator(".ecosys-reading").filter({ hasText: "Gravidanza confermata" });
  await expect(pregnantRow).toBeVisible();
  await pregnantRow.getByRole("button", { name: "Modifica" }).click();
  await page.getByLabel("Stato").selectOption("delivered");
  await page.getByLabel("Data parto").fill("2027-01-18");
  await page.getByLabel("Cuccioli totali").fill("4");
  await page.getByLabel("Nati vivi").fill("4");
  await page.getByLabel("Nati morti").fill("0");

  const updatedResponse = page.waitForResponse((response) =>
    response.request().method() === "PATCH" &&
    new URL(response.url()).pathname === "/api/v1/companion-reproductions/" + createdBody.record.id
  );
  await page.getByRole("button", { name: "Salva registro" }).click();
  const updated = await updatedResponse;
  expect(updated.status(), await updated.text()).toBe(200);
  const updatedBody = await updated.json();
  expect(updatedBody.record.status).toBe("delivered");
  expect(updatedBody.record.totalBorn).toBe(4);
  expect(updatedBody.record.liveBorn).toBe(4);

  const deliveredRow = page.locator(".ecosys-reading").filter({ hasText: "Parto completato" });
  await expect(deliveredRow).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await deliveredRow.getByRole("button", { name: "Elimina" }).click();
  await expect(deliveredRow).toHaveCount(0);
});
