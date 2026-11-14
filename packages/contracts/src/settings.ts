export interface AccountPreferencesDto {
  weightUnit: "g" | "kg" | "oz" | "lb" | string;
  temperatureUnit: "c" | "f" | string;
  dateFormat: "locale" | "dd/MM/yyyy" | "yyyy-MM-dd" | string;
  defaultLandingPage: string;
  compactTables: boolean;
  theme: "system" | "light" | "dark" | string;
  timezone?: string;
}

export interface NotificationDto {
  id: string;
  targetPath: string | null;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationPreferencesDto {
  inAppEnabled: boolean;
  pushEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  categories: Record<string, boolean>;
}

export interface PushSubscriptionDto {
  id: string;
  endpoint: string;
  userAgent: string | null;
  createdAt: string;
}

export type BillingPlan = "free" | "paid";
export type BillingAccessMode = "unrestricted" | "subscription_required";

export interface BillingSubscriptionDto {
  id: string;
  status: string;
  stripePriceId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BillingEntitlementsDto {
  plan: BillingPlan;
  billingInterval?: "monthly" | "annual" | null;
  paidSubscription: boolean;
  accessMode: BillingAccessMode;
  accessAllowed: boolean;
  status: string | null;
  gracePeriodEndsAt: string | null;
  maxAnimals: number | null;
  maxDocuments: number | null;
  maxStorageBytes: number | null;
  animalsUsed: number;
  documentsUsed: number;
  /** Exact decimal string to preserve PostgreSQL BigInt values. */
  storageBytesUsed: string;
  features: string[];
}

export interface SettingsUserDto {
  id: string;
  email: string;
  displayName: string;
  locale: "it" | "en";
  timezone: string;
}
