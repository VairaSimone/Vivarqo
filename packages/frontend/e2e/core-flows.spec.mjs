import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const { test, expect } = await import(process.env.PLAYWRIGHT_TEST_MODULE);
const { AxeBuilder } = await import(process.env.AXE_PLAYWRIGHT_MODULE);

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
  await expect(page.getByRole("heading", { name: "Oggi", exact: true })).toBeVisible();
}


async function expectNoA11yViolations(page, context) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const violations = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => ({
      target: node.target,
      failureSummary: node.failureSummary,
      any: node.any.map((check) => ({ message: check.message, data: check.data }))
    }))
  }));
  expect(violations, `WCAG 2.2 AA axe scan failed on ${context}: ${JSON.stringify(violations)}`).toEqual([]);
}

test("WCAG 2.2 AA automated accessibility and keyboard interaction baseline", async ({ page }) => {
  await signIn(page, owner);

  // Keyboard users must reach the main landmark before the application navigation.
  await page.keyboard.press("Tab");
  await expect(page.locator(".skip-link")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();

  test.setTimeout(180_000);
  // Audit each principal application route (not just the dashboard) using the
  // WCAG 2.0/2.1/2.2 A and AA axe rule sets.
  const auditedRoutes = [
    "/today", "/animals", "/feeding", "/tasks", "/calendar",
    "/reproduction", "/clutches", "/inventory", "/documents",
    "/finance", "/settings", "/settings/notifications",
    "/notifications", "/billing", "/imports", "/exports"
  ];
  for (const route of auditedRoutes) {
    await page.goto(route);
    await expect(page.locator("#main-content")).toBeVisible();
    await expectNoA11yViolations(page, route);
  }

  // The mobile navigation drawer is keyboard-contained and restores focus on close.
  await page.setViewportSize({ width: 390, height: 844 });
  const menuTrigger = page.locator(".mobile-menu-button");
  await menuTrigger.click();
  const sidebarDialog = page.locator("#application-sidebar");
  await expect(sidebarDialog).toHaveAttribute("role", "dialog");
  await expect(sidebarDialog.getByRole("button").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(sidebarDialog).not.toHaveAttribute("role", "dialog");
  await expect(menuTrigger).toBeFocused();

  // Modal naming, focus wrapping, Escape handling and focus restoration.
  await page.goto("/animals");
  const createAnimalTrigger = page.getByRole("button", { name: "Nuovo animale" });
  await createAnimalTrigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expectNoA11yViolations(page, "animal creation dialog");
  const focusable = dialog.locator('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
  await focusable.last().focus();
  await page.keyboard.press("Tab");
  await expect(focusable.first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(createAnimalTrigger).toBeFocused();

  // Verify the live computed sizes, not only the CSS source declarations.
  const sizes = await page.evaluate(() => {
    const read = (selector) => [...document.querySelectorAll(selector)]
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => ({ selector, size: Number.parseFloat(getComputedStyle(element).fontSize) }));
    return [
      ...read(".field-label, .field-hint, .field-error, .badge, th, td, .nav-caption, .mobile-bottom-nav button"),
      ...read(".btn, .btn-sm").map((item) => ({ ...item, minimum: 14 })),
      ...read(".control").map((item) => ({ ...item, minimum: 16 }))
    ];
  });
  expect(sizes.length, "the audited page must contain real UI text").toBeGreaterThan(0);
  expect(sizes.filter((item) => item.size < (item.minimum ?? 12))).toEqual([]);
});

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
  await expect(page.getByText("Cosa richiede attenzione oggi?")).toBeVisible();
  await expect(page.getByRole("heading", { name: "In ritardo" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Da fare oggi" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nei prossimi 7 giorni" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Registra alimentazione" })).toBeVisible();

  // Create a real task due in two days and verify that the dashboard surfaces
  // it in the upcoming section and opens its own task detail when selected.
  await page.goto("/tasks?create=1");
  await page.getByLabel("Titolo attività").fill("E2E dashboard upcoming task");
  const upcomingDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const upcomingDateTime = new Date(upcomingDate.getTime() - upcomingDate.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await page.getByLabel("Scadenza").fill(upcomingDateTime);
  const upcomingTaskCreated = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    response.url().endsWith("/api/v1/tasks") &&
    response.status() === 201
  );
  await page.getByRole("button", { name: "Salva modifiche" }).click();
  await upcomingTaskCreated;
  await page.goto("/today");
  const upcomingTask = page.getByRole("button", { name: "Apri attività: E2E dashboard upcoming task" });
  await expect(upcomingTask).toBeVisible();
  await upcomingTask.click();
  await expect(page.getByRole("dialog")).toContainText("E2E dashboard upcoming task");
  await page.getByRole("button", { name: "Chiudi" }).click();
  await page.goto("/today");

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(manifestHref).toBeTruthy();
  const manifestResponse = await page.request.get(new URL(manifestHref, page.url()).toString());
  expect(manifestResponse.ok(), "PWA manifest must load").toBe(true);
  const manifest = await manifestResponse.json();
  expect(manifest.start_url).toBe("/today");
  expect(manifest.scope).toBe("/");
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons?.length).toBeGreaterThanOrEqual(2);
  expect(manifest.icons.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(["any"]));
  expect(manifest.icons.filter((icon) => icon.type === "image/png").map((icon) => icon.sizes))
    .toEqual(expect.arrayContaining(["192x192", "512x512"]));
  const iconResults = await Promise.all(manifest.icons.map(async (icon) => {
    const response = await page.request.get(new URL(icon.src, page.url()).toString());
    return { source: icon.src, ok: response.ok(), contentType: response.headers()["content-type"] ?? "" };
  }));
  expect(iconResults.every((icon) => icon.ok), JSON.stringify(iconResults)).toBe(true);
  expect(iconResults.filter((icon) => icon.contentType.includes("image/png"))).toHaveLength(2);
  const appleIconHref = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
  expect(appleIconHref).toBeTruthy();
  expect((await page.request.get(new URL(appleIconHref, page.url()).toString())).ok()).toBe(true);

  const serviceWorkerScope = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) throw new Error("Service Workers are not supported by this browser");
    const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    return registration.scope;
  });
  expect(serviceWorkerScope).toContain("127.0.0.1:4173");
  await expect.poll(async () => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration("/");
    return registration?.active?.state ?? registration?.installing?.state ?? registration?.waiting?.state ?? "missing";
  }), { timeout: 20_000, intervals: [250, 500, 1000] }).toBe("activated");
  const workerDiagnostics = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration("/");
    return {
      scope: registration?.scope ?? null,
      active: registration?.active?.state ?? null,
      installing: registration?.installing?.state ?? null,
      waiting: registration?.waiting?.state ?? null
    };
  });
  expect(workerDiagnostics.active, JSON.stringify(workerDiagnostics)).toBe("activated");
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 15_000 });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Page.enable");
  const appManifest = await cdp.send("Page.getAppManifest");
  expect(appManifest.errors).toEqual([]);
  const installability = await cdp.send("Page.getInstallabilityErrors");
  expect(installability.installabilityErrors).toEqual([]);
  await cdp.detach();

  await page.goto("/settings/notifications");
  const permissionBeforePushSetup = await page.evaluate(() => Notification.permission);
  expect(["default", "denied", "granted"]).toContain(permissionBeforePushSetup);
  await page.getByRole("button", { name: "Attiva notifiche push" }).click();
  await expect(page.getByRole("alert")).toContainText("Web Push non è configurato sul server.");
  expect(await page.evaluate(() => Notification.permission)).toBe(permissionBeforePushSetup);

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
  await expect(page.getByRole("heading", { name: "Oggi", exact: true })).toBeVisible();

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
  await page.getByRole("dialog").getByLabel("Specie").fill("Python regius");
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

test("responsive fixture: create an animal for detail-route coverage", async ({ page }) => {
  test.setTimeout(300_000);
  const pageErrors = [];
  const unexpectedServerErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500 && !isExpectedMissingVapidConfiguration(response)) {
      unexpectedServerErrors.push(response.url() + " " + response.status());
    }
  });

  await signIn(page, owner);
  const animalName = "E2E Responsive Python Regius";
  await page.goto("/animals");
  await page.getByRole("button", { name: "Nuovo animale" }).click();
  await page.getByLabel("Nome").fill(animalName);
  await page.getByRole("dialog").getByLabel("Specie").fill("Python regius");
  await page.getByRole("button", { name: "Salva modifiche" }).click();
  await expect(page.getByText(animalName, { exact: true })).toBeVisible();

  const listResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/animals?page=1&pageSize=25&status=active");
  expect(listResponse.status()).toBe(200);
  const list = await listResponse.json();
  const created = list.animals.find((animal) => animal.name === animalName);
  expect(created?.id).toBeTruthy();

  await page.getByRole("button", { name: new RegExp(animalName) }).click();
  await expect(page).toHaveURL(new RegExp("/animals/" + created.id));
  await expect(page.getByRole("heading", { name: animalName, exact: true })).toBeVisible();
  await expect(page.getByText("Identificativo non inserito")).toBeVisible();
  await expect(page.getByText("Non registrato").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Registra peso" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Registra alimentazione" })).toBeVisible();

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


test("domain CSV imports preview and persist inventory and finance records", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, owner);
  await page.goto("/imports");

  const entitySelect = page.getByLabel("Tipo di dati");
  // Exercise the actual native/custom select interaction instead of assuming
  // its option elements are exposed as ordinary descendants in the DOM.
  for (const entity of [
    "animals", "weights", "sheds", "notes", "feedings", "finance", "inventory",
    "reproductionCycles", "reproductiveEvents", "clutches", "eggs", "incubationLogs", "offspringBatches",
  ]) {
    await entitySelect.selectOption(entity);
  }

  const imports = [
    {
      entity: "inventory",
      filename: "vivarqo-e2e-inventory.csv",
      csv: "name,category,unit,quantityOnHand,minimumQuantity\nE2E Imported Decimal Stock,food,unit,1.005,0.250\n",
      expectedRows: 1,
    },
    {
      entity: "finance",
      filename: "vivarqo-e2e-finance.csv",
      csv: "entryType,occurredOn,amountEUR,category,description\nexpense," + new Date().toISOString().slice(0, 10) + ",9.99,Import E2E,E2E imported expense\n",
      expectedRows: 1,
    },
  ];

  for (const item of imports) {
    await entitySelect.selectOption(item.entity);
    await page.getByLabel("Scegli CSV o XLSX").setInputFiles({
      name: item.filename,
      mimeType: "text/csv",
      buffer: Buffer.from(item.csv, "utf8"),
    });

    const previewPromise = page.waitForResponse((response) =>
      response.url().includes("/api/v1/imports?entity=" + item.entity) &&
      response.request().method() === "POST"
    );
    await page.getByRole("button", { name: "Anteprima" }).click();
    const previewResponse = await previewPromise;
    expect(previewResponse.status()).toBe(201);
    const preview = await previewResponse.json();
    expect(preview.validRows).toBe(item.expectedRows);
    expect(preview.invalidRows).toBe(0);
    expect(preview.missingFields).toEqual([]);

    const confirmPromise = page.waitForResponse((response) =>
      response.url().includes("/api/v1/imports/" + preview.importId + "/confirm") &&
      response.request().method() === "POST"
    );
    await page.getByRole("button", { name: "Conferma importazione" }).click();
    expect((await confirmPromise).status()).toBe(202);

    await expect.poll(async () => {
      const response = await page.context().request.get(
        "http://127.0.0.1:4173/api/v1/imports/" + preview.importId + "?statusOnly=true"
      );
      expect(response.status()).toBe(200);
      return (await response.json()).status;
    }, { timeout: 90_000, intervals: [1000, 2000, 3000] }).toBe("completed");
  }

  const inventoryResponse = await page.context().request.get(
    "http://127.0.0.1:4173/api/v1/inventory/items?page=1&pageSize=25&active=true&q=E2E%20Imported%20Decimal%20Stock"
  );
  expect(inventoryResponse.status()).toBe(200);
  expect((await inventoryResponse.json()).items.some((item) =>
    item.name === "E2E Imported Decimal Stock" && Number(item.quantityOnHand) === 1.005
  )).toBe(true);

  const financeResponse = await page.context().request.get(
    "http://127.0.0.1:4173/api/v1/finance/entries?page=1&pageSize=25&q=E2E%20imported%20expense"
  );
  expect(financeResponse.status()).toBe(200);
  expect((await financeResponse.json()).entries.some((entry) =>
    entry.description === "E2E imported expense" && entry.amountCents === "999"
  )).toBe(true);
});

test("notification preferences persist and empty quiet hours are sent as null", async ({ page }) => {
  await signIn(page, owner);
  await page.goto("/settings/notifications");

  const quietHours = page.locator('input[type="time"]');
  await expect(quietHours).toHaveCount(2);
  await quietHours.nth(0).fill("22:00");
  await quietHours.nth(1).fill("07:00");
  const inAppToggle = page.locator(".toggle-row input[type=checkbox]").first();
  await inAppToggle.uncheck();

  const savePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/notification-preferences") &&
    response.request().method() === "PATCH"
  );
  await page.getByRole("button", { name: "Salva" }).first().click();
  expect((await savePromise).status()).toBe(200);

  const saved = await page.context().request.get("http://127.0.0.1:4173/api/v1/notification-preferences");
  expect(saved.status()).toBe(200);
  expect((await saved.json()).preferences).toMatchObject({
    inAppEnabled: false,
    quietHoursStart: "22:00",
    quietHoursEnd: "07:00",
  });

  await inAppToggle.check();
  await quietHours.nth(0).fill("");
  await quietHours.nth(1).fill("");
  const resetPromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/notification-preferences") &&
    response.request().method() === "PATCH"
  );
  await page.getByRole("button", { name: "Salva" }).first().click();
  expect((await resetPromise).status()).toBe(200);

  const reset = await page.context().request.get("http://127.0.0.1:4173/api/v1/notification-preferences");
  expect((await reset.json()).preferences).toMatchObject({
    inAppEnabled: true,
    quietHoursStart: null,
    quietHoursEnd: null,
  });
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
  await page.getByRole("dialog").getByLabel("Specie").fill("Python regius");
  await page.getByRole("button", { name: "Salva modifiche" }).click();
  await expect(page.getByText(animalName, { exact: true })).toBeVisible();
  const animalsResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/animals?page=1&pageSize=25&status=active");
  expect(animalsResponse.status()).toBe(200);
  const animalsBody = await animalsResponse.json();
  const animal = animalsBody.animals.find((item) => item.name === animalName);
  expect(animal?.id).toBeTruthy();

  await page.goto("/feeding");
  await page.getByRole("button", { name: "Registra sessione" }).first().click();
  const feedingDialog = page.getByRole("dialog");
  await expect(feedingDialog).toBeVisible();
  await feedingDialog.getByRole("checkbox", { name: new RegExp(animalName) }).check();
  await feedingDialog.getByLabel("Esito").selectOption("ate");
  await feedingDialog.getByRole("textbox", { name: "Alimento" }).fill("Rat");
  const feedingCreatedResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().includes("/api/v1/feeding-sessions") && response.status() === 201
  );
  await feedingDialog.getByRole("button", { name: "Registra sessione" }).click();
  await feedingCreatedResponse;
  const feedingResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/feeding-sessions?page=1&pageSize=25");
  expect(feedingResponse.status()).toBe(200);
  const feedingBody = await feedingResponse.json();
  const feedingEntry = feedingBody.sessions.flatMap((session) => session.entries).find((entry) => entry.animal?.name === animalName && entry.outcome === "ate" && entry.foodType === "Rat");
  expect(feedingEntry?.outcome).toBe("ate");
  expect(feedingEntry?.foodType).toBe("Rat");

  await page.getByRole("button", { name: "Modifica" }).click();
  const feedingEditDialog = page.getByRole("dialog");
  await feedingEditDialog.getByLabel("Esito").selectOption("refused");
  const feedingUpdatedResponse = page.waitForResponse((response) =>
    response.request().method() === "PATCH" &&
    response.url().includes("/api/v1/feeding-entries/" + feedingEntry.id) &&
    response.status() === 200
  );
  await feedingEditDialog.getByRole("button", { name: "Salva modifiche" }).click();
  await feedingUpdatedResponse;
  const editedFeedings = await page.context().request.get("http://127.0.0.1:4173/api/v1/feeding-sessions?page=1&pageSize=25");
  const editedEntry = (await editedFeedings.json()).sessions.flatMap((session) => session.entries).find((entry) => entry.id === feedingEntry?.id);
  expect(editedEntry?.outcome).toBe("refused");

  page.once("dialog", (dialog) => dialog.accept());
  const feedingDeletedResponse = page.waitForResponse((response) =>
    response.request().method() === "DELETE" &&
    response.url().includes("/api/v1/feeding-entries/" + feedingEntry.id) &&
    response.status() === 204
  );
  await page.getByRole("button", { name: "Elimina" }).click();
  await feedingDeletedResponse;
  const deletedFeedings = await page.context().request.get("http://127.0.0.1:4173/api/v1/feeding-sessions?page=1&pageSize=25");
  expect((await deletedFeedings.json()).sessions.flatMap((session) => session.entries).some((entry) => entry.id === feedingEntry.id)).toBe(false);

  await page.goto("/tasks?create=1");
  const taskDialog = page.getByRole("dialog");
  await taskDialog.getByLabel("Titolo attività").fill("E2E Task follow-up");
  await taskDialog.getByLabel("Cerca scheda animale").fill(animalName);
  await taskDialog.getByRole("combobox", { name: "Scheda animale" }).selectOption(animal.id);
  const taskCreatedResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    response.url().endsWith("/api/v1/tasks") &&
    response.status() === 201
  );
  await taskDialog.getByRole("button", { name: "Salva modifiche" }).click();
  await taskCreatedResponse;
  const tasksResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/tasks?page=1&pageSize=25&status=open");
  expect(tasksResponse.status()).toBe(200);
  const tasksBody = await tasksResponse.json();
  const task = tasksBody.tasks.find((item) => item.title === "E2E Task follow-up");
  expect(task?.id).toBeTruthy();
  const taskCompletedResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    response.url().includes("/api/v1/tasks/" + task.id + "/complete") &&
    response.status() === 200
  );
  await page.getByRole("button", { name: "Completata" }).click();
  await taskCompletedResponse;
  const completedTasksResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/tasks?page=1&pageSize=25&status=completed");
  expect((await completedTasksResponse.json()).tasks.some((item) => item.id === task.id && item.status === "completed")).toBe(true);

  await page.goto("/finance");
  await expect(page.locator(".table-wrap thead th").nth(2)).toHaveText("Tipo");
  await page.getByRole("button", { name: "Nuova voce" }).click();
  const financeDialog = page.getByRole("dialog");
  await expect(financeDialog.getByLabel("Tipo")).toBeVisible();
  await expect(financeDialog.getByLabel("Categoria", { exact: true })).toBeVisible();
  await financeDialog.getByLabel("Importo (€)").fill("12.50");
  await financeDialog.getByLabel("Valuta").fill("EUR");
  await financeDialog.getByLabel("Categoria", { exact: true }).fill("Test E2E");
  await financeDialog.getByLabel("Descrizione").fill("E2E veterinary expense");
  await financeDialog.getByRole("combobox", { name: "Scheda animale" }).selectOption(animal.id);
  const financeCreatedResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    response.url().endsWith("/api/v1/finance/entries") &&
    response.status() === 201
  );
  await financeDialog.getByRole("button", { name: "Salva modifiche" }).click();
  await financeCreatedResponse;
  const financeResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/finance/entries?page=1&pageSize=25");
  expect(financeResponse.status()).toBe(200);
  const financeBody = await financeResponse.json();
  expect(financeBody.entries.some((entry) => entry.description === "E2E veterinary expense" && entry.amountCents === "1250")).toBe(true);

  await page.goto("/inventory");
  await page.getByRole("button", { name: "Nuovo articolo" }).click();
  const inventoryDialog = page.getByRole("dialog");
  await inventoryDialog.getByLabel("Nome articolo").fill("E2E Food Stock");
  await inventoryDialog.getByLabel("Categoria").selectOption("food");
  await inventoryDialog.getByLabel("Unità").fill("kg");
  await inventoryDialog.getByLabel("Giacenza").fill("2");
  await inventoryDialog.getByLabel("Scorta minima").fill("1");
  const inventoryCreatedResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    response.url().endsWith("/api/v1/inventory/items") &&
    response.status() === 201
  );
  await inventoryDialog.getByRole("button", { name: "Salva modifiche" }).click();
  await inventoryCreatedResponse;
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
  const movementCreatedResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    response.url().includes("/api/v1/inventory/items/" + stockItem.id + "/movements") &&
    response.status() === 201
  );
  await page.getByRole("button", { name: "Registra movimento" }).click();
  await movementCreatedResponse;
  const movementsResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/inventory/items/" + stockItem.id + "/movements?page=1&pageSize=100");
  expect(movementsResponse.status()).toBe(200);
  const movementsBody = await movementsResponse.json();
  expect(movementsBody.movements.some((movement) => movement.movementType === "in" && Number(movement.quantity) === 1)).toBe(true);

  page.once("dialog", (dialog) => dialog.accept());
  const itemArchivedResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    response.url().includes("/api/v1/inventory/items/" + stockItem.id + "/archive") &&
    response.status() === 200
  );
  await page.getByRole("button", { name: "Archivia" }).last().click();
  await itemArchivedResponse;
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
    await page.getByRole("dialog").getByLabel("Specie").fill("Python regius");
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
  await page.getByRole("button", { name: "Nuovo ciclo" }).first().click();
  const cycleDialog = page.getByRole("dialog");
  await cycleDialog.getByLabel("Nome ciclo").fill("E2E Breeding Cycle");
  await cycleDialog.getByLabel("Cerca genitore a").fill(parentNames[0]);
  await cycleDialog.getByRole("combobox", { name: "Genitore A" }).selectOption(parentA.id);
  await cycleDialog.getByLabel("Cerca genitore b").fill(parentNames[1]);
  await cycleDialog.getByRole("combobox", { name: "Genitore B" }).selectOption(parentB.id);
  const cycleCreatePromise = page.waitForResponse((response) =>
    response.url().includes("/api/v1/reproduction-cycles") && response.request().method() === "POST"
  );
  await cycleDialog.getByRole("button", { name: "Salva modifiche" }).click();
  const cycleCreateResponse = await cycleCreatePromise;
  expect(cycleCreateResponse.status()).toBe(201);
  const createdCycle = (await cycleCreateResponse.json()).cycle;
  expect(createdCycle?.id).toBeTruthy();
  // The cycles list is paginated and sorted by start date; inspect the created ID directly.
  let cycleDetailResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/reproduction-cycles/" + createdCycle.id);
  expect(cycleDetailResponse.status()).toBe(200);
  const cycle = (await cycleDetailResponse.json()).cycle;
  expect(cycle.name).toBe("E2E Breeding Cycle");

  await page.goto("/reproduction-cycles/" + cycle.id);
  await page.getByRole("button", { name: "Registra evento" }).first().click();
  const eventDialog = page.getByRole("dialog");
  await eventDialog.getByLabel("Tipo evento").selectOption("pairing");
  await eventDialog.getByLabel("Cerca scheda animale").fill(parentNames[0]);
  await eventDialog.getByRole("combobox", { name: "Scheda animale" }).selectOption(parentA.id);
  const eventCreatedResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    response.url().includes("/api/v1/reproduction-cycles/" + cycle.id + "/events") &&
    response.status() === 201
  );
  await eventDialog.getByRole("button", { name: "Salva modifiche" }).click();
  await eventCreatedResponse;
  cycleDetailResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/reproduction-cycles/" + cycle.id);
  expect((await cycleDetailResponse.json()).cycle.events.some((event) => event.eventType === "pairing")).toBe(true);

  await page.getByRole("button", { name: "Covate" }).click();
  await page.getByRole("button", { name: "Aggiungi covata" }).click();
  const clutchDialog = page.getByRole("dialog");
  await clutchDialog.getByLabel("Deposizione").fill("2026-11-01");
  await clutchDialog.getByLabel("Numero uova").fill("2");
  await clutchDialog.getByLabel("Stato").fill("incubating");
  await clutchDialog.getByLabel("Incubatore").fill("E2E Incubator");
  const clutchCreatedResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().includes("/api/v1/clutches") && response.status() === 201
  );
  await clutchDialog.getByRole("button", { name: "Salva modifiche" }).click();
  await clutchCreatedResponse;
  cycleDetailResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/reproduction-cycles/" + cycle.id);
  const clutch = (await cycleDetailResponse.json()).cycle.clutches.find((item) => item.incubatorLabel === "E2E Incubator");
  expect(clutch?.id).toBeTruthy();

  await page.goto("/clutches/" + clutch.id);
  await page.getByRole("button", { name: "Registra uova" }).click();
  const eggsDialog = page.getByRole("dialog");
  await eggsDialog.getByLabel("Codice uovo").fill("E2E-EGG-01\nE2E-EGG-02");
  const eggsCreatedResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    response.url().includes("/api/v1/clutches/" + clutch.id + "/eggs") &&
    response.status() === 201
  );
  await eggsDialog.getByRole("button", { name: "Salva modifiche" }).click();
  await eggsCreatedResponse;
  let clutchResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/clutches/" + clutch.id);
  expect((await clutchResponse.json()).clutch.eggs.length).toBe(2);

  await page.getByRole("button", { name: "Aggiungi misurazione" }).first().click();
  const incubationDialog = page.getByRole("dialog");
  await incubationDialog.getByLabel("Temperatura (°C)").fill("31");
  await incubationDialog.getByLabel("Umidità (%)").fill("70");
  const incubationCreatedResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    response.url().includes("/api/v1/clutches/" + clutch.id + "/incubation-logs") &&
    response.status() === 201
  );
  await incubationDialog.getByRole("button", { name: "Salva modifiche" }).click();
  await incubationCreatedResponse;
  clutchResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/clutches/" + clutch.id);
  const clutchDetail = (await clutchResponse.json()).clutch;
  expect(clutchDetail.incubationLogs.some((log) => Number(log.temperatureC) === 31 && Number(log.humidityPct) === 70)).toBe(true);

  await page.goto("/reproduction-cycles/" + cycle.id);
  await page.getByRole("button", { name: "Nascite" }).click();
  await page.getByRole("button", { name: "Registra nascita" }).first().click();
  const offspringDialog = page.getByRole("dialog");
  await offspringDialog.getByLabel("Data nascita").fill("2026-11-02");
  await offspringDialog.getByLabel("Covate").selectOption(clutch.id);
  await offspringDialog.getByLabel("Numero piccoli").fill("2");
  const offspringCreatedResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    response.url().endsWith("/api/v1/offspring-batches") &&
    response.status() === 201
  );
  await offspringDialog.getByRole("button", { name: "Salva modifiche" }).click();
  await offspringCreatedResponse;
  cycleDetailResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/reproduction-cycles/" + cycle.id);
  const cycleAfterBirth = (await cycleDetailResponse.json()).cycle;
  const batch = cycleAfterBirth.offspringBatches.find((item) => Number(item.count) === 2);
  expect(batch?.id).toBeTruthy();

  // Open the per-batch conversion form before filling its fields.
  await page.getByRole("button", { name: "Crea schede animali" }).click();
  const conversionDialog = page.getByRole("dialog");
  await expect(conversionDialog).toBeVisible();
  await conversionDialog.getByLabel("Specie").fill("Python regius");
  await conversionDialog.getByLabel("Nome 1").fill("E2E Baby 1");
  await conversionDialog.getByRole("button", { name: "Aggiungi un nome" }).click();
  await conversionDialog.getByLabel("Nome 2").fill("E2E Baby 2");
  const conversionResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/v1/offspring-batches/" + batch.id + "/animals") &&
    response.request().method() === "POST" &&
    response.status() === 201
  );
  await conversionDialog.getByRole("button", { name: "Crea schede animali" }).click();
  const babiesResponse = await conversionResponsePromise;
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
  await page.getByRole("dialog").getByLabel("Specie").fill("Python regius");
  const createAnimalResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/animals") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Salva modifiche" }).click();
  const createAnimalResponse = await createAnimalResponsePromise;
  expect(createAnimalResponse.status()).toBe(201);
  const animal = (await createAnimalResponse.json()).animal;
  expect(animal?.id).toBeTruthy();
  await expect(page.getByText(animalName, { exact: true })).toBeVisible();

  await page.goto("/documents");
  await page.getByRole("button", { name: "Carica documento" }).first().click();
  await page.getByLabel("File").setInputFiles({
    name: "e2e-veterinary-record.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF", "utf8")
  });
  const uploadDialog = page.getByRole("dialog");
  await uploadDialog.getByLabel("Categoria").fill("Veterinario");
  await uploadDialog.getByRole("combobox", { name: "Scheda animale" }).selectOption(animal.id);
  const uploadResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/v1/documents") && response.request().method() === "POST"
  );
  await uploadDialog.getByRole("button", { name: "Carica documento" }).click();
  const uploadResponse = await uploadResponsePromise;
  expect(uploadResponse.status()).toBe(201);
  await expect(page.getByText("e2e-veterinary-record.pdf", { exact: true })).toBeVisible();

  const documentsResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/documents?page=1&pageSize=25&animalId=" + animal.id);
  expect(documentsResponse.status()).toBe(200);
  const document = (await documentsResponse.json()).documents.find((item) => item.originalFilename === "e2e-veterinary-record.pdf");
  expect(document?.id).toBeTruthy();

  await page.getByRole("button", { name: "Modifica" }).click();
  const documentEditDialog = page.getByRole("dialog");
  await documentEditDialog.getByLabel("Categoria").fill("Clinico");
  const documentUpdatedResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/documents/" + document.id) &&
    response.request().method() === "PATCH" &&
    response.status() === 200
  );
  await documentEditDialog.getByRole("button", { name: "Salva modifiche" }).click();
  await documentUpdatedResponsePromise;
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
  const deleteDocumentResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/v1/documents/" + document.id) &&
    response.request().method() === "DELETE" &&
    response.status() === 202
  );
  await page.getByRole("button", { name: "Elimina" }).click();
  await deleteDocumentResponsePromise;
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

  const preferenceForm = page.locator(".settings-grid form").nth(1);
  await preferenceForm.getByLabel("Tema").selectOption("dark");
  const darkThemeResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/account/preferences") && response.request().method() === "PATCH"
  );
  await preferenceForm.getByRole("button", { name: "Salva modifiche" }).click();
  expect((await darkThemeResponse).status()).toBe(200);
  await expect.poll(() => page.locator("html").getAttribute("data-theme")).toBe("dark");

  await preferenceForm.locator("select").nth(2).selectOption("kg");
  await preferenceForm.locator("select").nth(3).selectOption("f");
  await preferenceForm.locator("select").nth(4).selectOption("dd/MM/yyyy");
  await preferenceForm.locator("select").nth(5).selectOption("animals");
  await preferenceForm.getByLabel("Tabelle compatte").check();
  const advancedPreferencesPromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/account/preferences") && response.request().method() === "PATCH"
  );
  await preferenceForm.getByRole("button", { name: "Salva modifiche" }).click();
  expect((await advancedPreferencesPromise).status()).toBe(200);
  const advancedPreferencesResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/account/preferences");
  expect((await advancedPreferencesResponse.json()).preferences).toMatchObject({
    weightUnit: "kg", temperatureUnit: "f", dateFormat: "dd/MM/yyyy",
    defaultLandingPage: "animals", compactTables: true, theme: "dark"
  });

  await preferenceForm.locator("select").nth(2).selectOption("g");
  await preferenceForm.locator("select").nth(3).selectOption("c");
  await preferenceForm.locator("select").nth(4).selectOption("locale");
  await preferenceForm.locator("select").nth(5).selectOption("today");
  await preferenceForm.getByLabel("Tabelle compatte").uncheck();
  const restorePreferencesPromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/account/preferences") && response.request().method() === "PATCH"
  );
  await preferenceForm.getByRole("button", { name: "Salva modifiche" }).click();
  expect((await restorePreferencesPromise).status()).toBe(200);

  await page.emulateMedia({ colorScheme: "dark" });
  await preferenceForm.getByLabel("Tema").selectOption("system");
  const systemThemeResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/account/preferences") && response.request().method() === "PATCH"
  );
  await preferenceForm.getByRole("button", { name: "Salva modifiche" }).click();
  expect((await systemThemeResponse).status()).toBe(200);
  await expect.poll(() => page.locator("html").getAttribute("data-theme")).toBe("dark");

  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => page.locator("html").getAttribute("data-theme")).toBe("light");
  await page.reload();
  await expect.poll(() => page.locator("html").getAttribute("data-theme")).toBe("light");
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


// Each viewport is its own Playwright test. A failure on one device cannot suppress
// diagnostics and screenshots for the other four. A failing route is recorded and the
// remaining paths at that viewport are still exercised.
const responsiveViewports = [
  { name: "desktop-1440x900", width: 1440, height: 900 },
  { name: "laptop-1280x800", width: 1280, height: 800 },
  { name: "tablet-1024x768", width: 1024, height: 768 },
  { name: "mobile-390x844", width: 390, height: 844 },
  { name: "mobile-320x700", width: 320, height: 700 }
];
const responsiveRoutes = [
  "today", "animals", "feeding", "feeding?create=1", "tasks", "calendar",
  "reproduction", "clutches", "inventory", "documents", "finance", "settings",
  "settings/notifications", "notifications", "billing", "imports", "exports"
];

for (const viewport of responsiveViewports) {
  test("responsive viewport " + viewport.name, async ({ page }) => {
    test.setTimeout(240_000);
    await signIn(page, owner);
    const animalResponse = await page.context().request.get("http://127.0.0.1:4173/api/v1/animals?page=1&pageSize=1&status=all");
    const firstAnimal = (await animalResponse.json()).animals?.[0];
    const routes = firstAnimal ? ["animals/" + firstAnimal.id, ...responsiveRoutes] : responsiveRoutes;
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const failures = [];
    for (const route of routes) {
      try {
        if (route === "feeding?create=1") {
          await page.goto("/feeding");
          await page.getByRole("button", { name: "Registra sessione" }).first().click();
        } else {
          await page.goto("/" + route);
        }
        await expect(route.startsWith("animals/") ? page.locator(".animal-hero h1") : page.locator(".page-header h1").first()).toBeVisible({ timeout: 10_000 });
        if (route === "feeding?create=1") {
          const dialog = page.getByRole("dialog");
          await expect(dialog).toBeVisible();
          const dialogLayout = await dialog.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const content = element.querySelector(".modal-content");
            const formGrid = element.querySelector(".form-grid");
            return {
              height: rect.height,
              viewportHeight: document.documentElement.clientHeight,
              contentOverflowY: content ? getComputedStyle(content).overflowY : "",
              gridColumns: formGrid ? getComputedStyle(formGrid).gridTemplateColumns.split(" ").length : 0
            };
          });
          expect(dialogLayout.height).toBeLessThanOrEqual(dialogLayout.viewportHeight + 1);
          expect(["auto", "scroll"]).toContain(dialogLayout.contentOverflowY);
          if (viewport.width <= 760) expect(dialogLayout.gridColumns).toBe(1);
          const submit = dialog.getByRole("button", { name: "Registra sessione" }).last();
          const submitSize = await submit.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return { width: rect.width, height: rect.height };
          });
          expect(submitSize.height).toBeGreaterThanOrEqual(44);
        }

        if (route === "inventory") {
          const movementAction = page.getByRole("button", { name: "Movimenti" }).first();
          if (await movementAction.count()) {
            await movementAction.click();
            const movementDialog = page.getByRole("dialog");
            const movementTable = movementDialog.locator('.table-wrap[data-mobile-layout="scroll"]');
            await expect(movementTable).toBeVisible();
            if (viewport.width <= 760) {
              const tableLayout = await movementTable.evaluate((wrapper) => ({
                overflowX: getComputedStyle(wrapper).overflowX,
                tableDisplay: getComputedStyle(wrapper.querySelector("table")).display
              }));
              expect(tableLayout.overflowX).toBe("auto");
              expect(tableLayout.tableDisplay).toBe("table");
            }
            await movementDialog.getByRole("button", { name: "Chiudi" }).click();
          }
        }

        if (route === "animals" || route === "finance") {
          const table = page.locator(".table-wrap .data-table");
          await expect(table).toBeVisible({ timeout: 10_000 });
          await expect.poll(() => page.locator(".table-wrap").evaluate((wrapper) =>
            (wrapper.scrollWidth > wrapper.clientWidth + 2) === (wrapper.getAttribute("data-overflow") === "true")
          )).toBe(true);

          if (route === "animals") {
            await page.getByRole("combobox", { name: "Stato" }).selectOption("all");
            await expect.poll(() => page.locator(".table-wrap tbody tr:not(.data-table-empty)").count()).toBeGreaterThan(0);
          }

          const tableLayout = await page.locator(".table-wrap").evaluate((wrapper) => {
            const tableElement = wrapper.querySelector("table");
            const firstRow = wrapper.querySelector("tbody tr:not(.data-table-empty)");
            return {
              overflow: wrapper.getAttribute("data-overflow"),
              wrapperTabIndex: wrapper.tabIndex,
              tableDisplay: tableElement ? getComputedStyle(tableElement).display : "",
              rowDisplay: firstRow ? getComputedStyle(firstRow).display : "",
              labels: Array.from(firstRow?.querySelectorAll("td[data-label]") ?? []).map((cell) => ({
                label: cell.getAttribute("data-label"),
                visualLabel: getComputedStyle(cell, "::before").content
              }))
            };
          });

          if (viewport.width <= 760) {
            expect(tableLayout.tableDisplay, "mobile tables must use the card layout").toBe("block");
            expect(tableLayout.rowDisplay, "each table row must be a card").toBe("grid");
            expect(tableLayout.labels.length, "each mobile cell must expose its column label").toBeGreaterThan(0);
            expect(tableLayout.labels.every((cell) => cell.label && cell.visualLabel.includes(cell.label))).toBe(true);

            const actionButtons = page.locator(".table-wrap .row-actions button");
            for (let index = 0; index < await actionButtons.count(); index += 1) {
              const button = actionButtons.nth(index);
              await expect(button).toBeVisible();
              // Center each action in the usable viewport. scrollIntoViewIfNeeded()
              // considers viewport intersection but does not account for fixed overlays.
              await button.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }));
              const hitTarget = await button.evaluate((element) => {
                const rect = element.getBoundingClientRect();
                const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                const bottomNav = document.querySelector(".mobile-bottom-nav");
                const bottomNavTop = bottomNav?.getBoundingClientRect().top ?? document.documentElement.clientHeight;
                return {
                  width: rect.width,
                  height: rect.height,
                  insideViewport: rect.left >= 0 && rect.right <= document.documentElement.clientWidth,
                  aboveBottomNavigation: rect.bottom <= bottomNavTop + 1,
                  receivesPointer: Boolean(hit && (hit === element || element.contains(hit))),
                  coveredBy: hit && hit !== element && !element.contains(hit)
                    ? { tag: hit.tagName, className: typeof hit.className === "string" ? hit.className : "", ariaLabel: hit.getAttribute("aria-label") }
                    : null
                };
              });
              expect(hitTarget.width, "table action target width").toBeGreaterThanOrEqual(44);
              expect(hitTarget.height, "table action target height").toBeGreaterThanOrEqual(44);
              expect(hitTarget.insideViewport, "table action must stay within the viewport").toBe(true);
              expect(hitTarget.aboveBottomNavigation, "table action must be in the unobstructed area above the bottom navigation").toBe(true);
              expect(hitTarget.receivesPointer, `table action must receive pointer events; covered by ${JSON.stringify(hitTarget.coveredBy)}`).toBe(true);
            }
          } else if (tableLayout.overflow === "true") {
            await expect(page.locator(".table-scroll-hint")).toBeVisible();
            expect(tableLayout.wrapperTabIndex).toBe(0);
          }

          if (route === "animals" && viewport.width === 1024) {
            expect(tableLayout.overflow).toBe("true");
            await expect(page.locator(".table-scroll-hint")).toBeVisible();
          }
        }

        if (viewport.width <= 760) {
          const bottomNav = page.locator(".mobile-bottom-nav");
          await expect(bottomNav).toBeVisible();
          const navButtons = bottomNav.locator("button");
          const navGeometry = await navButtons.evaluateAll((buttons) => buttons.map((button) => {
            const rect = button.getBoundingClientRect();
            const label = button.querySelector("span:last-child");
            return {
              left: rect.left,
              right: rect.right,
              width: rect.width,
              height: rect.height,
              text: label?.textContent?.trim() ?? "",
              accessibleName: button.getAttribute("aria-label")
            };
          }));
          expect(navGeometry).toHaveLength(5);
          for (const item of navGeometry) {
            expect(item.width, "bottom navigation hit target width").toBeGreaterThanOrEqual(44);
            expect(item.height, "bottom navigation hit target height").toBeGreaterThanOrEqual(44);
            expect(item.text.length, "bottom navigation label must remain present").toBeGreaterThan(0);
            expect(item.accessibleName, "bottom navigation must have an accessible full label").toBeTruthy();
          }
          for (let index = 1; index < navGeometry.length; index += 1) {
            expect(navGeometry[index - 1].right, "bottom navigation buttons must not overlap").toBeLessThanOrEqual(navGeometry[index].left + 1);
          }
          const bottomPadding = await page.locator(".main-column").evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingBottom));
          const navHeight = await bottomNav.evaluate((element) => element.getBoundingClientRect().height);
          expect(bottomPadding, "page content must clear the fixed bottom navigation").toBeGreaterThanOrEqual(navHeight);
        }

        const dimensions = await page.evaluate(() => ({
          viewport: document.documentElement.clientWidth,
          document: document.documentElement.scrollWidth
        }));
        const folder = path.join("test-results", "responsive", viewport.name);
        await mkdir(folder, { recursive: true });
        await page.screenshot({
          path: path.join(folder, route.replaceAll("/", "-").replaceAll("?", "-").replaceAll("=", "-") + ".png"),
          fullPage: true
        });
        expect(dimensions.document, "horizontal overflow on /" + route)
          .toBeLessThanOrEqual(dimensions.viewport + 1);
      } catch (error) {
        failures.push("/" + route + ": " + (error instanceof Error ? error.message : String(error)));
      }
    }
    expect(failures, "responsive failures at " + viewport.name + "; all routes were visited").toEqual([]);
  });
}
