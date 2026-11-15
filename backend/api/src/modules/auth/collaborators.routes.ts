import { Router } from "express";
import { createOpaqueToken, hashOpaqueToken } from "./token-utils.js";
import { z } from "zod";
import { env } from "../../config/env.js";
import { AppError } from "../../errors/app-error.js";
import { prisma } from "../../db/prisma.js";
import { persistentRateLimit } from "../../middleware/persistent-rate-limit.js";
import { hasPaidSubscriptionEntitlement } from "../domain/billing-entitlements.js";
import { requireSession, type AuthContext } from "./session.js";
import { createConfiguredEmailSender, type EmailSender } from "./email-sender.js";

const collaboratorRole = z.enum(["admin", "operator", "breeding", "viewer"]);
const inviteSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  role: collaboratorRole,
}).strict();
const roleSchema = z.object({ role: collaboratorRole }).strict();
const acceptSchema = z.object({ token: z.string().min(32).max(128) }).strict();
const workspaceSchema = z.object({ ownerUserId: z.string().uuid().nullable() }).strict();

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", {
    issues: result.error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message })),
  });
  return result.data;
}
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}
async function assertPremium(ownerUserId: string): Promise<void> {
  if (!await hasPaidSubscriptionEntitlement(ownerUserId)) {
    throw new AppError(403, "PREMIUM_REQUIRED", "An active Premium subscription is required to invite or join a shared workspace", {
      upgradeRequired: true, billingPath: "/billing",
    });
  }
}
async function writeAudit(userId: string, action: string, entityId: string | null, metadata: Record<string, unknown>, requestId?: string) {
  await prisma.auditEvent.create({
    data: {
      userId, action, entityType: "workspace_collaboration", entityId,
      requestId: requestId ?? null, metadata,
    },
  });
}

export function createCollaboratorRouter(sender?: EmailSender) {
  const router = Router();
  const emailSender = sender ?? createConfiguredEmailSender();

  router.get("/collaborators", requireSession, async (_req, res) => {
    const auth = res.locals.auth as AuthContext;
    const [memberships, invitations, session] = await Promise.all([
      prisma.workspaceMembership.findMany({
        where: { ownerUserId: auth.userId, revokedAt: null },
        orderBy: { createdAt: "asc" },
        include: { collaborator: { select: { id: true, email: true, displayName: true, locale: true } } },
      }),
      prisma.workspaceInvitation.findMany({
        where: { ownerUserId: auth.userId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
        select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
      }),
      prisma.userSession.findFirst({ where: { id: auth.sessionId, userId: auth.userId }, select: { activeWorkspaceOwnerId: true } }),
    ]);
    const workspaces = await prisma.workspaceMembership.findMany({
      where: { collaboratorUserId: auth.userId, revokedAt: null },
      orderBy: { createdAt: "asc" },
      include: { owner: { select: { id: true, displayName: true, email: true } } },
    });
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).json({
      collaborators: memberships.map((item) => ({
        id: item.id, role: item.role, createdAt: item.createdAt,
        user: item.collaborator,
      })),
      invitations,
      workspaces: workspaces.map((item) => ({
        ownerUserId: item.ownerUserId, role: item.role,
        owner: item.owner, active: session?.activeWorkspaceOwnerId === item.ownerUserId,
      })),
      activeWorkspaceOwnerId: session?.activeWorkspaceOwnerId ?? null,
    });
  });

  router.post("/collaborators/invitations", requireSession, persistentRateLimit(10, "workspace-invitations"), async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = parse(inviteSchema, req.body);
    if (input.email === auth.email.toLowerCase()) throw new AppError(400, "SELF_INVITATION_NOT_ALLOWED", "You cannot invite your own account");
    await assertPremium(auth.userId);

    const now = new Date();
    await prisma.workspaceInvitation.updateMany({
      where: { ownerUserId: auth.userId, acceptedAt: null, revokedAt: null, expiresAt: { lte: now } },
      data: { revokedAt: now },
    });
    const existing = await prisma.workspaceInvitation.findFirst({
      where: { ownerUserId: auth.userId, email: input.email, acceptedAt: null, revokedAt: null },
      select: { id: true },
    });
    if (existing) throw new AppError(409, "INVITATION_ALREADY_PENDING", "An invitation for this email is already pending");
    const token = createOpaqueToken();
    const invitation = await prisma.workspaceInvitation.create({
      data: {
        ownerUserId: auth.userId, email: input.email, role: input.role,
        tokenHash: hashOpaqueToken(token), expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      },
      select: { id: true, email: true, role: true, expiresAt: true },
    });
    const url = new URL("/settings/collaborators", env.APP_ORIGIN);
    url.searchParams.set("invite", token);
    const isEnglish = auth.locale === "en";
    try {
      await emailSender.send({
        to: input.email,
        subject: isEnglish ? "Invitation to collaborate on Vivarqo" : "Invito a collaborare su Vivarqo",
        html: isEnglish
          ? `<p>${escapeHtml(auth.displayName)} invited you to collaborate in their Vivarqo workspace.</p><p>Sign in or create your account with this email address, then accept the invitation:</p><p><a href="${escapeHtml(url.toString())}">Review invitation</a></p><p>This link expires in 7 days. If you were not expecting it, ignore this email.</p>`
          : `<p>${escapeHtml(auth.displayName)} ti ha invitato a collaborare nel proprio workspace Vivarqo.</p><p>Accedi o crea un account con questo indirizzo email, poi accetta l'invito:</p><p><a href="${escapeHtml(url.toString())}">Visualizza invito</a></p><p>Il link scade tra 7 giorni. Se non aspettavi questo invito, ignora questa email.</p>`,
      });
    } catch {
      await prisma.workspaceInvitation.deleteMany({ where: { id: invitation.id, acceptedAt: null } });
      throw new AppError(503, "INVITATION_EMAIL_FAILED", "The invitation email could not be delivered");
    }
    await writeAudit(auth.userId, "workspace.invitation.created", invitation.id, { email: input.email, role: input.role },
      typeof res.locals.requestId === "string" ? res.locals.requestId : undefined);
    res.status(201).json({ invitation });
  });

  router.delete("/collaborators/invitations/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw new AppError(400, "INVALID_ID", "Invalid invitation id");
    const result = await prisma.workspaceInvitation.updateMany({
      where: { id: id.data, ownerUserId: auth.userId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!result.count) throw new AppError(404, "INVITATION_NOT_FOUND", "Pending invitation not found");
    await writeAudit(auth.userId, "workspace.invitation.revoked", id.data, {});
    res.status(204).send();
  });

  router.patch("/collaborators/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw new AppError(400, "INVALID_ID", "Invalid collaborator id");
    const input = parse(roleSchema, req.body);
    const result = await prisma.workspaceMembership.updateMany({
      where: { id: id.data, ownerUserId: auth.userId, revokedAt: null },
      data: { role: input.role },
    });
    if (!result.count) throw new AppError(404, "COLLABORATOR_NOT_FOUND", "Collaborator not found");
    await writeAudit(auth.userId, "workspace.collaborator.role_changed", id.data, { role: input.role });
    res.status(200).json({ id: id.data, role: input.role });
  });

  router.delete("/collaborators/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw new AppError(400, "INVALID_ID", "Invalid collaborator id");
    const membership = await prisma.workspaceMembership.findFirst({
      where: { id: id.data, ownerUserId: auth.userId, revokedAt: null },
      select: { collaboratorUserId: true },
    });
    if (!membership) throw new AppError(404, "COLLABORATOR_NOT_FOUND", "Collaborator not found");
    const now = new Date();
    await prisma.$transaction([
      prisma.workspaceMembership.update({ where: { id: id.data }, data: { revokedAt: now } }),
      prisma.userSession.updateMany({
        where: { userId: membership.collaboratorUserId, activeWorkspaceOwnerId: auth.userId },
        data: { activeWorkspaceOwnerId: null },
      }),
      prisma.auditEvent.create({
        data: { userId: auth.userId, action: "workspace.collaborator.revoked", entityType: "workspace_collaboration", entityId: id.data },
      }),
    ]);
    res.status(204).send();
  });

  router.post("/collaborators/accept", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = parse(acceptSchema, req.body);
    const now = new Date();
    const tokenHash = hashOpaqueToken(input.token);
    const invitation = await prisma.workspaceInvitation.findUnique({ where: { tokenHash } });
    if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= now) {
      throw new AppError(404, "INVITATION_INVALID", "The invitation is invalid or has expired");
    }
    if (invitation.email.toLowerCase() !== auth.email.toLowerCase()) {
      throw new AppError(403, "INVITATION_EMAIL_MISMATCH", "Sign in with the email address that received the invitation");
    }
    await assertPremium(invitation.ownerUserId);
    if (invitation.ownerUserId === auth.userId) throw new AppError(400, "SELF_INVITATION_NOT_ALLOWED", "You cannot join your own workspace");

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.workspaceInvitation.updateMany({
        where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { acceptedAt: now },
      });
      if (claimed.count !== 1) throw new AppError(409, "INVITATION_ALREADY_USED", "This invitation has already been used");
      await tx.workspaceMembership.upsert({
        where: { ownerUserId_collaboratorUserId: { ownerUserId: invitation.ownerUserId, collaboratorUserId: auth.userId } },
        create: { ownerUserId: invitation.ownerUserId, collaboratorUserId: auth.userId, role: invitation.role },
        update: { role: invitation.role, revokedAt: null },
      });
      await tx.auditEvent.create({
        data: { userId: auth.userId, action: "workspace.invitation.accepted", entityType: "workspace_collaboration", entityId: invitation.id,
          metadata: { ownerUserId: invitation.ownerUserId, role: invitation.role } },
      });
    });
    res.status(200).json({ ownerUserId: invitation.ownerUserId, role: invitation.role });
  });

  router.post("/collaborators/active-workspace", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = parse(workspaceSchema, req.body);
    if (input.ownerUserId) {
      if (input.ownerUserId === auth.userId) throw new AppError(400, "INVALID_WORKSPACE", "Use null to return to your personal workspace");
      const membership = await prisma.workspaceMembership.findFirst({
        where: { ownerUserId: input.ownerUserId, collaboratorUserId: auth.userId, revokedAt: null },
        select: { id: true },
      });
      if (!membership) throw new AppError(404, "WORKSPACE_NOT_FOUND", "Workspace not found");
      await assertPremium(input.ownerUserId);
    }
    const result = await prisma.userSession.updateMany({
      where: { id: auth.sessionId, userId: auth.userId },
      data: { activeWorkspaceOwnerId: input.ownerUserId },
    });
    if (!result.count) throw new AppError(401, "SESSION_EXPIRED", "Session expired");
    res.status(200).json({ activeWorkspaceOwnerId: input.ownerUserId });
  });

  return router;
}
