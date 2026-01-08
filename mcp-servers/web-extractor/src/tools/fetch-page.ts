import { chromium, type Browser, type Page } from 'playwright';

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
    });
  }
  return browser;
}

export async function fetchPage(args: {
  url: string;
  waitForSelector?: string;
  timeout?: number;
}): Promise<string> {
  const { url, waitForSelector, timeout = 30000 } = args;

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout,
    });

    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout });
    }

    const html = await page.content();

    // Get page title for context
    const title = await page.title();

    return JSON.stringify({
      url,
      title,
      html,
      timestamp: new Date().toISOString(),
    }, null, 2);
  } finally {
    await page.close();
  }
}

// Cleanup on process exit
process.on('exit', () => {
  if (browser) {
    browser.close().catch(() => {});
  }
});
