import { chromium } from 'playwright';

export async function scrapeJobPosting(url: string): Promise<string> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Let dynamic content settle
    await page.waitForTimeout(2000);
    const text = await page.evaluate(() => document.body.innerText);
    if (!text || text.trim().length < 100) throw new Error('Page returned too little content — it may require authentication or be bot-protected');
    return text;
  } finally {
    await browser.close();
  }
}
