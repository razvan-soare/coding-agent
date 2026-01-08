import { chromium, type Browser } from 'playwright';

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
    });
  }
  return browser;
}

interface StyleSheetInfo {
  href: string | null;
  isInline: boolean;
  rules: string[];
  keyframes: string[];
  mediaQueries: string[];
}

interface StyleExtractionResult {
  url: string;
  styleSheets: StyleSheetInfo[];
  filteredRules: string[];
  allKeyframes: string[];
  timestamp: string;
}

export async function extractStyles(args: {
  url: string;
  includeExternalSheets?: boolean;
  filterSelectors?: string[];
}): Promise<string> {
  const { url, includeExternalSheets = true, filterSelectors } = args;

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    const result = await page.evaluate(
      ({ filterSelectors }) => {
        const styleSheets: StyleSheetInfo[] = [];
        const allKeyframes: string[] = [];
        const filteredRules: string[] = [];

        const matchesFilter = (text: string): boolean => {
          if (!filterSelectors || filterSelectors.length === 0) return true;
          return filterSelectors.some(filter => text.includes(filter));
        };

        Array.from(document.styleSheets).forEach(sheet => {
          try {
            const sheetInfo: StyleSheetInfo = {
              href: sheet.href,
              isInline: !sheet.href,
              rules: [],
              keyframes: [],
              mediaQueries: [],
            };

            const rules = sheet.cssRules || sheet.rules;
            Array.from(rules).forEach(rule => {
              const ruleText = rule.cssText;

              // Keyframes
              if (rule instanceof CSSKeyframesRule) {
                sheetInfo.keyframes.push(ruleText);
                allKeyframes.push(ruleText);
                if (matchesFilter(ruleText) || matchesFilter('@keyframes')) {
                  filteredRules.push(ruleText);
                }
                return;
              }

              // Media queries
              if (rule instanceof CSSMediaRule) {
                sheetInfo.mediaQueries.push(ruleText);
                if (matchesFilter(ruleText)) {
                  filteredRules.push(ruleText);
                }
                return;
              }

              // Regular style rules
              if (rule instanceof CSSStyleRule) {
                sheetInfo.rules.push(ruleText);
                if (matchesFilter(rule.selectorText) || matchesFilter(ruleText)) {
                  filteredRules.push(ruleText);
                }
                return;
              }

              // Font-face rules
              if (rule instanceof CSSFontFaceRule) {
                sheetInfo.rules.push(ruleText);
                if (matchesFilter('@font-face') || matchesFilter(ruleText)) {
                  filteredRules.push(ruleText);
                }
                return;
              }

              // Other rules
              sheetInfo.rules.push(ruleText);
              if (matchesFilter(ruleText)) {
                filteredRules.push(ruleText);
              }
            });

            styleSheets.push(sheetInfo);
          } catch {
            // Cross-origin stylesheets will throw - record as inaccessible
            styleSheets.push({
              href: sheet.href,
              isInline: false,
              rules: ['/* Cross-origin stylesheet - cannot access rules */'],
              keyframes: [],
              mediaQueries: [],
            });
          }
        });

        return {
          url: window.location.href,
          styleSheets,
          filteredRules,
          allKeyframes,
          timestamp: new Date().toISOString(),
        } as StyleExtractionResult;
      },
      { filterSelectors }
    );

    // If external sheets requested and we have cross-origin sheets, try fetching them
    if (includeExternalSheets) {
      for (const sheet of result.styleSheets) {
        if (
          sheet.href &&
          sheet.rules.length === 1 &&
          sheet.rules[0].includes('Cross-origin')
        ) {
          try {
            const response = await page.evaluate(async (href) => {
              const res = await fetch(href);
              if (res.ok) {
                return await res.text();
              }
              return null;
            }, sheet.href);

            if (response) {
              sheet.rules = [`/* Fetched from ${sheet.href} */\n${response}`];

              // Extract keyframes from fetched CSS
              const keyframeMatches = response.matchAll(/@keyframes\s+[\w-]+\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}/g);
              for (const match of keyframeMatches) {
                sheet.keyframes.push(match[0]);
                result.allKeyframes.push(match[0]);
              }
            }
          } catch {
            // Failed to fetch external stylesheet
          }
        }
      }
    }

    return JSON.stringify(result, null, 2);
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
