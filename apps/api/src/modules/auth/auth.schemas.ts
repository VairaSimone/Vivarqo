import { z } from "zod";

const emailSchema = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
const passwordSchema = z.string().min(12).max(128).refine(
  (value) => !value.includes("\0"),
  { message: "Password contains an unsupported character" },
);
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Invalid token format");

export const registerSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  email: emailSchema,
  password: passwordSchema,
});

export const verifyEmailSchema = z.object({ token: tokenSchema });
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export const emailRequestSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({
  token: tokenSchema,
  password: passwordSchema,
});

const supportedTimezone = (timezone: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
};

export const accountPatchSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  locale: z.enum(["it", "en"]).optional(),
  timezone: z.string().trim().min(1).max(64).refine(supportedTimezone, "Invalid IANA timezone").optional(),
  email: emailSchema.optional(),
  currentPassword: z.string().min(1).max(128).optional(),
  newPassword: passwordSchema.optional(),
}).superRefine((value, ctx) => {
  if (
    value.displayName === undefined &&
    value.locale === undefined &&
    value.timezone === undefined &&
    value.email === undefined &&
    value.newPassword === undefined
  ) {
    ctx.addIssue({ code: "custom", message: "At least one account field must be provided" });
  }

  if ((value.email !== undefined || value.newPassword !== undefined) && value.currentPassword === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["currentPassword"],
      message: "Current password is required to change email or password",
    });
  }
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type EmailRequestInput = z.infer<typeof emailRequestSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type AccountPatchInput = z.infer<typeof accountPatchSchema>;
