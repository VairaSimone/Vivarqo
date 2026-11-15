export interface FeedingMetricEntry {
  outcome: string;
  performedAt: Date;
}
export interface FeedingMetrics {
  feedingIntervalDays: number | null;
  lastAcceptedAt: Date | null;
  daysSinceLastFeeding: number | null;
  nextMealAt: Date | null;
  consecutiveRefusals: number;
  acceptedCount: number;
  refusedCount: number;
  offeredCount: number;
  acceptanceRate: number | null;
}

/** Entries must be sorted newest first. Only accepted meals reset fasting/refusal streaks. */
export function calculateFeedingMetrics(
  entries: FeedingMetricEntry[],
  feedingIntervalDays: number | null,
  now = new Date(),
): FeedingMetrics {
  const acceptedCount = entries.filter((entry) => entry.outcome === "ate").length;
  const refusedCount = entries.filter((entry) => entry.outcome === "refused").length;
  const offeredCount = acceptedCount + refusedCount;
  let consecutiveRefusals = 0;
  for (const entry of entries) {
    if (entry.outcome === "ate") break;
    if (entry.outcome === "refused") consecutiveRefusals += 1;
  }
  const lastAcceptedAt = entries.find((entry) => entry.outcome === "ate")?.performedAt ?? null;
  const daysSinceLastFeeding = lastAcceptedAt
    ? Math.max(0, Math.floor((now.getTime() - lastAcceptedAt.getTime()) / 86_400_000))
    : null;
  const nextMealAt = lastAcceptedAt && feedingIntervalDays
    ? new Date(lastAcceptedAt.getTime() + feedingIntervalDays * 86_400_000)
    : null;
  return {
    feedingIntervalDays,
    lastAcceptedAt,
    daysSinceLastFeeding,
    nextMealAt,
    consecutiveRefusals,
    acceptedCount,
    refusedCount,
    offeredCount,
    acceptanceRate: offeredCount > 0 ? acceptedCount / offeredCount : null,
  };
}
