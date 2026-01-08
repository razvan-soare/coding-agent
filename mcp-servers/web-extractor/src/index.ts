#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

import { fetchPage } from './tools/fetch-page.js';
import { extractElements } from './tools/extract-elements.js';
import { extractSvg } from './tools/extract-svg.js';
import { extractStyles } from './tools/extract-styles.js';
import { downloadAssets } from './tools/download-assets.js';

const tools: Tool[] = [
  {
    name: 'web_fetch_page',
    description: 'Fetch a webpage and return its HTML content. Use this to get the full page source.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to fetch',
        },
        waitForSelector: {
          type: 'string',
          description: 'Optional CSS selector to wait for before capturing (for JS-rendered content)',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 30000)',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'web_extract_elements',
    description: 'Extract specific HTML elements from a webpage by CSS selector. Returns the element HTML and computed styles.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to fetch',
        },
        selector: {
          type: 'string',
          description: 'CSS selector to extract (e.g., ".hero-section", "#main-nav", "svg.logo")',
        },
        includeStyles: {
          type: 'boolean',
          description: 'Include computed styles for the elements (default: true)',
        },
        includeChildren: {
          type: 'boolean',
          description: 'Include child elements (default: true)',
        },
      },
      required: ['url', 'selector'],
    },
  },
  {
    name: 'web_extract_svg',
    description: 'Extract SVG elements including embedded animations (SMIL, CSS animations, keyframes). Perfect for copying animated graphics.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to fetch',
        },
        selector: {
          type: 'string',
          description: 'CSS selector for SVG container (default: "svg")',
        },
        extractAnimations: {
          type: 'boolean',
          description: 'Extract CSS animations and keyframes associated with the SVG (default: true)',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'web_extract_styles',
    description: 'Extract CSS styles including animations and keyframes from a webpage. Can filter to specific selectors.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to fetch',
        },
        includeExternalSheets: {
          type: 'boolean',
          description: 'Fetch and include external stylesheets (default: true)',
        },
        filterSelectors: {
          type: 'array',
          items: { type: 'string' },
          description: 'Only include styles matching these patterns (e.g., [".hero", "@keyframes", ":hover"])',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'web_download_assets',
    description: 'Download images, fonts, and other assets from a webpage to a local directory.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to fetch',
        },
        assetTypes: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['images', 'fonts', 'icons', 'all'],
          },
          description: 'Types of assets to download (default: ["images"])',
        },
        outputDir: {
          type: 'string',
          description: 'Directory to save assets (relative to current working directory)',
        },
        selector: {
          type: 'string',
          description: 'Only download assets from elements matching this selector',
        },
      },
      required: ['url', 'outputDir'],
    },
  },
];

const server = new Server(
  {
    name: 'web-extractor',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: string;

    switch (name) {
      case 'web_fetch_page':
        result = await fetchPage(args as {
          url: string;
          waitForSelector?: string;
          timeout?: number;
        });
        break;

      case 'web_extract_elements':
        result = await extractElements(args as {
          url: string;
          selector: string;
          includeStyles?: boolean;
          includeChildren?: boolean;
        });
        break;

      case 'web_extract_svg':
        result = await extractSvg(args as {
          url: string;
          selector?: string;
          extractAnimations?: boolean;
        });
        break;

      case 'web_extract_styles':
        result = await extractStyles(args as {
          url: string;
          includeExternalSheets?: boolean;
          filterSelectors?: string[];
        });
        break;

      case 'web_download_assets':
        result = await downloadAssets(args as {
          url: string;
          assetTypes?: string[];
          outputDir: string;
          selector?: string;
        });
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [{ type: 'text', text: result }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Web Extractor MCP server running on stdio');
}

main().catch(console.error);
