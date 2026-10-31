import { expect, test } from "@playwright/test";

const BRAND_LOGO = /^https:\/\/cdn\.brandfetch\.io\//;
const IMAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2">
  <rect width="2" height="2" fill="#249a76"/>
</svg>`;

test("displays a company logo when the Brandfetch image loads", async ({ page }) => {
  const requestedDomains: string[] = [];
  await page.route(BRAND_LOGO, async (route) => {
    requestedDomains.push(new URL(route.request().url()).pathname);
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: IMAGE_SVG,
    });
  });

  await page.goto("/entreprises");
  await page.getByPlaceholder("Nom, alias, domaine, secteur…").fill("Pasqal");

  const logo = page.getByRole("img", { name: "Pasqal" });
  const image = logo.locator("img");
  await expect(image).toHaveAttribute("src", /cdn\.brandfetch\.io\/domain\/pasqal\.com\//);
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);
  await expect(image).toHaveCSS("opacity", "1");
  expect(requestedDomains).toContain("/domain/pasqal.com/fallback/404");
});

test("keeps the monogram after a Brandfetch HTTP 404", async ({ page }) => {
  let failures = 0;
  await page.route(BRAND_LOGO, async (route) => {
    failures += 1;
    await route.fulfill({ status: 404, contentType: "text/plain", body: "Not Found" });
  });

  await page.goto("/entreprises");
  await page.getByPlaceholder("Nom, alias, domaine, secteur…").fill("Allevard Analytics");

  const logo = page.getByRole("img", { name: "Allevard Analytics" });
  await expect(logo).toContainText("AA");
  await expect.poll(() => failures).toBeGreaterThan(0);
  await expect(logo.locator("img")).toHaveCount(0);
});
