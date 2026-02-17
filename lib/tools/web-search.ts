// Web Search Tool using Brave Search API

import type { ToolDefinition, ToolResult } from '@/lib/types';
import { getSearchConfig, hasSearchConfig } from '@/lib/acontext/config';

interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
}

interface BraveSearchResponse {
  web?: {
    results: BraveSearchResult[];
  };
  error?: string;
}

export const WEB_SEARCH_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'web_search',
    description: 'Search the web for current information. Returns relevant search results with titles, URLs, and descriptions.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query',
        },
        count: {
          type: 'number',
          description: 'Number of results to return (default: 5, max: 10)',
        },
      },
      required: ['query'],
    },
  },
};

export function isSearchAvailable(): boolean {
  return hasSearchConfig();
}

export async function executeWebSearch(
  args: Record<string, unknown>
): Promise<ToolResult> {
  const config = getSearchConfig();

  if (!config.braveApiKey) {
    return {
      success: false,
      output: null,
      error: 'Web search is not configured. Please add BRAVE_SEARCH_API_KEY to your environment variables.',
    };
  }

  const query = args.query as string;

  if (!query) {
    return {
      success: false,
      output: null,
      error: 'Query is required',
    };
  }

  const count = Math.min((args.count as number) || 5, 10);

  try {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`,
      {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': config.braveApiKey,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        output: null,
        error: `Search API error: ${response.status} - ${errorText}`,
      };
    }

    const data: BraveSearchResponse = await response.json();

    if (data.error) {
      return {
        success: false,
        output: null,
        error: data.error,
      };
    }

    const results = data.web?.results || [];

    return {
      success: true,
      output: {
        query,
        results: results.map(r => ({
          title: r.title,
          url: r.url,
          description: r.description,
        })),
        count: results.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      output: null,
      error: error instanceof Error ? error.message : 'Search failed',
    };
  }
}

// Format search results for display
export function formatSearchResults(result: ToolResult): string {
  if (!result.success) {
    return `Search failed: ${result.error}`;
  }

  const output = result.output as {
    query: string;
    results: Array<{ title: string; url: string; description: string }>;
    count: number;
  };

  if (output.results.length === 0) {
    return `No results found for "${output.query}"`;
  }

  let formatted = `Found ${output.count} results for "${output.query}":\n\n`;

  for (let i = 0; i < output.results.length; i++) {
    const r = output.results[i];
    formatted += `${i + 1}. **${r.title}**\n`;
    formatted += `   ${r.url}\n`;
    formatted += `   ${r.description}\n\n`;
  }

  return formatted;
}
