import type { RequestHandler } from "express";
import { AppError } from "../../errors/app-error.js";
import { prisma } from "../../db/prisma.js";
import { hasPaidSubscriptionEntitlement } from "../domain/billing-entitlements.js";
import type { AuthContext } from "./session.js";

const personalPrefixes = [
  "/auth", "/account", "/billing", "/collaborators", "/onboarding",
  "/notifications", "/notification-preferences", "/push-subscriptions",
  "/push", "/public", "/webhooks", "/healthz", "/readyz",
];
const workspacePrefixes = [
  "/animals", "/feeding-sessions", "/feeding-entries", "/feeding",
  "/weights", "/sheds", "/animal-notes", "/health-records",
  "/tasks", "/reminder-rules", "/home", "/calendar",
  "/species-breeding-profiles", "/reproduction", "/reproduction-pairs",
  "/reproduction-statistics", "/reproduction-cycles", "/reproductive-events",
  "/incubators", "/incubation-logs", "/clutches", "/eggs", "/offspring-batches",
  "/genetics", "/genetic-traits", "/inventory", "/documents", "/document-deletions",
  "/imports", "/exports", "/finance",
];
const startsWithPath = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + "/");
const isWrite = (method: string) => !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());

function isBreedingPath(path: string): boolean {
  return [
    "/species-breeding-profiles", "/reproduction", "/reproduction-pairs",
    "/reproduction-statistics", "/reproduction-cycles", "/reproductive-events",
    "/incubators", "/incubation-logs", "/clutches", "/eggs", "/offspring-batches",
    "/genetics", "/genetic-traits",
  ].some((prefix) => startsWithPath(path, prefix)) ||
    (/^\/animals\/[^/]+\/(?:genetic-traits|genetic-history|pedigree|inbreeding|hatchling-care)$/.test(path));
}

function canWriteAsOperator(path: string): boolean {
  if (path === "/animals" || path === "/animals/bulk") return true;
  if (/^\/animals\/[^/]+(?:\/archive|\/restore)?$/.test(path)) return true;
  if (["/animals/locations", "/animals/move", "/animals/filters"].some((prefix) => startsWithPath(path, prefix))) return true;
  if (/^\/animals\/[^/]+\/(?:weights|sheds|notes|health-records)$/.test(path)) return true;
  return [
    "/feeding-sessions", "/feeding-entries", "/weights", "/sheds",
    "/animal-notes", "/health-records", "/tasks", "/reminder-rules",
  ].some((prefix) => startsWithPath(path, prefix));
}

function assertRolePermission(role: string, method: string, path: string): void {
  // Financial records and complete data exports always remain owner-only.
  if (startsWithPath(path, "/finance") || startsWithPath(path, "/exports")) {
    throw new AppError(403, "WORKSPACE_PERMISSION_DENIED", "Only the workspace owner can access financial data and full exports");
  }
  if (!isWrite(method)) return;
  if (role === "viewer") {
    throw new AppError(403, "WORKSPACE_PERMISSION_DENIED", "This collaborator has read-only access");
  }
  if (role === "operator" && isBreedingPath(path)) {
    throw new AppError(403, "WORKSPACE_PERMISSION_DENIED", "Genetics and reproduction changes require the reproduction role");
  }
  if (role === "breeding" && !isBreedingPath(path)) {
    throw new AppError(403, "WORKSPACE_PERMISSION_DENIED", "This collaborator can modify reproduction and genetics data only");
  }
  if (role === "operator" && !canWriteAsOperator(path)) {
    throw new AppError(403, "WORKSPACE_PERMISSION_DENIED", "This collaborator cannot modify this area");
  }
  if (!["admin", "operator", "breeding"].includes(role)) {
    throw new AppError(403, "WORKSPACE_PERMISSION_DENIED", "The collaborator role does not allow this operation");
  }
}

export const workspaceAccessGuard: RequestHandler = async (req, res, next) => {
  try {
    const path = req.path;
    if (personalPrefixes.some((prefix) => startsWithPath(path, prefix)) ||
        !workspacePrefixes.some((prefix) => startsWithPath(path, prefix))) {
      next();
      return;
    }
    const auth = res.locals.auth as AuthContext | undefined;
    if (!auth) { next(); return; }

    const session = await prisma.userSession.findFirst({
      where: { id: auth.sessionId, userId: auth.userId },
      select: { activeWorkspaceOwnerId: true },
    });
    const ownerUserId = session?.activeWorkspaceOwnerId;
    if (!ownerUserId) { next(); return; }

    const membership = await prisma.workspaceMembership.findFirst({
      where: { ownerUserId, collaboratorUserId: auth.userId, revokedAt: null },
      select: { id: true, role: true },
    });
    if (!membership) {
      await prisma.userSession.updateMany({
        where: { id: auth.sessionId, userId: auth.userId, activeWorkspaceOwnerId: ownerUserId },
        data: { activeWorkspaceOwnerId: null },
      });
      throw new AppError(403, "WORKSPACE_ACCESS_REVOKED", "Access to this workspace is no longer available. Switch back to your personal workspace.");
    }

    if (!await hasPaidSubscriptionEntitlement(ownerUserId)) {
      throw new AppError(403, "PREMIUM_REQUIRED", "The workspace owner must have an active Premium subscription to share this workspace", {
        upgradeRequired: true, billingPath: "/billing",
      });
    }
    assertRolePermission(membership.role, req.method, path);

    const actorUserId = auth.userId;
    res.locals.auth = {
      ...auth,
      userId: ownerUserId,
      actorUserId,
      workspaceOwnerId: ownerUserId,
      workspaceRole: membership.role,
    } satisfies AuthContext;

    if (isWrite(req.method)) {
      await prisma.auditEvent.create({
        data: {
          userId: actorUserId,
          action: "workspace.collaborator.write",
          entityType: "workspace_membership",
          entityId: membership.id,
          requestId: typeof res.locals.requestId === "string" ? res.locals.requestId : null,
          metadata: { ownerUserId, role: membership.role, method: req.method, path },
        },
      });
    }
    next();
  } catch (error) {
    next(error);
  }
};
