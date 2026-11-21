import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ insert: vi.fn(), values: vi.fn(), conflict: vi.fn(), returning: vi.fn(), audit: vi.fn(), health: vi.fn() }));
vi.mock("../../api/lib/env", () => ({ env: { authSecret: "synthetic-only" } }));
vi.mock("../../api/lib/estate", () => ({
  estateConfigured: () => true,
  estateHealth: mocks.health,
  estateLeads: async () => ({ ok: true, leads: [{ id: 42, name: "Synthetic fixture" }] }),
}));
vi.mock("../../api/queries/connection", () => ({ getDb: () => ({ insert: mocks.insert }) }));
vi.mock("../../api/lib/activity", () => ({ logActivity: mocks.audit }));
vi.mock("../../db/schema", () => ({ deals: { dealId: "fixture_deal_id" } }));

import { nexusRouter } from "../../api/nexus-router";
const caller = () => nexusRouter.createCaller({ user: { email: "fixture@example.invalid", role: "admin" } });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.insert.mockReturnValue({ values: mocks.values });
  mocks.values.mockReturnValue({ onConflictDoNothing: mocks.conflict });
  mocks.conflict.mockReturnValue({ returning: mocks.returning });
  mocks.returning.mockResolvedValue([{ dealId: "ESTATE-42" }]);
  mocks.audit.mockResolvedValue(undefined);
  mocks.health.mockResolvedValue({ ok: true, body: { status: "ok" } });
});

it("uses the unique deal ID conflict target", async () => {
  await expect(caller().importLeadAsDeal({ leadId: 42 })).resolves.toEqual({ success: true, dealId: "ESTATE-42", alreadyImported: false });
  expect(mocks.conflict).toHaveBeenCalledWith({ target: "fixture_deal_id" });
  expect(mocks.audit).toHaveBeenCalledTimes(1);
});

it("preserves an existing deal and audits only the first import", async () => {
  mocks.returning.mockResolvedValueOnce([{ dealId: "ESTATE-42" }]).mockResolvedValueOnce([]);
  await caller().importLeadAsDeal({ leadId: 42, tier: "HARD" });
  await expect(caller().importLeadAsDeal({ leadId: 42, tier: "LOW" })).resolves.toEqual({ success: true, dealId: "ESTATE-42", alreadyImported: true });
  expect(mocks.audit).toHaveBeenCalledTimes(1);
});

it("reports errors without auditing a successful import", async () => {
  mocks.returning.mockRejectedValue(new Error("fixture database unavailable"));
  await expect(caller().importLeadAsDeal({ leadId: 42 })).resolves.toEqual({ success: false, error: "fixture database unavailable" });
  expect(mocks.audit).not.toHaveBeenCalled();
});

it("requires authentication", async () => {
  await expect(nexusRouter.createCaller({}).importLeadAsDeal({ leadId: 42 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect(mocks.insert).not.toHaveBeenCalled();
});

it("rejects recovery snapshots before inserting a CRM deal", async () => {
  mocks.health.mockResolvedValue({ ok: true, body: { recovery: true, snapshot: "2026-06-29" } });
  await expect(caller().importLeadAsDeal({ leadId: 42 })).resolves.toEqual({
    success: false, error: "Recovery snapshots cannot be imported as live deals",
  });
  expect(mocks.insert).not.toHaveBeenCalled();
  expect(mocks.audit).not.toHaveBeenCalled();
});

it("fails closed when source health cannot be verified", async () => {
  mocks.health.mockResolvedValue({ ok: false, error: "HTTP 530" });
  await expect(caller().importLeadAsDeal({ leadId: 42 })).resolves.toEqual({ success: false, error: "HTTP 530" });
  expect(mocks.insert).not.toHaveBeenCalled();
});
