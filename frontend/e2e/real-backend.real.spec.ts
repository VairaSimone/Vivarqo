import { test, expect } from "@playwright/test";

const appOrigin = "http://127.0.0.1:5173";
const ownerEmail = "e2e-owner@vivarqo.test";
const otherEmail = "e2e-other@vivarqo.test";
const password = "Vivarqo-CI-Only-Password-2026!";

async function signIn(page: import('@playwright/test').Page, email: string): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Accedi a Vivarqo" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Accedi", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
}

test("browser, real API and PostgreSQL enforce account isolation", async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();

  try {
    await signIn(ownerPage, ownerEmail);
    await ownerPage.goto("/animals");
    await expect(ownerPage.getByRole("heading", { name: "Animali", exact: true }).first()).toBeVisible();
    await ownerPage.getByRole("button", { name: /Nuovo animale/ }).click();

    const animalName = "Real PostgreSQL E2E Boa";
    const form = ownerPage.locator(".embedded-form form").first();
    await form.getByLabel("Nome", { exact: true }).fill(animalName);
    await form.getByLabel("Specie", { exact: true }).fill("Boa constrictor imperator");
    await ownerPage.getByLabel("Identificativo", { exact: true }).fill("VRQ-REAL-E2E-001");
    await ownerPage.getByRole("button", { name: "Salva scheda", exact: true }).click();
    await expect(ownerPage.getByRole("heading", { name: animalName })).toBeVisible();

    const ownerListResponse = await ownerPage.request.get(
      appOrigin + "/api/v1/animals?status=all&page=1&pageSize=100"
    );
    expect(ownerListResponse.status()).toBe(200);
    const ownerList = await ownerListResponse.json() as { animals: Array<{ id: string; name: string }> };
    const animal = ownerList.animals.find((item) => item.name === animalName);
    expect(animal?.id).toBeTruthy();

    await signIn(otherPage, otherEmail);
    await otherPage.goto("/animals");
    await expect(otherPage.getByRole("heading", { name: "Animali", exact: true }).first()).toBeVisible();

    const otherListResponse = await otherPage.request.get(
      appOrigin + "/api/v1/animals?status=all&page=1&pageSize=100"
    );
    expect(otherListResponse.status()).toBe(200);
    const otherList = await otherListResponse.json() as { animals: Array<{ id: string; name: string }> };
    expect(otherList.animals.some((item) => item.id === animal.id)).toBe(false);
    expect(otherList.animals.some((item) => item.name === animalName)).toBe(false);

    const csrfResponse = await otherPage.request.get(appOrigin + "/api/v1/auth/csrf");
    expect(csrfResponse.status()).toBe(200);
    const { csrfToken } = await csrfResponse.json();
    expect(typeof csrfToken).toBe("string");

    const foreignRead = await otherPage.request.get(appOrigin + "/api/v1/animals/" + animal.id);
    expect(foreignRead.status()).toBe(404);

    const foreignWrite = await otherPage.request.patch(appOrigin + "/api/v1/animals/" + animal.id, {
      headers: { Origin: appOrigin, "X-CSRF-Token": csrfToken },
      data: { notes: "unauthorized write must never persist" },
    });
    expect(foreignWrite.status()).toBe(404);

    const foreignCareWrite = await otherPage.request.post(
      appOrigin + "/api/v1/animals/" + animal.id + "/weights",
      {
        headers: { Origin: appOrigin, "X-CSRF-Token": csrfToken },
        data: { measuredAt: "2026-10-30T10:00:00.000Z", weightG: 250 },
      }
    );
    expect(foreignCareWrite.status()).toBe(404);

    const foreignDelete = await otherPage.request.delete(appOrigin + "/api/v1/animals/" + animal.id, {
      headers: { Origin: appOrigin, "X-CSRF-Token": csrfToken },
    });
    expect(foreignDelete.status()).toBe(404);

    const ownerStillHasAnimal = await ownerPage.request.get(appOrigin + "/api/v1/animals/" + animal.id);
    expect(ownerStillHasAnimal.status()).toBe(200);
    const ownerDetail = await ownerStillHasAnimal.json();
    expect(ownerDetail.animal.name).toBe(animalName);
    expect(ownerDetail.animal.notes).not.toBe("unauthorized write must never persist");
  } finally {
    await otherContext.close();
    await ownerContext.close();
  }
});
