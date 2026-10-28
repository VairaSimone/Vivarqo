import argon2 from "argon2";
import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";
import { AppError } from "../../errors/app-error.js";
import { logger } from "../../logger.js";
import type {
  AccountPatchInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from "./auth.schemas.js";
import type { EmailSender } from "./email-sender.js";
import { createOpaqueToken, hashOpaqueToken } from "./token-utils.js";

const VERIFY_EMAIL_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_PASSWORD_TTL_MS = 60 * 60 * 1000;

function makeLink(path: string, token: string): string {
  const url = new URL(path, env.APP_ORIGIN);
  url.searchParams.set("token", token);
  return url.toString();
}

async function sendWithoutLeakingDetails(
  sender: EmailSender,
  message: { to: string; subject: string; html: string },
  requestId: string,
): Promise<void> {
  try {
    await sender.send(message);
  } catch {
    logger.warn({ requestId }, "Transactional email could not be delivered");
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { code?: string }).code === "P2002";
}

function invalidTokenError(): AppError {
  return new AppError(400, "INVALID_OR_EXPIRED_TOKEN", "The token is invalid or has expired");
}

function isUsableAccount(user: { deletedAt: Date | null; accountStatus: string }): boolean {
  return user.deletedAt === null && user.accountStatus === "active";
}

export async function registerAccount(
  input: RegisterInput,
  sender: EmailSender,
  requestId: string,
): Promise<void> {
  const passwordHash = await argon2.hash(input.password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
  const rawToken = createOpaqueToken();
  const now = new Date();

  let userId: string;
  try {
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          displayName: input.displayName,
          passwordHash,
          locale: "it",
          timezone: "Europe/Rome",
        },
      });
      await tx.authToken.create({
        data: {
          userId: user.id,
          tokenHash: hashOpaqueToken(rawToken),
          tokenType: "verify_email",
          expiresAt: new Date(now.getTime() + VERIFY_EMAIL_TTL_MS),
        },
      });
      return user;
    });
    userId = created.id;
  } catch (error) {
    if (isUniqueConstraintError(error)) return;
    throw error;
  }

  await sendWithoutLeakingDetails(sender, {
    to: input.email,
    subject: "Verifica il tuo indirizzo email — Vivarqo",
    html: `<p>Per verificare il tuo indirizzo email, apri questo link:</p><p><a href="${makeLink("/verify-email", rawToken)}">Verifica email</a></p><p>Il link scade tra 24 ore. Se non hai richiesto un account Vivarqo, ignora questa email.</p>`,
  }, requestId);

  logger.info({ requestId, userId }, "Account registration created");
}

export async function verifyEmail(rawToken: string): Promise<void> {
  const tokenHash = hashOpaqueToken(rawToken);
  const now = new Date();
  const token = await prisma.authToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (
    !token ||
    token.tokenType !== "verify_email" ||
    token.consumedAt !== null ||
    token.expiresAt <= now ||
    !isUsableAccount(token.user)
  ) {
    throw invalidTokenError();
  }

  await prisma.$transaction(async (tx) => {
    const consumed = await tx.authToken.updateMany({
      where: {
        id: token.id,
        tokenType: "verify_email",
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) throw invalidTokenError();

    await tx.user.update({
      where: { id: token.userId },
      data: { emailVerifiedAt: now },
    });
    await tx.authToken.updateMany({
      where: {
        userId: token.userId,
        tokenType: "verify_email",
        consumedAt: null,
      },
      data: { consumedAt: now },
    });
  });
}

export async function resendVerification(
  email: string,
  sender: EmailSender,
  requestId: string,
): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { email, emailVerifiedAt: null, deletedAt: null, accountStatus: "active" },
    select: { id: true, email: true },
  });

  if (!user) return;

  const rawToken = createOpaqueToken();
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.authToken.updateMany({
      where: { userId: user.id, tokenType: "verify_email", consumedAt: null },
      data: { consumedAt: now },
    });
    await tx.authToken.create({
      data: {
        userId: user.id,
        tokenHash: hashOpaqueToken(rawToken),
        tokenType: "verify_email",
        expiresAt: new Date(now.getTime() + VERIFY_EMAIL_TTL_MS),
      },
    });
  });

  await sendWithoutLeakingDetails(sender, {
    to: user.email,
    subject: "Verifica il tuo indirizzo email — Vivarqo",
    html: `<p>Per verificare il tuo indirizzo email, apri questo link:</p><p><a href="${makeLink("/verify-email", rawToken)}">Verifica email</a></p><p>Il link scade tra 24 ore.</p>`,
  }, requestId);
}

export async function authenticate(input: LoginInput): Promise<{ id: string }> {
  const user = await prisma.user.findFirst({
    where: { email: input.email, deletedAt: null },
    select: {
      id: true,
      passwordHash: true,
      emailVerifiedAt: true,
      deletedAt: true,
      accountStatus: true,
    },
  });

  let validPassword = false;
  if (user) {
    try {
      validPassword = await argon2.verify(user.passwordHash, input.password);
    } catch {
      validPassword = false;
    }
  }

  if (!user || !validPassword || !isUsableAccount(user)) {
    throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
  }
  if (user.emailVerifiedAt === null) {
    throw new AppError(403, "EMAIL_NOT_VERIFIED", "Verify your email before signing in");
  }

  return { id: user.id };
}

export async function requestPasswordReset(
  email: string,
  sender: EmailSender,
  requestId: string,
): Promise<void> {
  const user = await prisma.user.findFirst({
    where: {
      email,
      emailVerifiedAt: { not: null },
      deletedAt: null,
      accountStatus: "active",
    },
    select: { id: true, email: true },
  });
  if (!user) return;

  const rawToken = createOpaqueToken();
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.authToken.updateMany({
      where: { userId: user.id, tokenType: "reset_password", consumedAt: null },
      data: { consumedAt: now },
    });
    await tx.authToken.create({
      data: {
        userId: user.id,
        tokenHash: hashOpaqueToken(rawToken),
        tokenType: "reset_password",
        expiresAt: new Date(now.getTime() + RESET_PASSWORD_TTL_MS),
      },
    });
  });

  await sendWithoutLeakingDetails(sender, {
    to: user.email,
    subject: "Reimposta la password — Vivarqo",
    html: `<p>Per impostare una nuova password, apri questo link:</p><p><a href="${makeLink("/reset-password", rawToken)}">Reimposta password</a></p><p>Il link scade tra 60 minuti. Se non hai richiesto il reset, ignora questa email.</p>`,
  }, requestId);
}

export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  const now = new Date();
  const token = await prisma.authToken.findUnique({
    where: { tokenHash: hashOpaqueToken(input.token) },
    include: { user: true },
  });

  if (
    !token ||
    token.tokenType !== "reset_password" ||
    token.consumedAt !== null ||
    token.expiresAt <= now ||
    !isUsableAccount(token.user) ||
    token.user.emailVerifiedAt === null
  ) {
    throw invalidTokenError();
  }

  const passwordHash = await argon2.hash(input.password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  await prisma.$transaction(async (tx) => {
    const consumed = await tx.authToken.updateMany({
      where: {
        id: token.id,
        tokenType: "reset_password",
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) throw invalidTokenError();

    await tx.user.update({ where: { id: token.userId }, data: { passwordHash } });
    await tx.userSession.deleteMany({ where: { userId: token.userId } });
    await tx.authToken.updateMany({
      where: {
        userId: token.userId,
        tokenType: "reset_password",
        consumedAt: null,
      },
      data: { consumedAt: now },
    });
  });
}

export async function patchAccount(
  userId: string,
  input: AccountPatchInput,
  sender: EmailSender,
  requestId: string,
): Promise<{ user: { id: string; email: string; displayName: string; locale: string; timezone: string }; emailChanged: boolean; passwordChanged: boolean }> {
  const current = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!current || current.accountStatus !== "active") {
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication required");
  }

  const normalizedEmail = input.email?.toLowerCase();
  const emailChanged = normalizedEmail !== undefined && normalizedEmail !== current.email.toLowerCase();
  const passwordChanged = input.newPassword !== undefined;

  if (emailChanged || passwordChanged) {
    if (!input.currentPassword) {
      throw new AppError(400, "CURRENT_PASSWORD_REQUIRED", "Current password is required");
    }

    let passwordIsValid = false;
    try {
      passwordIsValid = await argon2.verify(current.passwordHash, input.currentPassword);
    } catch {
      passwordIsValid = false;
    }
    if (!passwordIsValid) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Current password is incorrect");
    }
  }

  const newPasswordHash = input.newPassword
    ? await argon2.hash(input.newPassword, {
        type: argon2.argon2id,
        memoryCost: 19_456,
        timeCost: 2,
        parallelism: 1,
      })
    : undefined;

  const rawVerificationToken = emailChanged ? createOpaqueToken() : undefined;
  const now = new Date();
  let updatedUser: { id: string; email: string; displayName: string; locale: string; timezone: string };

  try {
    updatedUser = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          ...(input.locale !== undefined ? { locale: input.locale } : {}),
          ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
          ...(emailChanged ? { email: normalizedEmail!, emailVerifiedAt: null } : {}),
          ...(newPasswordHash ? { passwordHash: newPasswordHash } : {}),
        },
        select: { id: true, email: true, displayName: true, locale: true, timezone: true },
      });

      if (emailChanged || passwordChanged) {
        await tx.userSession.deleteMany({ where: { userId } });
      }
      if (emailChanged && rawVerificationToken) {
        await tx.authToken.updateMany({
          where: { userId, consumedAt: null },
          data: { consumedAt: now },
        });
        await tx.authToken.create({
          data: {
            userId,
            tokenHash: hashOpaqueToken(rawVerificationToken),
            tokenType: "verify_email",
            expiresAt: new Date(now.getTime() + VERIFY_EMAIL_TTL_MS),
          },
        });
      }
      if (passwordChanged) {
        await tx.authToken.updateMany({
          where: { userId, tokenType: "reset_password", consumedAt: null },
          data: { consumedAt: now },
        });
      }
      return updated;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AppError(409, "EMAIL_IN_USE", "An account with this email already exists");
    }
    throw error;
  }

  if (emailChanged && rawVerificationToken) {
    await sendWithoutLeakingDetails(sender, {
      to: updatedUser.email,
      subject: "Conferma il nuovo indirizzo email — Vivarqo",
      html: `<p>Per confermare il nuovo indirizzo email, apri questo link:</p><p><a href="${makeLink("/verify-email", rawVerificationToken)}">Verifica email</a></p><p>Il link scade tra 24 ore.</p>`,
    }, requestId);
  }

  return { user: updatedUser, emailChanged, passwordChanged };
}
