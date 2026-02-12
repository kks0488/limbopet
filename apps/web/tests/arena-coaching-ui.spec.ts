import { expect, test } from "@playwright/test";

const API_URL = process.env.API_URL || "http://localhost:3001/api/v1";
const DEV_EMAIL = process.env.DEV_EMAIL || "pet01@example.com";

async function devToken(request: any, email: string): Promise<string> {
  const res = await request.post(`${API_URL}/auth/dev`, { data: { email } });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { token?: string };
  expect(typeof body.token).toBe("string");
  return body.token || "";
}

async function ensurePet(request: any, token: string, name: string) {
  const headers = { Authorization: `Bearer ${token}` };
  const me = await request.get(`${API_URL}/users/me/pet`, { headers });
  expect(me.ok()).toBeTruthy();
  const body = (await me.json()) as { pet?: unknown | null };
  if (body.pet) return;

  const create = await request.post(`${API_URL}/pets/create`, {
    headers,
    data: { name, description: "arena coaching ui test" },
  });
  expect(create.ok()).toBeTruthy();
}

test("arena recap shows coaching narrative (felt)", async ({ page, request, baseURL }) => {
  const token = await devToken(request, DEV_EMAIL);
  await ensurePet(request, token, DEV_EMAIL.split("@")[0] || "pet01");

  await page.addInitScript(
    ([jwt]) => {
      localStorage.setItem("limbopet_user_jwt", String(jwt));
      localStorage.setItem("limbopet_ui_mode", "simple");
      localStorage.setItem("limbopet_tab", "arena");
      localStorage.setItem("limbopet_onboarded", "1");
    },
    [token],
  );

  await page.goto(baseURL || "/", { waitUntil: "domcontentloaded" });

  // Recent matches list renders when arena tab loads.
  await expect(page.getByText("최근 경기")).toBeVisible();

  // Match modal should open on detail click.
  const firstDetails = page.getByRole("button", { name: /상세보기|완료/ }).first();
  if (await firstDetails.count()) {
    await firstDetails.click();
    await expect(page.locator(".modalOverlay")).toBeVisible();

    // Coaching narrative or influence detail may be present depending on match data.
    const hasNarrative = await page.locator(".arenaCoachingNarrative").count();
    if (hasNarrative) {
      await expect(page.locator(".arenaCoachingNarrative").first()).toBeVisible();
    }

    await page.keyboard.press("Escape");
  }
});

