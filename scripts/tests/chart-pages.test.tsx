import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

const estate = vi.hoisted(() => ({ recovery: true }));

vi.mock("@/hooks/useSahiixxData", () => ({
  useContactList: () => ({ data: [
    { id: 1, name: "Fixture A", tier: "Champions", totalValue: 100, rfmScore: 90 },
    { id: 2, name: "Fixture B", tier: "Top", totalValue: 200, rfmScore: 80 },
  ] }),
  useContactSearch: () => ({ data: [] }),
  useContactCreate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSignalList: () => ({ data: [
    { id: 1, severity: "high", message: "Fixture A", timestamp: "2026-01-01T00:00:00Z" },
    { id: 2, severity: "medium", message: "Fixture B", timestamp: "2026-01-01T00:00:00Z" },
  ] }),
  useSignalCreate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDealList: () => ({ data: [] }),
  useDealCreate: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useSystemData", () => ({
  useEstateConfig: () => ({ data: { configured: true, baseUrl: "http://127.0.0.1:3011" } }),
  useEstateHealth: () => ({ data: { ok: true, body: { recovery: estate.recovery, snapshot: "2026-06-29" } } }),
  useEstateLeads: () => ({ data: { leads: [{ id: 42, name: "Recovery fixture" }] } }),
  useImportLeadAsDeal: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/providers/trpc", () => ({ trpc: { useUtils: () => ({}) } }));
import Goldmine from "../../src/pages/Goldmine";
import Signals from "../../src/pages/Signals";
import Nexus from "../../src/pages/Nexus";

beforeAll(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 400, height: 200, top: 0, left: 0, right: 400, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
  });
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback([{ target, contentRect: { width: 400, height: 200 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  });
});
afterEach(cleanup);

it("renders Goldmine bars for synthetic contacts", async () => {
  const { container } = render(<Goldmine />);
  await waitFor(() => expect(container.querySelectorAll(".recharts-bar-rectangle").length).toBeGreaterThan(0));
});

it("renders Signals sectors for synthetic alerts", async () => {
  const { container } = render(<Signals />);
  await waitFor(() => expect(container.querySelectorAll(".recharts-pie-sector").length).toBeGreaterThanOrEqual(2));
  expect(container.querySelector(".recharts-wrapper svg")).not.toBeNull();
});

it("labels recovered estate data and disables importing it", () => {
  estate.recovery = true;
  const { getByRole, getByText } = render(<Nexus />);
  expect(getByText(/Read-only recovery snapshot/).textContent).toContain("2026-06-29");
  expect((getByRole("button", { name: /IMPORT/ }) as HTMLButtonElement).disabled).toBe(true);
});

it("keeps importing available for an ordinary live estate source", () => {
  estate.recovery = false;
  const { getByRole } = render(<Nexus />);
  expect((getByRole("button", { name: /IMPORT/ }) as HTMLButtonElement).disabled).toBe(false);
});
