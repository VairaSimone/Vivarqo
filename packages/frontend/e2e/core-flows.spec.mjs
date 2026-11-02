import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const { test, expect } = await import(process.env.PLAYWRIGHT_TEST_MODULE);

const owner = { email: "e2e-owner@vivarqo.test", password: "Vivarqo-E2E-Only-2026!" };
const other = { email: "e2e-other@vivarqo.test", password: "Vivarqo-E2E-Only-2026!" };

async function signIn(page, account) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Accedi" }).click();
  await page.waitForURL(/\/today(?:\?.*)?$/);
  await expect(page.getByRole("heading", { name: "Oggi" })).toBeVisible();
}

test("real API authentication, CSRF, animal persistence, account isolation and responsive smoke", async ({ browser, page }) => {
  const pageErrors = [];
  const unexpectedServerErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) unexpectedServerErrors.push(response.url() + " " + response.status());
  });

  await page.goto("/login");
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Accedi" }).click();
  await expect(page.getByRole("alert")).toBeVisible();

  await signIn(page, owner);
  const pwaState = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) throw new Error("PWA manifest link is missing");
    const response = await fetch(link.href, { cache: "no-store" });
    if (!response.ok) throw new Error("PWA manifest could not be loaded");
    const manifest = await response.json();
    const registration = await navigator.serviceWorker.ready;
    return {
      manifest,
      iconsLoaded: await Promise.all(manifest.icons.map(async (icon) => (await fetch(icon.src)).ok)),
      iconSizes: manifest.icons.map((icon) => icon.sizes),
      serviceWorkerActive: Boolean(registration.active),
      serviceWorkerScope: registration.scope,
      controlled: Boolean(navigator.serviceWorker.controller)
    };
  });
  expect(pwaState.manifest.start_url).toBe("/today");
  expect(pwaState.manifest.scope).toBe("/");
  expect(pwaState.manifest.display).toBe("standalone");
  expect(pwaState.manifest.icons?.length).toBeGreaterThanOrEqual(2);
  expect(pwaState.iconSizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  expect(pwaState.iconsLoaded.every(Boolean)).toBe(true);
  expect(pwaState.serviceWorkerActive).toBe(true);
  expect(pwaState.serviceWorkerScope).toContain("127.0.0.1:4173");
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Page.enable");
  const appManifest = await cdp.send("Page.getAppManifest");
  expect(appManifest.errors).toEqual([]);
  await cdp.detach();

  await page.goto("/settings/notifications");
  const permissionBeforePushSetup = await page.evaluate(() => Notification.permission);
  expect(permissionBeforePushSetup).toBe("default");
  await page.getByRole("button", { name: "Attiva notifiche push" }).click();
  await expect(page.getByRole("alert")).toContainText("Web Push non è configurato sul server.");
  expect(await page.evaluate(() => Notification.permission)).toBe("default");

  await page.goto("/today");
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByText(/Sei offline/)).toBeVisible();
  const apiOfflineResult = await page.evaluate(async () => {
    try {
      await fetch("/api/v1/animals", { credentials: "include" });
      return "unexpected-response";
    } catch {
      return "network-error";
    }
  });
  expect(apiOfflineResult).toBe("network-error");
  await page.context().setOffline(false);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Oggi" })).toBeVisible();

  const animalName = "E2E Python Regius";
  await page.goto("/animals");
  const createAnimalButton = page.getByRole("button", { name: "Nuovo animale" });
  await createAnimalButton.click();
  const closeDialogButton = page.getByRole("button", { name: "Chiudi" });
  const saveAnimalButton = page.getByRole("button", { name: "Salva modifiche" });
  await expect(closeDialogButton).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(saveAnimalButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closeDialogButton).toBeFocused();
  await page.getByLabel("Nome").fill(animalName);
  await page.getByLabel("Specie").fill("Python regius");
  await page.getByRole("button", { name: "Salva modifiche" }).click();
  await expect(page.getByText(animalName, { exact: true })).toBeVisible();

  const ownListResponse = await page.context().request.get("http://127.0.0.1:5173/api/v1/animals?page=1&pageSize=25&status=active");
  expect(ownListResponse.status()).toBe(200);
  const ownList = await ownListResponse.json();
  const created = ownList.animals.find((animal) => animal.name === animalName);
  expect(created?.id).toBeTruthy();

  await page.reload();
  await expect(page.getByText(animalName, { exact: true })).toBeVisible();

  const csrfStatus = await page.evaluate(async () => {
    const response = await fetch("/api/v1/animals", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "CSRF bypass attempt", species: "Python regius" })
    });
    return response.status;
  });
  expect(csrfStatus).toBe(403);

  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  try {
    await signIn(otherPage, other);
    const otherListResponse = await otherContext.request.get("http://127.0.0.1:5173/api/v1/animals?page=1&pageSize=25&status=all");
    expect(otherListResponse.status()).toBe(200);
    const otherList = await otherListResponse.json();
    expect(otherList.animals.some((animal) => animal.id === created.id)).toBe(false);
    const foreignDetail = await otherContext.request.get("http://127.0.0.1:5173/api/v1/animals/" + created.id);
    expect(foreignDetail.status()).toBe(404);
  } finally {
    await otherContext.close();
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Esci" }).click();
  await page.waitForURL((url) => url.pathname === "/login");
  await expect(page.getByRole("heading", { name: "Bentornato" })).toBeVisible();

  expect(pageErrors, "uncaught browser JavaScript errors").toEqual([]);
  expect(unexpectedServerErrors, "unexpected HTTP 5xx responses").toEqual([]);
});

test("responsive screenshot matrix at all target viewport sizes", async ({ page }) => {
  test.setTimeout(300_000);
  const pageErrors = [];
  const unexpectedServerErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) unexpectedServerErrors.push(response.url() + " " + response.status());
  });

  await signIn(page, owner);
  const animalName = "E2E Responsive Python Regius";
  await page.goto("/animals");
  await page.getByRole("button", { name: "Nuovo animale" }).click();
  await page.getByLabel("Nome").fill(animalName);
  await page.getByLabel("Specie").fill("Python regius");
  await page.getByRole("button", { name: "Salva modifiche" }).click();
  await expect(page.getByText(animalName, { exact: true })).toBeVisible();

  const listResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/animals?page=1&pageSize=25&status=active");
  expect(listResponse.status()).toBe(200);
  const list = await listResponse.json();
  const created = list.animals.find((animal) => animal.name === animalName);
  expect(created?.id).toBeTruthy();

  const viewports = [
    { name: "desktop-1440x900", width: 1440, height: 900 },
    { name: "laptop-1280x800", width: 1280, height: 800 },
    { name: "tablet-1024x768", width: 1024, height: 768 },
    { name: "mobile-390x844", width: 390, height: 844 },
    { name: "mobile-320x700", width: 320, height: 700 }
  ];
  const routes = [
    "today", "animals", "animals/" + created.id, "feeding", "feeding?create=1", "feeding?bulk=1",
    "tasks", "tasks?create=1", "calendar", "reproduction", "reproduction-cycles", "clutches",
    "inventory", "documents", "finance", "settings", "settings/notifications",
    "notifications", "billing", "imports", "exports"
  ];
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const route of routes) {
      await page.goto("/" + route);
      await page.waitForLoadState("networkidle");
      const dimensions = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth
      }));
      const folder = path.join("test-results", "responsive", viewport.name);
      await mkdir(folder, { recursive: true });
      await page.screenshot({ path: path.join(folder, route.replaceAll("/", "-").replaceAll("?", "-").replaceAll("=", "-") + ".png"), fullPage: true });
      expect(dimensions.document, "unexpected horizontal page overflow at " + viewport.name + " on /" + route)
        .toBeLessThanOrEqual(dimensions.viewport + 1);
    }
  }

  expect(pageErrors, "uncaught browser JavaScript errors").toEqual([]);
  expect(unexpectedServerErrors, "unexpected HTTP 5xx responses").toEqual([]);
});

test("animal CSV import preview, confirmation and persisted result", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, owner);
  await page.goto("/imports");
  await page.getByLabel("Tipo di dati").selectOption("animals");
  await page.getByLabel("Scegli CSV o XLSX").setInputFiles({
    name: "vivarqo-e2e-animals.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("name,species,sex,morph\\nE2E Imported Python,Python regius,unknown,Normal\\n", "utf8")
  });

  const previewResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/v1/imports?entity=animals") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Anteprima" }).click();
  const previewResponse = await previewResponsePromise;
  expect(previewResponse.status()).toBe(201);
  const preview = await previewResponse.json();
  expect(preview.validRows).toBe(1);
  expect(preview.invalidRows).toBe(0);
  expect(preview.importId).toBeTruthy();
  await expect(page.getByText("E2E Imported Python", { exact: false })).toBeVisible();

  const confirmResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/v1/imports/" + preview.importId + "/confirm") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Conferma importazione" }).click();
  const confirmResponse = await confirmResponsePromise;
  expect(confirmResponse.status()).toBe(202);

  await expect.poll(async () => {
    const response = await page.context().request.get("http://127.0.0.1:4173/api/v1/imports/" + preview.importId + "?statusOnly=true");
    expect(response.status()).toBe(200);
    return (await response.json()).status;
  }, { timeout: 90_000, intervals: [1000, 2000, 3000] }).toBe("completed");

  await page.goto("/animals");
  await expect(page.getByText("E2E Imported Python", { exact: true })).toBeVisible();
});

test("background export job produces a downloadable ZIP", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, owner);
  await page.goto("/exports");
  await page.getByRole("button", { name: "Avvia esportazione" }).click();
  const downloadButton = page.getByRole("button", { name: "Scarica" });
  await expect(downloadButton).toBeVisible({ timeout: 90_000 });

  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^vivarqo-export-[0-9a-f-]+\.zip$/i);

  const folder = path.join("test-results", "exports");
  await mkdir(folder, { recursive: true });
  const archivePath = path.join(folder, download.suggestedFilename());
  await download.saveAs(archivePath);
  const archive = await readFile(archivePath);
  expect(archive.subarray(0, 2).toString("ascii")).toBe("PK");
  expect(archive.length).toBeGreaterThan(100);
});

test("care, tasks, finance and inventory mutations persist through the live API", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, owner);

  const animalName = "E2E Domain Python Regius";
  await page.goto("/animals");
  await page.getByRole("button", { name: "Nuovo animale" }).click();
  await page.getByLabel("Nome").fill(animalName);
  await page.getByLabel("Specie").fill("Python regius");
  await page.getByRole("button", { name: "Salva modifiche" }).click();
  await expect(page.getByText(animalName, { exact: true })).toBeVisible();
  const animalsResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/animals?page=1&pageSize=25&status=active");
  expect(animalsResponse.status()).toBe(200);
  const animalsBody = await animalsResponse.json();
  const animal = animalsBody.animals.find((item) => item.name === animalName);
  expect(animal?.id).toBeTruthy();

  await page.goto("/feeding?create=1&animalId=" + animal.id);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("Esito").selectOption("ate");
  await page.getByLabel("Alimento").fill("Rat");
  await page.getByRole("button", { name: "Registra sessione" }).click();
  const feedingResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/feeding-sessions?page=1&pageSize=25");
  expect(feedingResponse.status()).toBe(200);
  const feedingBody = await feedingResponse.json();
  const feedingEntry = feedingBody.sessions.flatMap((session) => session.entries).find((entry) => entry.animalId === animal.id);
  expect(feedingEntry?.outcome).toBe("ate");
  expect(feedingEntry?.foodType).toBe("Rat");

  await page.getByRole("button", { name: "Modifica" }).click();
  await page.getByLabel("Esito").selectOption("refused");
  await page.getByRole("button", { name: "Salva modifiche" }).click();
  const editedFeedings = await page.context().request.get("http://127.0.0.1:4173/api/v1/feeding-sessions?page=1&pageSize=25");
  const editedEntry = (await editedFeedings.json()).sessions.flatMap((session) => session.entries).find((entry) => entry.id === feedingEntry.id);
  expect(editedEntry?.outcome).toBe("refused");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Elimina" }).click();
  const deletedFeedings = await page.context().request.get("http://127.0.0.1:4173/api/v1/feeding-sessions?page=1&pageSize=25");
  expect((await deletedFeedings.json()).sessions.flatMap((session) => session.entries).some((entry) => entry.id === feedingEntry.id)).toBe(false);

  await page.goto("/tasks?create=1");
  await page.getByLabel("Titolo attività").fill("E2E Task follow-up");
  await page.getByLabel("Scheda animale").selectOption(animal.id);
  await page.getByRole("button", { name: "Salva modifiche" }).click();
  const tasksResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/tasks?page=1&pageSize=25&status=open");
  expect(tasksResponse.status()).toBe(200);
  const tasksBody = await tasksResponse.json();
  const task = tasksBody.tasks.find((item) => item.title === "E2E Task follow-up");
  expect(task?.id).toBeTruthy();
  await page.getByRole("button", { name: "Completata" }).click();
  const completedTasksResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/tasks?page=1&pageSize=25&status=completed");
  expect((await completedTasksResponse.json()).tasks.some((item) => item.id === task.id && item.status === "completed")).toBe(true);

  await page.goto("/finance");
  await page.getByRole("button", { name: "Nuova voce" }).click();
  await page.getByLabel("Importo (€)").fill("12.50");
  await page.getByLabel("Valuta").fill("EUR");
  await page.getByLabel("Categoria").nth(1).fill("Test E2E");
  await page.getByLabel("Descrizione").fill("E2E veterinary expense");
  await page.getByLabel("Scheda animale").selectOption(animal.id);
  await page.getByRole("button", { name: "Salva modifiche" }).click();
  const financeResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/finance/entries?page=1&pageSize=25");
  expect(financeResponse.status()).toBe(200);
  const financeBody = await financeResponse.json();
  expect(financeBody.entries.some((entry) => entry.description === "E2E veterinary expense" && entry.amountCents === 1250)).toBe(true);

  await page.goto("/inventory");
  await page.getByRole("button", { name: "Nuovo articolo" }).click();
  await page.getByLabel("Nome articolo").fill("E2E Food Stock");
  await page.getByLabel("Categoria").selectOption("food");
  await page.getByLabel("Unità").fill("kg");
  await page.getByLabel("Giacenza").fill("2");
  await page.getByLabel("Scorta minima").fill("1");
  await page.getByRole("button", { name: "Salva modifiche" }).click();
  const inventoryResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/inventory/items?page=1&pageSize=25&active=true");
  expect(inventoryResponse.status()).toBe(200);
  const inventoryBody = await inventoryResponse.json();
  const stockItem = inventoryBody.items.find((item) => item.name === "E2E Food Stock");
  expect(stockItem?.id).toBeTruthy();
  expect(Number(stockItem.quantityOnHand)).toBe(2);

  await page.getByRole("button", { name: "Movimenti" }).last().click();
  await page.getByLabel("Tipo movimento").selectOption("in");
  await page.getByLabel("Quantità").fill("1");
  await page.getByLabel("Costo unitario (€)").fill("5.00");
  await page.getByRole("button", { name: "Registra movimento" }).click();
  const movementsResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/inventory/items/" + stockItem.id + "/movements?page=1&pageSize=100");
  expect(movementsResponse.status()).toBe(200);
  const movementsBody = await movementsResponse.json();
  expect(movementsBody.movements.some((movement) => movement.movementType === "in" && Number(movement.quantity) === 1)).toBe(true);
});
