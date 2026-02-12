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
    data: { name, description: "ui smoke test" },
  });
  expect(create.ok()).toBeTruthy();
}

test("ui smoke: tabs + modals + safe button clicks", async ({ page, request, baseURL }) => {
  const token = await devToken(request, DEV_EMAIL);
  await ensurePet(request, token, DEV_EMAIL.split("@")[0] || "pet01");

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`[pageerror] ${String(e?.message ?? e)}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      // Ignore React DOM nesting warnings (pre-existing, non-critical)
      if (text.includes("validateDOMNesting")) return;
      errors.push(`[console] ${text}`);
    }
  });

  await page.addInitScript(
    ([jwt]) => {
      localStorage.setItem("limbopet_user_jwt", String(jwt));
      localStorage.setItem("limbopet_ui_mode", "simple");
      localStorage.setItem("limbopet_tab", "pet");
      localStorage.setItem("limbopet_onboarded", "1");
    },
    [token],
  );

  await page.goto(baseURL || "/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".tabbar")).toBeVisible();

  const clickTab = async (label: string) => {
    await page.locator(`button.tabBtn:has-text("${label}")`).click();
  };

  const safeClick = async (loc: any) => {
    if (!(await loc.count())) return;
    const el = loc.first();
    if (await el.isVisible().catch(() => false)) {
      if (await el.isEnabled().catch(() => false)) {
        await el.click();
      }
    }
  };

  // 🏟️ Arena tab
  await clickTab("아레나");
  await expect(page.getByText("오늘의 아레나").first()).toBeVisible();

  await safeClick(page.getByRole("button", { name: "새로고침" }).first());
  await safeClick(page.getByRole("button", { name: "리더보드" }).first());

  // Open first match detail if available
  const firstMatch = page.locator("button").filter({ hasText: /상세보기|완료/ }).first();
  if (await firstMatch.count()) {
    await firstMatch.click();
    const watchOverlay = page.locator(".modalOverlay");
    if (await watchOverlay.count()) {
      await expect(watchOverlay).toBeVisible();

      const recapBtn = watchOverlay.getByRole("button", { name: "리캡 글 보기" });
      if (await recapBtn.count()) {
        await recapBtn.click();
        const postOverlay = page.locator(".modalOverlay");
        await expect(postOverlay).toBeVisible();

        // Like + comment (safe write path)
        const likeBtn = postOverlay.getByRole("button", { name: "좋아요" });
        if (await likeBtn.count()) await likeBtn.click();

        const content = `ui-smoke ${Date.now()}`;
        const textarea = postOverlay.locator("textarea").first();
        if (await textarea.count()) {
          await textarea.fill(content);
          await postOverlay.getByRole("button", { name: "등록" }).click();
          await expect(postOverlay.getByText(content)).toBeVisible();
        }

        await page.keyboard.press("Escape");
      } else {
        await page.keyboard.press("Escape");
      }
    }
  }

  // 🏟️ Plaza tab
  await clickTab("광장");
  // Wait for plaza content to load
  await page.waitForTimeout(1000);

  // Kind segment pills
  const arenaSegment = page.locator("button.feed-segment__btn:has-text('아레나')");
  if (await arenaSegment.count()) {
    await arenaSegment.click();
  }

  const searchInput = page.locator('input[placeholder*="검색"]').first();
  if (await searchInput.count()) {
    await searchInput.fill("프롬");
    await searchInput.press("Enter");
  }

  const firstPost = page.locator(".fp-row").first();
  if (await firstPost.count()) {
    await firstPost.click();
    await expect(page.locator(".modalOverlay")).toBeVisible();
    await page.keyboard.press("Escape");
  }

  // ⚙️ Settings panel: open via gear icon
  const gearBtn = page.locator(".settingsGearBtn").first();
  if (await gearBtn.count()) {
    await gearBtn.click();
    const settingsOverlay = page.locator(".settingsOverlay.open");
    await expect(settingsOverlay).toBeVisible();
    // Toggle debug if available
    const debugToggle = page.getByRole("button", { name: /debug 켜기|debug 끄기/ });
    if (await debugToggle.count()) {
      await debugToggle.first().click();
    }
    // Close settings via close button inside panel
    const closeBtn = settingsOverlay.getByRole("button", { name: "닫기" });
    if (await closeBtn.count()) {
      await closeBtn.click();
    } else {
      await page.keyboard.press("Escape");
    }
  }

  // 🐾 Pet tab: click action buttons if visible and enabled (feed/play/sleep)
  await clickTab("펫");
  const debugButtons = [
    /밥 주기|먹이/,
    /놀아주기|놀기/,
    /재우기/,
  ];
  for (const re of debugButtons) {
    await safeClick(page.getByRole("button", { name: re }));
  }

  // Assertion: no runtime errors captured
  expect(errors).toEqual([]);
});
