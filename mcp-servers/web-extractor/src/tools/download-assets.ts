import { chromium, type Browser } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, basename, extname } from 'path';

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
    });
  }
  return browser;
}

interface AssetInfo {
  url: string;
  type: 'image' | 'font' | 'icon' | 'other';
  filename: string;
  savedPath?: string;
  error?: string;
}

interface DownloadResult {
  url: string;
  outputDir: string;
  assets: AssetInfo[];
  downloaded: number;
  failed: number;
  timestamp: string;
}

function getAssetType(url: string): 'image' | 'font' | 'icon' | 'other' {
  const ext = extname(url).toLowerCase().split('?')[0];

  const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.bmp', '.ico'];
  const fontExts = ['.woff', '.woff2', '.ttf', '.otf', '.eot'];
  const iconExts = ['.ico', '.svg'];

  if (iconExts.includes(ext) && (url.includes('icon') || url.includes('favicon'))) {
    return 'icon';
  }
  if (imageExts.includes(ext)) return 'image';
  if (fontExts.includes(ext)) return 'font';
  return 'other';
}

function sanitizeFilename(url: string): string {
  const urlObj = new URL(url);
  let filename = basename(urlObj.pathname);

  // Handle empty or root paths
  if (!filename || filename === '/') {
    filename = 'asset_' + Date.now();
  }

  // Remove query strings from filename
  filename = filename.split('?')[0];

  // Sanitize
  filename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');

  // Ensure extension
  if (!extname(filename)) {
    filename += '.bin';
  }

  return filename;
}

export async function downloadAssets(args: {
  url: string;
  assetTypes?: string[];
  outputDir: string;
  selector?: string;
}): Promise<string> {
  const { url, assetTypes = ['images'], outputDir, selector } = args;

  const browser = await getBrowser();
  const page = await browser.newPage();

  const downloadAll = assetTypes.includes('all');
  const downloadImages = downloadAll || assetTypes.includes('images');
  const downloadFonts = downloadAll || assetTypes.includes('fonts');
  const downloadIcons = downloadAll || assetTypes.includes('icons');

  try {
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    // Collect asset URLs from the page
    const assetUrls = await page.evaluate(
      ({ selector, downloadImages, downloadFonts, downloadIcons }) => {
        const urls = new Set<string>();
        const baseUrl = window.location.origin;

        const resolveUrl = (src: string): string => {
          if (src.startsWith('data:')) return '';
          if (src.startsWith('//')) return window.location.protocol + src;
          if (src.startsWith('/')) return baseUrl + src;
          if (src.startsWith('http')) return src;
          return new URL(src, window.location.href).href;
        };

        const scopeEl = selector ? document.querySelector(selector) : document;
        if (!scopeEl) return [];

        // Images
        if (downloadImages) {
          scopeEl.querySelectorAll('img').forEach(img => {
            if (img.src) urls.add(resolveUrl(img.src));
            if (img.srcset) {
              img.srcset.split(',').forEach(src => {
                const url = src.trim().split(' ')[0];
                if (url) urls.add(resolveUrl(url));
              });
            }
          });

          // Background images in inline styles
          scopeEl.querySelectorAll('[style*="background"]').forEach(el => {
            const style = (el as HTMLElement).style.backgroundImage;
            const match = style.match(/url\(['"]?([^'")\s]+)['"]?\)/);
            if (match && match[1]) {
              urls.add(resolveUrl(match[1]));
            }
          });

          // SVG images
          scopeEl.querySelectorAll('svg image').forEach(img => {
            const href = img.getAttribute('href') || img.getAttribute('xlink:href');
            if (href) urls.add(resolveUrl(href));
          });
        }

        // Icons
        if (downloadIcons) {
          document.querySelectorAll('link[rel*="icon"]').forEach(link => {
            const href = (link as HTMLLinkElement).href;
            if (href) urls.add(resolveUrl(href));
          });
        }

        // Fonts (from @font-face in stylesheets)
        if (downloadFonts) {
          Array.from(document.styleSheets).forEach(sheet => {
            try {
              Array.from(sheet.cssRules || []).forEach(rule => {
                if (rule instanceof CSSFontFaceRule) {
                  const src = rule.style.getPropertyValue('src');
                  const urlMatches = src.matchAll(/url\(['"]?([^'")\s]+)['"]?\)/g);
                  for (const match of urlMatches) {
                    if (match[1] && !match[1].startsWith('data:')) {
                      urls.add(resolveUrl(match[1]));
                    }
                  }
                }
              });
            } catch {
              // Cross-origin stylesheet
            }
          });
        }

        return Array.from(urls).filter(u => u && !u.startsWith('data:'));
      },
      { selector, downloadImages, downloadFonts, downloadIcons }
    );

    // Create output directory
    const fullOutputDir = join(process.cwd(), outputDir);
    if (!existsSync(fullOutputDir)) {
      mkdirSync(fullOutputDir, { recursive: true });
    }

    // Download each asset
    const assets: AssetInfo[] = [];
    let downloaded = 0;
    let failed = 0;

    for (const assetUrl of assetUrls) {
      const assetType = getAssetType(assetUrl);

      // Skip if type not requested
      if (
        (assetType === 'image' && !downloadImages) ||
        (assetType === 'font' && !downloadFonts) ||
        (assetType === 'icon' && !downloadIcons)
      ) {
        continue;
      }

      const filename = sanitizeFilename(assetUrl);
      const savePath = join(fullOutputDir, filename);

      const assetInfo: AssetInfo = {
        url: assetUrl,
        type: assetType,
        filename,
      };

      try {
        const response = await page.evaluate(async (url) => {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buffer = await res.arrayBuffer();
          return Array.from(new Uint8Array(buffer));
        }, assetUrl);

        writeFileSync(savePath, Buffer.from(response));
        assetInfo.savedPath = savePath;
        downloaded++;
      } catch (error) {
        assetInfo.error = error instanceof Error ? error.message : String(error);
        failed++;
      }

      assets.push(assetInfo);
    }

    const result: DownloadResult = {
      url,
      outputDir: fullOutputDir,
      assets,
      downloaded,
      failed,
      timestamp: new Date().toISOString(),
    };

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
