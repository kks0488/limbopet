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
    if (msg.type() === "error") errors.push(`[console] ${msg.text()}`);
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

  // 📰 News tab (regression: blank/freeze)
  await clickTab("소식");
  await expect(page.getByRole("heading", { name: "오늘의 방송" })).toBeVisible();

  const arenaCard = page.locator(".card", { hasText: "🏟️ 아레나" });
  await expect(arenaCard).toBeVisible();

  await safeClick(arenaCard.getByRole("button", { name: "새로고침" }));
  await safeClick(arenaCard.getByRole("button", { name: "리더보드" }));

  const firstMatch = arenaCard.locator("button.postOpenBtn").first();
  if (await firstMatch.count()) {
    await firstMatch.click();
    const watchOverlay = page.locator(".modalOverlay");
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

      // Jump back to watch via "경기 관전" when available
      const watchBtn = postOverlay.getByRole("button", { name: "경기 관전" });
      if (await watchBtn.count()) {
        await watchBtn.click();
        await expect(page.locator(".modalOverlay")).toBeVisible();
      }

      await page.keyboard.press("Escape");
    } else {
      await page.keyboard.press("Escape");
    }
  }

  // 🗳️ Elections (safe click: refresh + first enabled vote/register if present)
  const electionsCard = page.locator(".card", { hasText: "🗳️ 선거" });
  if (await electionsCard.count()) {
    await safeClick(electionsCard.getByRole("button", { name: "새로고침" }));
    await safeClick(electionsCard.getByRole("button", { name: "투표" }));
    await safeClick(electionsCard.getByRole("button", { name: /출마/ }));
  }

  // 🔬 Research (safe click: join if enabled)
  const researchCard = page.locator(".card", { hasText: "🔬 연구소" });
  if (await researchCard.count()) {
    await safeClick(researchCard.getByRole("button", { name: "참여하기" }));
  }

  // 🕵️ Society (safe click: respond if invited)
  const societyCard = page.locator(".card", { hasText: "🕵️ 비밀결사" });
  if (await societyCard.count()) {
    await safeClick(societyCard.getByRole("button", { name: "가입하기" }));
    await safeClick(societyCard.getByRole("button", { name: "거절하기" }));
  }

  // 🏟️ Plaza tab
  await clickTab("광장");
  const plazaCard = page.locator(".card", { hasText: "광장 (게시판)" });
  await expect(plazaCard).toBeVisible();

  const plazaSelects = plazaCard.locator("select");
  if ((await plazaSelects.count()) >= 2) {
    await plazaSelects.nth(0).selectOption("arena");
    await plazaSelects.nth(1).selectOption("new");
  }

  const searchInput = plazaCard.locator('input[placeholder*="검색"]').first();
  if (await searchInput.count()) {
    await searchInput.fill("프롬");
    await plazaCard.getByRole("button", { name: "검색" }).click();
  }

  const firstPost = plazaCard.locator("button.postOpenBtn").first();
  if (await firstPost.count()) {
    await firstPost.click();
    await expect(page.locator(".modalOverlay")).toBeVisible();
    await page.keyboard.press("Escape");
  }

  // ⚙️ Settings tab: toggle debug (enables extra pet buttons)
  await clickTab("설정");
  const debugToggle = page.getByRole("button", { name: /debug 켜기|debug 끄기/ });
  await debugToggle.click();

  // 🐾 Pet tab: click debug-only action buttons (feed/play/sleep)
  await clickTab("펫");
  const debugButtons = [
    /먹이/,
    /놀기/,
    /재우기/,
  ];
  for (const re of debugButtons) {
    const btn = page.getByRole("button", { name: re });
    if (await btn.count()) {
      await btn.first().click();
    }
  }

  // Assertion: no runtime errors captured
  expect(errors).toEqual([]);
});
