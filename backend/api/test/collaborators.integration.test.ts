import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import type { EmailSender, TransactionalEmail } from "../src/modules/auth/email-sender.js";

const enabled = process.env.RUN_DB_INTEGRATION === "true";
const origin = "http://localhost:5173";
const password = "Correct-Horse-Battery-42!";
const userIds: string[] = [];
const premiumOwners = new Set<string>();
const sentEmails: TransactionalEmail[] = [];
const sender: EmailSender = { send: async (message) => { sentEmails.push(message); } };

describe.skipIf(!enabled)("Premium workspace collaboration PostgreSQL integration", () => {
  let app: Express;

  beforeAll(() => {
    app = createApp({
      checkDatabase: async () => undefined,
      emailSender: sender,
      premiumEntitlement: async (ownerUserId) => premiumOwners.has(ownerUserId),
    });
  });

  afterAll(async () => {
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function account(emailPrefix: string, categories: string[] = ["reptiles"]) {
    const email = `${emailPrefix}-${randomUUID()}@example.com`;
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 }),
        displayName: emailPrefix,
        emailVerifiedAt: new Date(),
        accountConfiguration: { create: { animalCategories: categories } },
      },
    });
    userIds.push(user.id);
    const agent = request.agent(app);
    const csrf = (await agent.get("/api/v1/auth/csrf").expect(200)).body.csrfToken as string;
    await agent.post("/api/v1/auth/login").set("Origin", origin).set("X-CSRF-Token", csrf).send({ email, password }).expect(200);
    return { id: user.id, email, agent, csrf };
  }

  function mutation(user: Awaited<ReturnType<typeof account>>) {
    return { agent: user.agent, csrf: user.csrf, origin };
  }

  async function createAnimal(user: Awaited<ReturnType<typeof account>>, name: string) {
    const response = await user.agent.post("/api/v1/animals")
      .set("Origin", origin).set("X-CSRF-Token", user.csrf)
      .send({ name, species: "Python regius", sex: "female" }).expect(201);
    return response.body.animal as { id: string; name: string };
  }

  function invitationToken(): string {
    const message = sentEmails.at(-1);
    const href = message?.html.match(/href="([^"]+)"/)?.[1];
    if (!href) throw new Error("Invitation email did not contain an acceptance URL");
    const token = new URLSearchParams(new URL(href).hash.slice(1)).get("invite");
    if (!token) throw new Error("Invitation URL did not contain a token");
    return token;
  }

  it("requires Premium before sending a collaborator invitation", async () => {
    const freeOwner = await account("free-owner");
    const response = await freeOwner.agent.post("/api/v1/collaborators/invitations")
      .set("Origin", origin).set("X-CSRF-Token", freeOwner.csrf)
      .send({ email: `invite-${randomUUID()}@example.com`, role: "viewer" });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("PREMIUM_REQUIRED");
  });

  it("accepts email-bound invitations, switches workspace and enforces role permissions and revocation", async () => {
    const owner = await account("workspace-owner");
    const collaborator = await account("workspace-collaborator");
    const outsider = await account("workspace-outsider");
    premiumOwners.add(owner.id);
    const animal = await createAnimal(owner, "Shared animal");

    await owner.agent.post("/api/v1/collaborators/invitations")
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({ email: collaborator.email, role: "viewer" }).expect(201);
    const token = invitationToken();

    await outsider.agent.post("/api/v1/collaborators/accept")
      .set("Origin", origin).set("X-CSRF-Token", outsider.csrf)
      .send({ token }).expect(403);
    await collaborator.agent.post("/api/v1/collaborators/accept")
      .set("Origin", origin).set("X-CSRF-Token", collaborator.csrf)
      .send({ token }).expect(200);

    const membership = await prisma.workspaceMembership.findUniqueOrThrow({
      where: { ownerUserId_collaboratorUserId: { ownerUserId: owner.id, collaboratorUserId: collaborator.id } },
    });
    expect(membership.role).toBe("viewer");

    await collaborator.agent.post("/api/v1/collaborators/active-workspace")
      .set("Origin", origin).set("X-CSRF-Token", collaborator.csrf)
      .send({ ownerUserId: owner.id }).expect(200);

    const sharedAnimals = await collaborator.agent.get("/api/v1/animals").expect(200);
    expect(sharedAnimals.body.animals.map((item: { id: string }) => item.id)).toContain(animal.id);
    await collaborator.agent.post("/api/v1/animals")
      .set("Origin", origin).set("X-CSRF-Token", collaborator.csrf)
      .send({ name: "Not allowed", species: "Python regius" }).expect(403);

    const outsiderAnimals = await outsider.agent.get("/api/v1/animals").expect(200);
    expect(outsiderAnimals.body.animals.map((item: { id: string }) => item.id)).not.toContain(animal.id);

    await owner.agent.patch(`/api/v1/collaborators/${membership.id}`)
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({ role: "operator" }).expect(200);

    await collaborator.agent.post("/api/v1/animals")
      .set("Origin", origin).set("X-CSRF-Token", collaborator.csrf)
      .send({ name: "Operator animal", species: "Python regius" }).expect(201);
    await collaborator.agent.get("/api/v1/finance/entries").expect(403);

    await owner.agent.delete(`/api/v1/collaborators/${membership.id}`)
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf).expect(204);
    const session = await prisma.userSession.findFirst({ where: { userId: collaborator.id }, select: { activeWorkspaceOwnerId: true } });
    expect(session?.activeWorkspaceOwnerId).toBeNull();
    const afterRevocation = await collaborator.agent.get("/api/v1/animals").expect(200);
    expect(afterRevocation.body.animals.map((item: { id: string }) => item.id)).not.toContain(animal.id);
  });

  it("uses the owner's enabled animal domains inside a shared workspace", async () => {
    const owner = await account("multi-domain-owner", ["fish", "birds", "dogs_cats"]);
    const collaborator = await account("reptile-only-collaborator", ["reptiles"]);
    premiumOwners.add(owner.id);
    const aquarium = await owner.agent.post("/api/v1/aquariums")
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({ name: "Shared aquarium", waterType: "freshwater", volumeLiters: 80 }).expect(201);
    await owner.agent.post("/api/v1/collaborators/invitations")
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({ email: collaborator.email, role: "operator" }).expect(201);
    await collaborator.agent.post("/api/v1/collaborators/accept")
      .set("Origin", origin).set("X-CSRF-Token", collaborator.csrf)
      .send({ token: invitationToken() }).expect(200);
    await collaborator.agent.post("/api/v1/collaborators/active-workspace")
      .set("Origin", origin).set("X-CSRF-Token", collaborator.csrf)
      .send({ ownerUserId: owner.id }).expect(200);

    await collaborator.agent.get("/api/v1/aquariums").expect(200).expect((res) => {
      expect(res.body.aquariums.map((item: { id: string }) => item.id)).toContain(aquarium.body.aquarium.id);
    });
    const context = await collaborator.agent.get("/api/v1/collaborators/context").expect(200);
    expect(context.body.categories).toEqual(["fish", "birds", "dogs_cats"]);
    expect(context.body.activeWorkspaceOwnerId).toBe(owner.id);
    await collaborator.agent.post("/api/v1/aquariums")
      .set("Origin", origin).set("X-CSRF-Token", collaborator.csrf)
      .send({ name: "Operator aquarium", waterType: "freshwater", volumeLiters: 40 }).expect(201);
  });

  it("does not allow workspace access after the owner's Premium entitlement is lost", async () => {
    const owner = await account("downgraded-owner");
    const collaborator = await account("downgraded-collaborator");
    premiumOwners.add(owner.id);
    await owner.agent.post("/api/v1/collaborators/invitations")
      .set("Origin", origin).set("X-CSRF-Token", owner.csrf)
      .send({ email: collaborator.email, role: "viewer" }).expect(201);
    await collaborator.agent.post("/api/v1/collaborators/accept")
      .set("Origin", origin).set("X-CSRF-Token", collaborator.csrf)
      .send({ token: invitationToken() }).expect(200);
    await collaborator.agent.post("/api/v1/collaborators/active-workspace")
      .set("Origin", origin).set("X-CSRF-Token", collaborator.csrf)
      .send({ ownerUserId: owner.id }).expect(200);
    premiumOwners.delete(owner.id);
    const response = await collaborator.agent.get("/api/v1/animals").expect(403);
    expect(response.body.code).toBe("PREMIUM_REQUIRED");
  });
});
