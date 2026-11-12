import { describe, expect, it } from "vitest";
import { parseDashboardTodayResponse } from "@vivarqo/contracts/operations";
import { parseInventoryItemsResponse } from "@vivarqo/contracts/inventory";
import { parseFeedingSessionsResponse } from "@vivarqo/contracts/care";
import { parseFinanceEntriesResponse, parseFinanceSummaryResponse } from "@vivarqo/contracts/finance";

const validDashboard = {
  date: "2026-11-12",
  timezone: "Europe/Rome",
  tasks: {
    dueToday: [{ id: "task-1", title: "Feed", dueAt: "2026-11-12T10:00:00.000Z", status: "open", animal: { id: "animal-1", name: "Nala" } }],
    overdue: [],
    completedToday: [],
  },
  counts: { dueToday: 1, overdue: 0, completedToday: 0, imminentReminders: 0 },
  truncated: { dueToday: false, overdue: false, completedToday: false, imminentReminders: false },
  imminentReminders: [],
  quickActions: [],
  recentEvents: [],
};

describe("dashboard response contract", () => {
  it("accepts the shape returned by GET /home/today", () => {
    expect(parseDashboardTodayResponse(validDashboard).tasks.dueToday).toHaveLength(1);
  });

  it("rejects an incompatible response instead of silently rendering empty data", () => {
    expect(() => parseDashboardTodayResponse({
      ...validDashboard,
      counts: { ...validDashboard.counts, dueToday: "one" },
    })).toThrow();
  });
});


describe("inventory response contract", () => {
  it("accepts PostgreSQL decimal values serialized as strings", () => {
    const response = parseInventoryItemsResponse({
      items: [{
        id: "item-1", name: "Frozen mice", category: "food", unit: "pcs",
        quantityOnHand: "1.005", minimumQuantity: "0.250", notes: null,
        isActive: true, createdAt: "2026-11-12T10:00:00.000Z", updatedAt: "2026-11-12T10:00:00.000Z",
      }],
      pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
    });
    expect(response.items[0]?.quantityOnHand).toBe("1.005");
  });

  it("rejects malformed decimal strings in inventory responses", () => {
    expect(() => parseInventoryItemsResponse({
      items: [{
        id: "item-1", name: "Broken", category: "food", unit: "pcs",
        quantityOnHand: "1.0005", minimumQuantity: null, notes: null,
        isActive: true, createdAt: "2026-11-12T10:00:00.000Z", updatedAt: "2026-11-12T10:00:00.000Z",
      }],
      pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
    })).toThrow();
  });
});


describe("care and finance response contracts", () => {
  it("validates feeding sessions with decimal weights serialized as strings", () => {
    const response = parseFeedingSessionsResponse({
      sessions: [{
        id: "session-1", performedAt: "2026-11-12T10:00:00.000Z", notes: null,
        entries: [{
          id: "entry-1", sessionId: "session-1", animalId: "animal-1", outcome: "ate",
          foodType: "rat", foodSize: "small", foodWeightG: "150.00", notes: null,
          animal: { id: "animal-1", name: "Nala", identifier: "N-1", species: "Boa constrictor", status: "active" },
        }],
      }],
      pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
    });
    expect(response.sessions[0]?.entries[0]?.foodWeightG).toBe("150.00");
  });

  it("validates finance cents as integer strings", () => {
    const entries = parseFinanceEntriesResponse({
      entries: [{
        id: "finance-1", entryType: "expense", occurredOn: "2026-11-12T00:00:00.000Z",
        amountCents: "1999", currency: "EUR", category: "food", description: "Food",
        animalId: null, documentId: null,
      }],
      pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
    });
    expect(entries.entries[0]?.amountCents).toBe("1999");
    expect(() => parseFinanceSummaryResponse({
      currency: "EUR", from: null, to: null, incomeCents: "0",
      expenseCents: "1.5", balanceCents: "-1.5", categories: [],
    })).toThrow();
  });
});
