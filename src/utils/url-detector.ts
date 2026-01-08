/**
 * Utility for detecting web references in task descriptions
 * and determining the appropriate extraction action.
 */

export interface WebReference {
  url: string;
  action: 'copy' | 'replicate' | 'migrate' | 'reference' | 'extract';
  targetElement?: string;
  confidence: number;
}

// URL regex that matches http/https URLs
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;

// Domain regex that matches bare domain names (e.g., "soarerazvan.com", "example.co.uk")
const DOMAIN_REGEX = /\b(?:(?!-)[a-zA-Z0-9-]{1,63}(?<!-)\.)+(?:com|org|net|io|co|dev|app|me|info|biz|xyz|site|online|tech|blog|page|web|ai|uk|de|fr|nl|eu|us|ca|au)\b/gi;

// Action keywords that indicate the user wants to copy/extract something
const ACTION_PATTERNS: { pattern: RegExp; action: WebReference['action']; weight: number }[] = [
  { pattern: /\b(copy|copying|copies)\b/i, action: 'copy', weight: 1.0 },
  { pattern: /\b(replicate|replicating|clone|cloning)\b/i, action: 'replicate', weight: 1.0 },
  { pattern: /\b(migrate|migrating|migration|port|porting)\b/i, action: 'migrate', weight: 0.9 },
  { pattern: /\b(extract|extracting|grab|grabbing|pull)\b/i, action: 'extract', weight: 0.9 },
  { pattern: /\b(like|similar to|same as|inspired by)\b/i, action: 'reference', weight: 0.6 },
  { pattern: /\b(from|off of)\b/i, action: 'extract', weight: 0.5 },
  { pattern: /\b(look at|check out|see)\b/i, action: 'reference', weight: 0.3 },
];

// Element type keywords
const ELEMENT_PATTERNS: { pattern: RegExp; element: string }[] = [
  { pattern: /\b(svg|svgs)\b/i, element: 'SVG' },
  { pattern: /\b(animation|animations|animated)\b/i, element: 'animation' },
  { pattern: /\b(icon|icons)\b/i, element: 'icon' },
  { pattern: /\b(logo|logos)\b/i, element: 'logo' },
  { pattern: /\b(image|images|img|picture|pictures|photo|photos)\b/i, element: 'image' },
  { pattern: /\b(header|navbar|nav|navigation)\b/i, element: 'header' },
  { pattern: /\b(footer)\b/i, element: 'footer' },
  { pattern: /\b(button|buttons|btn)\b/i, element: 'button' },
  { pattern: /\b(card|cards)\b/i, element: 'card' },
  { pattern: /\b(hero|hero section|banner)\b/i, element: 'hero' },
  { pattern: /\b(style|styles|css|styling)\b/i, element: 'styles' },
  { pattern: /\b(font|fonts|typography)\b/i, element: 'font' },
  { pattern: /\b(color|colors|colour|colours|palette)\b/i, element: 'colors' },
  { pattern: /\b(layout|grid|structure)\b/i, element: 'layout' },
  { pattern: /\b(component|components|element|elements)\b/i, element: 'component' },
];

/**
 * Detects URLs and associated actions from a text description.
 * Returns an array of WebReference objects with detected URLs,
 * actions, and target elements.
 */
export function detectWebReferences(text: string): WebReference[] {
  const references: WebReference[] = [];

  // Find all full URLs in the text
  const fullUrls = text.match(URL_REGEX) || [];

  // Find bare domain names (e.g., "soarerazvan.com")
  const domains = text.match(DOMAIN_REGEX) || [];

  // Convert domains to URLs, avoiding duplicates with full URLs
  const urlSet = new Set<string>();

  for (const url of fullUrls) {
    const cleanUrl = url.replace(/[.,;:!?)\]]+$/, '');
    urlSet.add(cleanUrl);
  }

  for (const domain of domains) {
    // Check if this domain is already part of a full URL
    const isPartOfFullUrl = fullUrls.some(url => url.includes(domain));
    if (!isPartOfFullUrl) {
      urlSet.add(`https://${domain}`);
    }
  }

  const urls = Array.from(urlSet);

  if (urls.length === 0) {
    return references;
  }

  // Determine the primary action from the text
  let primaryAction: WebReference['action'] = 'reference';
  let maxWeight = 0;

  for (const { pattern, action, weight } of ACTION_PATTERNS) {
    if (pattern.test(text) && weight > maxWeight) {
      primaryAction = action;
      maxWeight = weight;
    }
  }

  // Detect target elements
  const targetElements: string[] = [];
  for (const { pattern, element } of ELEMENT_PATTERNS) {
    if (pattern.test(text)) {
      targetElements.push(element);
    }
  }

  // Calculate confidence based on action weight and element specificity
  const baseConfidence = maxWeight;
  const elementBonus = Math.min(targetElements.length * 0.1, 0.3);
  const confidence = Math.min(baseConfidence + elementBonus, 1.0);

  // Create references for each URL
  for (const url of urls) {
    references.push({
      url,
      action: primaryAction,
      targetElement: targetElements.length > 0 ? targetElements.join(', ') : undefined,
      confidence,
    });
  }

  return references;
}

/**
 * Checks if a text contains any web references that suggest
 * content extraction is needed.
 */
export function hasWebReferences(text: string): boolean {
  const refs = detectWebReferences(text);
  return refs.some(ref => ref.confidence >= 0.5);
}

/**
 * Generates prompt enhancement text for web extraction tasks.
 */
export function generateWebExtractionPrompt(references: WebReference[]): string {
  if (references.length === 0) return '';

  const urlList = references
    .map(ref => {
      let line = `- ${ref.url}`;
      if (ref.action !== 'reference') {
        line += ` (${ref.action}`;
        if (ref.targetElement) {
          line += `: ${ref.targetElement}`;
        }
        line += ')';
      }
      return line;
    })
    .join('\n');

  return `[Web References Detected]
This task involves content from external websites:
${urlList}

Available extraction tools:
1. web_fetch_page - Fetch full page HTML (with JavaScript rendering)
2. web_extract_elements - Extract specific elements by CSS selector
3. web_extract_svg - Extract SVGs with animations (SMIL + CSS)
4. web_extract_styles - Extract CSS including keyframes and media queries
5. web_download_assets - Download images, fonts, and icons to local directory

WORKFLOW FOR WEB EXTRACTION:
1. FIRST: Use web_fetch_page to get the full page and understand its structure
2. EXPLORE: Look through the HTML to find the element(s) you need to extract
   - Search for SVGs, animations, specific components mentioned in the task
   - If the element isn't obvious, try common selectors: svg, .logo, .hero, header, etc.
3. EXTRACT: Once located, use the specific extraction tools:
   - web_extract_svg for SVG graphics and animations
   - web_extract_elements for HTML components
   - web_extract_styles for CSS rules and keyframes
4. ANALYZE: Study the extracted code to understand how it works
   - Note animation keyframes, timing, and effects
   - Identify any dependencies (fonts, images, external resources)
5. RECREATE: Build the element from scratch in the project
   - Do NOT just copy-paste - adapt to project conventions
   - Implement animations using the extracted keyframes as reference
   - Use modern CSS/React patterns appropriate for the project
6. DOWNLOAD: Use web_download_assets for any required images/fonts

CRITICAL INSTRUCTIONS:
- You MUST actually fetch and analyze the website content - do not assume or guess
- If previous attempts exist, IGNORE them and start fresh from the source website
- Actually extract and read the SVG/animation code from the website
- Recreate the animation faithfully - match timing, easing, and visual effect
- Test that animations work correctly in the project context
`;
}
