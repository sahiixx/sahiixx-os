import { test, expect } from "@playwright/test";
test("login, recovery safety and private data", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  expect((await request.get("/api/trpc/nexus.estateLeads")).status()).toBe(401);
  await page.goto("/#/login");
  await page.locator('input[type="email"]').fill("fixture@example.invalid");
  await page.locator('input[type="password"]').fill("synthetic-browser-only");
  await page.getByRole("button", { name: "LOGIN", exact: true }).click();
  await expect(page).toHaveURL(/\/hub$/);
  await page.goto("/#/nexus");
  await expect(page.getByRole("heading", { name: "RECOVERED ESTATE LEADS" })).toBeVisible();
  await expect(page.getByText("Synthetic recovery fixture", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "IMPORT → DEAL" })).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem("sahiixx_token"))).toBeNull();
  await page.reload();
  await expect(page.getByRole("heading", { name: "RECOVERED ESTATE LEADS" })).toBeVisible();
  expect(errors).toEqual([]);
});
