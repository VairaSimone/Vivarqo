import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const { test, expect } = await import(process.env.PLAYWRIGHT_TEST_MODULE);

const owner = { email: "e2e-owner@vivarqo.test", password: "Vivarqo-E2E-Only-2026!" };
const other = { email: "e2e-other@vivarqo.test", password: "Vivarqo-E2E-Only-2026!" };

function isExpectedMissingVapidConfiguration(response) {
  return response.status() === 503 &&
    new URL(response.url()).pathname === "/api/v1/push/public-key";
}

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
    if (response.status() >= 500 && !isExpectedMissingVapidConfiguration(response)) {
      unexpectedServerErrors.push(response.url() + " " + response.status());
    }
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
      iconResults: await Promise.all(manifest.icons.map(async (icon) => {
        const iconResponse = await fetch(icon.src);
        return { ok: iconResponse.ok, contentType: iconResponse.headers.get("content-type") ?? "" };
      })),
      appleTouchIconLoaded: await (async () => {
        const link = document.querySelector('link[rel="apple-touch-icon"]');
        return Boolean(link && (await fetch(link.href)).ok);
      })(),
      iconSizes: manifest.icons.map((icon) => icon.sizes),
      rasterIconSizes: manifest.icons.filter((icon) => icon.type === "image/png").map((icon) => icon.sizes),
      serviceWorkerActive: Boolean(registration.active),
      serviceWorkerScope: registration.scope,
      controlled: Boolean(navigator.serviceWorker.controller)
    };
  });
  expect(pwaState.manifest.start_url).toBe("/today");
  expect(pwaState.manifest.scope).toBe("/");
  expect(pwaState.manifest.display).toBe("standalone");
  expect(pwaState.manifest.icons?.length).toBeGreaterThanOrEqual(2);
  expect(pwaState.iconSizes).toEqual(expect.arrayContaining(["any"]));
  expect(pwaState.rasterIconSizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  expect(pwaState.iconResults.every((icon) => icon.ok)).toBe(true);
  expect(pwaState.iconResults.filter((icon) => icon.contentType.includes("image/png"))).toHaveLength(2);
  expect(pwaState.appleTouchIconLoaded).toBe(true);
  expect(pwaState.serviceWorkerActive).toBe(true);
  expect(pwaState.serviceWorkerScope).toContain("127.0.0.1:4173");
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Page.enable");
  const appManifest = await cdp.send("Page.getAppManifest");
  expect(appManifest.errors).toEqual([]);
  const installability = await cdp.send("Page.getInstallabilityErrors");
  expect(installability.installabilityErrors).toEqual([]);
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

  const ownListResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/animals?page=1&pageSize=25&status=active");
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
    const otherListResponse = await otherContext.request.get("http://127.0.0.1:4173/api/v1/animals?page=1&pageSize=25&status=all");
    expect(otherListResponse.status()).toBe(200);
    const otherList = await otherListResponse.json();
    expect(otherList.animals.some((animal) => animal.id === created.id)).toBe(false);
    const foreignDetail = await otherContext.request.get("http://127.0.0.1:4173/api/v1/animals/" + created.id);
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
    if (response.status() >= 500 && !isExpectedMissingVapidConfiguration(response)) {\n      unexpectedServerErrors.push(response.url() + " " + response.status());\n    }
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
    "today", "animals", "animals/" + created.id, "feeding", "feeding?create=1",
    "tasks", "calendar", "reproduction", "clutches", "inventory", "documents",
    "finance", "settings", "settings/notifications", "notifications", "billing", "imports", "exports"
  ];
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const route of routes) {
      if (route === "feeding?create=1") {
        await page.goto("/feeding");
        await page.getByRole("button", { name: "Registra alimentazione" }).first().click();
      } else {
        await page.goto("/" + route);
      }
      await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
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
    buffer: Buffer.from("name,species,sex,morph\nE2E Imported Python,Python regius,unknown,Normal\n", "utf8")
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

  await page.goto("/feeding");
  await page.getByRole("button", { name: "Registra alimentazione" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("checkbox", { name: new RegExp(animalName) }).check();
  await page.getByLabel("Esito").selectOption("ate");
  await page.getByLabel("Alimento").fill("Rat");
  await page.getByRole("button", { name: "Registra alimentazione" }).last().click();
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
  await page.getByLabel("Giacenza").fill("1");
  await page.getByLabel("Costo unitario (€)").fill("5.00");
  await page.getByRole("button", { name: "Registra movimento" }).click();
  const movementsResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/inventory/items/" + stockItem.id + "/movements?page=1&pageSize=100");
  expect(movementsResponse.status()).toBe(200);
  const movementsBody = await movementsResponse.json();
  expect(movementsBody.movements.some((movement) => movement.movementType === "in" && Number(movement.quantity) === 1)).toBe(true);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Archivia" }).click();
  const archivedResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/inventory/items?page=1&pageSize=25&active=false");
  expect(archivedResponse.status()).toBe(200);
  expect((await archivedResponse.json()).items.some((item) => item.id === stockItem.id && item.isActive === false)).toBe(true);
});

test("reproduction cycle, event, clutch, eggs, incubation and offspring persist", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, owner);

  const parentNames = ["E2E Breeding Parent A", "E2E Breeding Parent B"];
  await page.goto("/animals");
  for (const name of parentNames) {
    await page.getByRole("button", { name: "Nuovo animale" }).click();
    await page.getByLabel("Nome").fill(name);
    await page.getByLabel("Specie").fill("Python regius");
    await page.getByRole("button", { name: "Salva modifiche" }).click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  const animalsResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/animals?page=1&pageSize=100&status=active");
  const animals = (await animalsResponse.json()).animals;
  const parentA = animals.find((animal) => animal.name === parentNames[0]);
  const parentB = animals.find((animal) => animal.name === parentNames[1]);
  expect(parentA?.id).toBeTruthy();
  expect(parentB?.id).toBeTruthy();

  await page.goto("/reproduction");
  await page.getByRole("button", { name: "Nuovo ciclo" }).click();
  await page.getByLabel("Nome ciclo").fill("E2E Breeding Cycle");
  await page.getByLabel("Genitore A").selectOption(parentA.id);
  await page.getByLabel("Genitore B").selectOption(parentB.id);
  await page.getByRole("button", { name: "Salva modifiche" }).click();
  const cyclesResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/reproduction-cycles?page=1&pageSize=25&status=all");
  expect(cyclesResponse.status()).toBe(200);
  const cycle = (await cyclesResponse.json()).cycles.find((item) => item.name === "E2E Breeding Cycle");
  expect(cycle?.id).toBeTruthy();

  await page.goto("/reproduction-cycles/" + cycle.id);
  await page.getByRole("button", { name: "Registra evento" }).first().click();
  await page.getByLabel("Tipo evento").selectOption("pairing");
  await page.getByLabel("Scheda animale").selectOption(parentA.id);
  await page.getByRole("button", { name: "Salva modifiche" }).click();
  let cycleDetailResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/reproduction-cycles/" + cycle.id);
  expect((await cycleDetailResponse.json()).cycle.events.some((event) => event.eventType === "pairing")).toBe(true);

  await page.getByRole("button", { name: "Covate" }).click();
  await page.getByRole("button", { name: "Aggiungi covata" }).click();
  await page.getByLabel("Deposizione").fill("2026-11-01");
  await page.getByLabel("Numero uova").fill("2");
  await page.getByLabel("Stato").fill("incubating");
  await page.getByLabel("Incubatore").fill("E2E Incubator");
  await page.getByRole("button", { name: "Salva modifiche" }).click();
  cycleDetailResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/reproduction-cycles/" + cycle.id);
  const clutch = (await cycleDetailResponse.json()).cycle.clutches.find((item) => item.incubatorLabel === "E2E Incubator");
  expect(clutch?.id).toBeTruthy();

  await page.goto("/clutches/" + clutch.id);
  await page.getByRole("button", { name: "Registra uova" }).click();
  await page.getByLabel("Codice uovo").fill("E2E-EGG-01\nE2E-EGG-02");
  await page.getByRole("button", { name: "Salva modifiche" }).click();
  let clutchResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/clutches/" + clutch.id);
  expect((await clutchResponse.json()).clutch.eggs.length).toBe(2);

  await page.getByRole("button", { name: "Aggiungi misurazione" }).first().click();
  await page.getByLabel("Temperatura (°C)").fill("31");
  await page.getByLabel("Umidità (%)").fill("70");
  await page.getByRole("button", { name: "Salva modifiche" }).click();
  clutchResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/clutches/" + clutch.id);
  const clutchDetail = (await clutchResponse.json()).clutch;
  expect(clutchDetail.incubationLogs.some((log) => Number(log.temperatureC) === 31 && Number(log.humidityPct) === 70)).toBe(true);

  await page.goto("/reproduction-cycles/" + cycle.id);
  await page.getByRole("button", { name: "Nascite" }).click();
  await page.getByRole("button", { name: "Registra nascita" }).first().click();
  await page.getByLabel("Data nascita").fill("2026-11-02");
  await page.getByLabel("Covate").selectOption(clutch.id);
  await page.getByLabel("Numero piccoli").fill("2");
  await page.getByRole("button", { name: "Salva modifiche" }).click();
  cycleDetailResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/reproduction-cycles/" + cycle.id);
  const cycleAfterBirth = (await cycleDetailResponse.json()).cycle;
  const batch = cycleAfterBirth.offspringBatches.find((item) => Number(item.count) === 2);
  expect(batch?.id).toBeTruthy();

  const conversionPrompts = ["E2E Baby 1\nE2E Baby 2", "Python regius"];
  let conversionPromptIndex = 0;
  const acceptConversionPrompt = (dialog) => {
    const value = conversionPrompts[conversionPromptIndex++];
    if (value === undefined) {
      void dialog.dismiss();
      throw new Error("Unexpected extra prompt in offspring conversion flow");
    }
    void dialog.accept(value);
  };
  page.on("dialog", acceptConversionPrompt);
  const conversionResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/v1/offspring-batches/" + batch.id + "/animals") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Crea schede animali" }).click();
  const babiesResponse = await conversionResponsePromise;
  page.off("dialog", acceptConversionPrompt);
  expect(conversionPromptIndex).toBe(2);
  expect(babiesResponse.status()).toBe(201);
  const animalsAfterConversion = await page.context().request.get("http://127.0.0.1:4173/api/v1/animals?page=1&pageSize=100&status=active");
  const babyNames = (await animalsAfterConversion.json()).animals.map((item) => item.name);
  expect(babyNames).toEqual(expect.arrayContaining(["E2E Baby 1", "E2E Baby 2"]));
});

test("private document upload, metadata edit, download and delete", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, owner);

  const animalName = "E2E Document Python";
  await page.goto("/animals");
  await page.getByRole("button", { name: "Nuovo animale" }).click();
  await page.getByLabel("Nome").fill(animalName);
  await page.getByLabel("Specie").fill("Python regius");
  await page.getByRole("button", { name: "Salva modifiche" }).click();
  const animalsResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/animals?page=1&pageSize=25&status=active");
  const animal = (await animalsResponse.json()).animals.find((item) => item.name === animalName);
  expect(animal?.id).toBeTruthy();

  await page.goto("/documents");
  await page.getByRole("button", { name: "Carica documento" }).first().click();
  await page.getByLabel("File").setInputFiles({
    name: "e2e-veterinary-record.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF", "utf8")
  });
  await page.getByLabel("Categoria documento").fill("Veterinario");
  await page.getByLabel("Scheda animale").selectOption(animal.id);
  const uploadResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/v1/documents") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Carica documento" }).click();
  const uploadResponse = await uploadResponsePromise;
  expect(uploadResponse.status()).toBe(201);
  await expect(page.getByText("e2e-veterinary-record.pdf", { exact: true })).toBeVisible();

  const documentsResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/documents?page=1&pageSize=25&animalId=" + animal.id);
  expect(documentsResponse.status()).toBe(200);
  const document = (await documentsResponse.json()).documents.find((item) => item.originalFilename === "e2e-veterinary-record.pdf");
  expect(document?.id).toBeTruthy();

  await page.getByRole("button", { name: "Modifica" }).click();
  await page.getByLabel("Categoria documento").fill("Clinico");
  await page.getByRole("button", { name: "Salva modifiche" }).click();
  const updatedDocuments = await page.context().request.get("http://127.0.0.1:4173/api/v1/documents?page=1&pageSize=25&animalId=" + animal.id);
  expect((await updatedDocuments.json()).documents.find((item) => item.id === document.id)?.category).toBe("Clinico");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Scarica" }).click();
  const download = await downloadPromise;
  const downloadPath = path.join("test-results", "exports", download.suggestedFilename());
  await mkdir(path.dirname(downloadPath), { recursive: true });
  await download.saveAs(downloadPath);
  expect((await readFile(downloadPath)).subarray(0, 4).toString("ascii")).toBe("%PDF");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Elimina" }).click();
  const remainingDocuments = await page.context().request.get("http://127.0.0.1:4173/api/v1/documents?page=1&pageSize=25&animalId=" + animal.id);
  expect((await remainingDocuments.json()).documents.some((item) => item.id === document.id)).toBe(false);
});

test("profile and language preferences persist across reloads", async ({ page }) => {
  await signIn(page, owner);
  await page.goto("/settings");
  await page.getByLabel("Nome visualizzato").fill("Vivarqo E2E User");
  const profilePatchPromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/account") && response.request().method() === "PATCH"
  );
  await page.getByRole("button", { name: "Salva modifiche" }).first().click();
  expect((await profilePatchPromise).status()).toBe(200);
  const profileResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/auth/me");
  expect(profileResponse.status()).toBe(200);
  expect((await profileResponse.json()).user.displayName).toBe("Vivarqo E2E User");

  const englishLocalePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/account") && response.request().method() === "PATCH"
  );
  await page.getByLabel("Lingua").selectOption("en");
  expect((await englishLocalePromise).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  const englishSession = await page.context().request.get("http://127.0.0.1:4173/api/v1/auth/me");
  expect((await englishSession.json()).user.locale).toBe("en");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  const italianLocalePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/account") && response.request().method() === "PATCH"
  );
  await page.getByLabel("Language").selectOption("it");
  expect((await italianLocalePromise).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Impostazioni" })).toBeVisible();
  const italianSession = await page.context().request.get("http://127.0.0.1:4173/api/v1/auth/me");
  expect((await italianSession.json()).user.locale).toBe("it");
});

test("revoked sessions are rejected by the next authenticated request", async ({ page }) => {
  await signIn(page, owner);
  await page.goto("/settings");
  page.once("dialog", (dialog) => dialog.accept());
  const revokeResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/auth/sessions/revoke-all") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Revoca tutte le sessioni" }).click();
  expect((await revokeResponsePromise).status()).toBe(200);
  await page.waitForURL((url) => url.pathname === "/login");
  await expect(page.getByRole("heading", { name: "Bentornato" })).toBeVisible();
  const revokedSessionResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/animals?page=1&pageSize=1");
  expect(revokedSessionResponse.status()).toBe(401);
});
