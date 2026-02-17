// Acontext SDK Configuration

export interface AcontextConfig {
  apiKey: string;
  baseUrl: string;
}

export function getAcontextConfig(): AcontextConfig {
  const apiKey = process.env.ACONTEXT_API_KEY;
  const baseUrl = process.env.ACONTEXT_BASE_URL || 'https://api.acontext.app/api/v1';

  if (!apiKey) {
    throw new Error('ACONTEXT_API_KEY environment variable is required');
  }

  return {
    apiKey,
    baseUrl,
  };
}

export interface LLMConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  maxTokens: number;
}

export function getLLMConfig(): LLMConfig {
  const endpoint = process.env.OPENAI_LLM_ENDPOINT || 'https://api.openai-next.com/v1';
  const apiKey = process.env.OPENAI_LLM_API_KEY;
  const model = process.env.OPENAI_LLM_MODEL || 'claude-sonnet-4-20250514';
  const maxTokens = parseInt(process.env.OPENAI_LLM_MAX_TOKENS || '4096');

  if (!apiKey) {
    throw new Error('OPENAI_LLM_API_KEY environment variable is required');
  }

  return {
    endpoint,
    apiKey,
    model,
    maxTokens,
  };
}

export interface ImageGenConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function getImageGenConfig(): ImageGenConfig {
  const apiKey = process.env.IMAGE_GEN_API_KEY;
  const baseUrl = process.env.IMAGE_GEN_BASE_URL || 'https://api.openai-next.com';
  const model = process.env.IMAGE_GEN_DEFAULT_MODEL || 'gemini-3-pro-image-preview';

  return {
    apiKey: apiKey || '',
    baseUrl,
    model,
  };
}

export interface SearchConfig {
  braveApiKey: string;
}

export function getSearchConfig(): SearchConfig {
  const braveApiKey = process.env.BRAVE_SEARCH_API_KEY || '';

  // Web search is optional - will show warning if not configured
  return {
    braveApiKey,
  };
}

export function hasSearchConfig(): boolean {
  return !!process.env.BRAVE_SEARCH_API_KEY;
}

// Default system prompt for the agent
export const DEFAULT_SYSTEM_PROMPT = `You are ElonsBot, an intelligent AI assistant with powerful capabilities.

## Your Abilities

You have access to the following tools:
1. **Disk Operations** - Read, write, and manage files in your persistent workspace
2. **Python Execution** - Run Python code in a secure sandbox environment
${process.env.BRAVE_SEARCH_API_KEY ? '3. **Web Search** - Search the web for current information' : ''}

## Memory System

You maintain a structured memory system to remember important information about users:
- **Preferences**: User preferences and settings
- **Facts**: Important facts about the user
- **Instructions**: Standing instructions from the user
- **Events**: Scheduled events and reminders
- **Context**: Relevant contextual information

## Guidelines

1. Be helpful, accurate, and concise
2. Use tools when needed to accomplish tasks
3. Remember important information in your memory system
4. Be transparent about your capabilities and limitations
5. When using Python, always visualize results when appropriate (charts, graphs, etc.)

## File Operations

When working with files:
- Use the disk:// protocol to reference files: disk://filename
- Create files for persistent storage of data or outputs
- Images can be referenced and displayed from disk

Be proactive in helping users accomplish their goals efficiently.`;
