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

interface ExtractedSvg {
  index: number;
  svg: string;
  viewBox?: string;
  width?: string;
  height?: string;
  hasSmilAnimations: boolean;
  smilElements: string[];
  cssClasses: string[];
  inlineStyles?: string;
}

interface SvgExtractionResult {
  url: string;
  selector: string;
  count: number;
  svgs: ExtractedSvg[];
  relatedKeyframes: string[];
  relatedCssRules: string[];
  timestamp: string;
}

export async function extractSvg(args: {
  url: string;
  selector?: string;
  extractAnimations?: boolean;
}): Promise<string> {
  const { url, selector = 'svg', extractAnimations = true } = args;

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    // Wait for potential lazy-loaded content
    await page.waitForTimeout(1500);

    const result = await page.evaluate(
      ({ selector, extractAnimations }) => {
        const svgElements = document.querySelectorAll(selector);
        const svgs: ExtractedSvg[] = [];
        const allCssClasses = new Set<string>();

        svgElements.forEach((el, index) => {
          const svgEl = el as SVGElement;

          // Get all classes used in the SVG
          const collectClasses = (element: Element) => {
            element.classList.forEach(cls => allCssClasses.add(cls));
            Array.from(element.children).forEach(collectClasses);
          };
          collectClasses(svgEl);

          // Find SMIL animation elements
          const smilTags = ['animate', 'animateTransform', 'animateMotion', 'animateColor', 'set'];
          const smilElements: string[] = [];
          smilTags.forEach(tag => {
            svgEl.querySelectorAll(tag).forEach(animEl => {
              smilElements.push(animEl.outerHTML);
            });
          });

          svgs.push({
            index,
            svg: svgEl.outerHTML,
            viewBox: svgEl.getAttribute('viewBox') || undefined,
            width: svgEl.getAttribute('width') || undefined,
            height: svgEl.getAttribute('height') || undefined,
            hasSmilAnimations: smilElements.length > 0,
            smilElements,
            cssClasses: Array.from(svgEl.classList),
            inlineStyles: svgEl.getAttribute('style') || undefined,
          });
        });

        // Extract related CSS rules and keyframes
        const relatedKeyframes: string[] = [];
        const relatedCssRules: string[] = [];

        if (extractAnimations) {
          const classSelectors = Array.from(allCssClasses).map(c => `.${c}`);

          Array.from(document.styleSheets).forEach(sheet => {
            try {
              const rules = sheet.cssRules || sheet.rules;
              Array.from(rules).forEach(rule => {
                const ruleText = rule.cssText;

                // Capture keyframes
                if (rule instanceof CSSKeyframesRule) {
                  // Check if any SVG class references this animation
                  const animName = rule.name;
                  let isRelevant = false;

                  // Check if animation is used by any of our classes
                  Array.from(rules).forEach(r => {
                    if (r instanceof CSSStyleRule) {
                      const style = r.style;
                      if (
                        style.animationName?.includes(animName) ||
                        style.animation?.includes(animName)
                      ) {
                        if (classSelectors.some(sel => r.selectorText.includes(sel))) {
                          isRelevant = true;
                        }
                      }
                    }
                  });

                  if (isRelevant) {
                    relatedKeyframes.push(ruleText);
                  }
                }

                // Capture CSS rules for SVG classes
                if (rule instanceof CSSStyleRule) {
                  const selectorText = rule.selectorText;
                  if (
                    classSelectors.some(sel => selectorText.includes(sel)) ||
                    selectorText.includes('svg') ||
                    selectorText.includes('path') ||
                    selectorText.includes('circle') ||
                    selectorText.includes('rect') ||
                    selectorText.includes('line') ||
                    selectorText.includes('polygon') ||
                    selectorText.includes('polyline') ||
                    selectorText.includes('ellipse')
                  ) {
                    relatedCssRules.push(ruleText);
                  }
                }
              });
            } catch {
              // Cross-origin stylesheets will throw
            }
          });
        }

        return {
          url: window.location.href,
          selector,
          count: svgs.length,
          svgs,
          relatedKeyframes,
          relatedCssRules,
          timestamp: new Date().toISOString(),
        } as SvgExtractionResult;
      },
      { selector, extractAnimations }
    );

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
