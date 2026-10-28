import { createHash, randomUUID } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import type { EmailSender, TransactionalEmail } from "../src/modules/auth/email-sender.js";

const integrationEnabled = process.env.RUN_DB_INTEGRATION === "true";

describe.skipIf(!integrationEnabled)("Authentication and account integration", () => {
  const emails: TransactionalEmail[] = [];
  const testEmails = new Set<string>();
  const sender: EmailSender = {
    async send(message) {
      emails.push(message);
    },
  };
  let app: Express;

  beforeAll(() => {
    app = createApp({ checkDatabase: async () => undefined, emailSender: sender });
  });

  afterAll(async () => {
    if (testEmails.size > 0) {
      await prisma.user.deleteMany({ where: { email: { in: [...testEmails] } } });
    }
    await prisma.$disconnect();
  });

  async function newAccount(agent: ReturnType<typeof request.agent>) {
    const email = `auth-${randomUUID()}@example.com`;
    const password = "Correct-Horse-Battery-42!";
    testEmails.add(email);

    const csrfResponse = await agent.get("/api/v1/auth/csrf");
    expect(csrfResponse.status).toBe(200);
    const csrfToken = csrfResponse.body.csrfToken as string;
    const origin = "http://localhost:5173";

    const registerResponse = await agent
      .post("/api/v1/auth/register")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({ displayName: "Integration Breeder", email, password });
    expect(registerResponse.status).toBe(202);

    const verificationEmail = [...emails].reverse().find((message) =>
      message.to === email && message.subject.includes("Verifica"),
    );
    expect(verificationEmail).toBeDefined();
    const href = verificationEmail?.html.match(/href="([^"]+)"/)?.[1];
    expect(href).toBeDefined();
    const token = new URL(href!).searchParams.get("token");
    expect(token).toBeTruthy();

    const verifyResponse = await agent
      .post("/api/v1/auth/verify-email")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({ token });
    expect(verifyResponse.status).toBe(200);

    return { email, password, csrfToken, origin, agent };
  }

  it("registers, verifies, authenticates, updates account settings and revokes session", async () => {
    const agent = request.agent(app);
    const account = await newAccount(agent);

    const verifiedUser = await prisma.user.findUnique({ where: { email: account.email } });
    expect(verifiedUser?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(verifiedUser?.passwordHash.startsWith("$argon2id$")).toBe(true);

    const loginResponse = await account.agent
      .post("/api/v1/auth/login")
      .set("Origin", account.origin)
      .set("X-CSRF-Token", account.csrfToken)
      .send({ email: account.email, password: account.password });
    expect(loginResponse.status).toBe(200);

    const cookieHeader = (loginResponse.headers["set-cookie"] as string[]).find((value) =>
      value.startsWith("vivarqo_session="),
    );
    expect(cookieHeader).toBeDefined();
    expect(cookieHeader).toContain("HttpOnly");
    const rawSessionToken = cookieHeader!.split(";")[0]!.slice("vivarqo_session=".length);
    const tokenHash = createHash("sha256").update(rawSessionToken).digest("hex");
    const storedSession = await prisma.userSession.findUnique({ where: { tokenHash } });
    expect(storedSession).not.toBeNull();
    expect(storedSession?.tokenHash).not.toBe(rawSessionToken);

    const meResponse = await account.agent.get("/api/v1/auth/me");
    expect(meResponse.status).toBe(200);
    expect(meResponse.body.user).toMatchObject({
      email: account.email,
      displayName: "Integration Breeder",
      locale: "it",
      timezone: "Europe/Rome",
    });

    const accountResponse = await account.agent
      .patch("/api/v1/account")
      .set("Origin", account.origin)
      .set("X-CSRF-Token", account.csrfToken)
      .send({ displayName: "Updated Breeder", locale: "en", timezone: "Europe/London" });
    expect(accountResponse.status).toBe(200);
    expect(accountResponse.body.user).toMatchObject({
      displayName: "Updated Breeder",
      locale: "en",
      timezone: "Europe/London",
    });

    const logoutResponse = await account.agent
      .post("/api/v1/auth/logout")
      .set("Origin", account.origin)
      .set("X-CSRF-Token", account.csrfToken)
      .send({});
    expect(logoutResponse.status).toBe(200);
    expect(await prisma.userSession.findUnique({ where: { tokenHash } })).toBeNull();
    expect((await account.agent.get("/api/v1/auth/me")).status).toBe(401);
  });

  it("resets a password with a one-time token and revokes all sessions", async () => {
    const agent = request.agent(app);
    const account = await newAccount(agent);

    const loginResponse = await agent
      .post("/api/v1/auth/login")
      .set("Origin", account.origin)
      .set("X-CSRF-Token", account.csrfToken)
      .send({ email: account.email, password: account.password });
    expect(loginResponse.status).toBe(200);

    const forgotResponse = await agent
      .post("/api/v1/auth/forgot-password")
      .set("Origin", account.origin)
      .set("X-CSRF-Token", account.csrfToken)
      .send({ email: account.email });
    expect(forgotResponse.status).toBe(202);

    const resetEmail = [...emails].reverse().find((message) =>
      message.to === account.email && message.subject.includes("Reimposta"),
    );
    expect(resetEmail).toBeDefined();
    const href = resetEmail?.html.match(/href="([^"]+)"/)?.[1];
    const resetToken = new URL(href!).searchParams.get("token");
    expect(resetToken).toBeTruthy();

    const newPassword = "Different-Correct-Horse-43!";
    const resetResponse = await agent
      .post("/api/v1/auth/reset-password")
      .set("Origin", account.origin)
      .set("X-CSRF-Token", account.csrfToken)
      .send({ token: resetToken, password: newPassword });
    expect(resetResponse.status).toBe(200);
    expect((await agent.get("/api/v1/auth/me")).status).toBe(401);

    const oldPasswordResponse = await agent
      .post("/api/v1/auth/login")
      .set("Origin", account.origin)
      .set("X-CSRF-Token", account.csrfToken)
      .send({ email: account.email, password: account.password });
    expect(oldPasswordResponse.status).toBe(401);

    const newPasswordResponse = await agent
      .post("/api/v1/auth/login")
      .set("Origin", account.origin)
      .set("X-CSRF-Token", account.csrfToken)
      .send({ email: account.email, password: newPassword });
    expect(newPasswordResponse.status).toBe(200);
  });
  it("requires the current password to change email/password and re-verifies a new email", async () => {
    const agent = request.agent(app);
    const account = await newAccount(agent);
    const newEmail = `auth-changed-${randomUUID()}@example.com`;
    const newPassword = "New-Strong-Passphrase-45!";
    testEmails.add(newEmail);

    const loginResponse = await agent
      .post("/api/v1/auth/login")
      .set("Origin", account.origin)
      .set("X-CSRF-Token", account.csrfToken)
      .send({ email: account.email, password: account.password });
    expect(loginResponse.status).toBe(200);

    const changeWithoutPassword = await agent
      .patch("/api/v1/account")
      .set("Origin", account.origin)
      .set("X-CSRF-Token", account.csrfToken)
      .send({ email: newEmail });
    expect(changeWithoutPassword.status).toBe(400);

    const emailChangeResponse = await agent
      .patch("/api/v1/account")
      .set("Origin", account.origin)
      .set("X-CSRF-Token", account.csrfToken)
      .send({ email: newEmail, currentPassword: account.password });
    expect(emailChangeResponse.status).toBe(202);
    expect((await agent.get("/api/v1/auth/me")).status).toBe(401);

    const verificationEmail = [...emails].reverse().find((message) =>
      message.to === newEmail && message.subject.includes("Conferma"),
    );
    expect(verificationEmail).toBeDefined();
    const href = verificationEmail?.html.match(/href="([^"]+)"/)?.[1];
    const verificationToken = new URL(href!).searchParams.get("token");
    expect(verificationToken).toBeTruthy();

    const verifyResponse = await agent
      .post("/api/v1/auth/verify-email")
      .set("Origin", account.origin)
      .set("X-CSRF-Token", account.csrfToken)
      .send({ token: verificationToken });
    expect(verifyResponse.status).toBe(200);

    const loginAfterEmailChange = await agent
      .post("/api/v1/auth/login")
      .set("Origin", account.origin)
      .set("X-CSRF-Token", account.csrfToken)
      .send({ email: newEmail, password: account.password });
    expect(loginAfterEmailChange.status).toBe(200);

    const passwordChangeResponse = await agent
      .patch("/api/v1/account")
      .set("Origin", account.origin)
      .set("X-CSRF-Token", account.csrfToken)
      .send({ currentPassword: account.password, newPassword });
    expect(passwordChangeResponse.status).toBe(200);
    expect((await agent.get("/api/v1/auth/me")).status).toBe(401);

    const oldPasswordResponse = await agent
      .post("/api/v1/auth/login")
      .set("Origin", account.origin)
      .set("X-CSRF-Token", account.csrfToken)
      .send({ email: newEmail, password: account.password });
    expect(oldPasswordResponse.status).toBe(401);

    const newPasswordResponse = await agent
      .post("/api/v1/auth/login")
      .set("Origin", account.origin)
      .set("X-CSRF-Token", account.csrfToken)
      .send({ email: newEmail, password: newPassword });
    expect(newPasswordResponse.status).toBe(200);
  });

});
