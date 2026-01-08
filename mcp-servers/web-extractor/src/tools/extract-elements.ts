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

interface ExtractedElement {
  selector: string;
  html: string;
  outerHTML: string;
  computedStyles?: Record<string, string>;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export async function extractElements(args: {
  url: string;
  selector: string;
  includeStyles?: boolean;
  includeChildren?: boolean;
}): Promise<string> {
  const { url, selector, includeStyles = true, includeChildren = true } = args;

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    // Wait a bit for any animations to initialize
    await page.waitForTimeout(1000);

    const elements = await page.evaluate(
      ({ selector, includeStyles, includeChildren }) => {
        const els = document.querySelectorAll(selector);
        const results: ExtractedElement[] = [];

        els.forEach((el, index) => {
          const htmlEl = el as HTMLElement;

          // Get computed styles for key properties
          let computedStyles: Record<string, string> | undefined;
          if (includeStyles) {
            const computed = window.getComputedStyle(htmlEl);
            const importantProps = [
              'display', 'position', 'width', 'height', 'margin', 'padding',
              'color', 'backgroundColor', 'fontSize', 'fontFamily', 'fontWeight',
              'border', 'borderRadius', 'boxShadow', 'transform', 'opacity',
              'transition', 'animation', 'animationName', 'animationDuration',
              'animationTimingFunction', 'animationDelay', 'animationIterationCount',
              'animationDirection', 'animationFillMode', 'animationPlayState',
              'flexDirection', 'justifyContent', 'alignItems', 'gap',
              'gridTemplateColumns', 'gridTemplateRows',
            ];
            computedStyles = {};
            importantProps.forEach(prop => {
              const value = computed.getPropertyValue(prop.replace(/([A-Z])/g, '-$1').toLowerCase());
              if (value && value !== 'none' && value !== 'normal' && value !== '0px' && value !== 'auto') {
                computedStyles![prop] = value;
              }
            });
          }

          // Get bounding box
          const rect = htmlEl.getBoundingClientRect();

          results.push({
            selector: `${selector}[${index}]`,
            html: includeChildren ? htmlEl.innerHTML : '',
            outerHTML: htmlEl.outerHTML,
            computedStyles,
            boundingBox: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
          });
        });

        return results;
      },
      { selector, includeStyles, includeChildren }
    );

    return JSON.stringify({
      url,
      selector,
      count: elements.length,
      elements,
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
