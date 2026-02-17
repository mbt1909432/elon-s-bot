// Acontext SDK Client Wrapper - Using official @acontext/acontext SDK
// Refactored to use Acontext as primary message storage

import { AcontextClient as OfficialAcontextClient } from '@acontext/acontext';
import type {
  ChatMessage,
  SessionWithDisk,
  GetMessagesOptions,
  ArtifactInfo,
} from '@/lib/types/acontext';

export class AcontextClient {
  private client: OfficialAcontextClient;

  constructor() {
    const apiKey = process.env.ACONTEXT_API_KEY;
    if (!apiKey) {
      throw new Error('ACONTEXT_API_KEY environment variable is required');
    }
    this.client = new OfficialAcontextClient({ apiKey });
    console.log('[Acontext] Client initialized');
  }

  // Get the raw official client (for DISK_TOOLS and SANDBOX_TOOLS)
  getRawClient(): OfficialAcontextClient {
    return this.client;
  }

  // Test connection
  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      console.log('[Acontext] Ping result:', result);
      return true;
    } catch (error) {
      console.error('[Acontext] Ping failed:', error);
      return false;
    }
  }

  // ==========================================
  // Session Management with 1:1:1 Binding
  // ==========================================

  /**
   * Create a session with its own disk (1:1:1 binding)
   * Each session MUST have its own disk - never share disks between sessions!
   */
  async createSessionWithDisk(user: string): Promise<SessionWithDisk> {
    console.log('[Acontext] Creating session with disk for user:', user);

    try {
      // Create session
      const session = await this.client.sessions.create({ user });
      console.log('[Acontext] Session created:', session.id);

      // Create dedicated disk for this session (1:1 binding)
      const disk = await this.client.disks.create();
      console.log('[Acontext] Disk created:', disk.id);

      return {
        sessionId: session.id,
        diskId: disk.id,
      };
    } catch (error) {
      console.error('[Acontext] Failed to create session with disk:', error);
      throw error;
    }
  }

  // Legacy method for backward compatibility
  async createSession(userEmail: string): Promise<{ id: string; diskId: string; createdAt: string; expiresAt: string }> {
    const { sessionId, diskId } = await this.createSessionWithDisk(userEmail);
    return {
      id: sessionId,
      diskId,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
  }

  // ==========================================
  // Message Storage (Primary Storage Layer)
  // ==========================================

  /**
   * Store a message to the session
   * Supports all message types including tool_calls and tool responses
   */
  async storeMessage(sessionId: string, message: ChatMessage): Promise<void> {
    console.log('[Acontext] Storing message:', {
      sessionId,
      role: message.role,
      hasToolCalls: !!message.tool_calls,
      toolCallId: message.tool_call_id,
    });

    try {
      // Use OpenAI format for message storage
      await this.client.sessions.storeMessage(
        sessionId,
        message as unknown as Record<string, unknown>,
        { format: 'openai' }
      );
      console.log('[Acontext] Message stored successfully');
    } catch (error) {
      console.error('[Acontext] Failed to store message:', error);
      // Don't throw - log and continue to avoid breaking the chat flow
    }
  }

  /**
   * Get messages from session with optional compression
   */
  async getMessages(sessionId: string, options?: GetMessagesOptions): Promise<ChatMessage[]> {
    console.log('[Acontext] Getting messages for session:', sessionId, {
      hasEditStrategies: !!options?.editStrategies?.length,
    });

    try {
      const result = await this.client.sessions.getMessages(sessionId, {
        format: 'openai',
        editStrategies: options?.editStrategies,
      });

      const messages = (result?.items || []) as unknown as ChatMessage[];
      console.log('[Acontext] Retrieved messages:', messages.length);
      return messages;
    } catch (error) {
      console.error('[Acontext] Failed to get messages:', error);
      return [];
    }
  }

  /**
   * Get token counts for a session
   * Used to decide when to apply compression
   */
  async getTokenCounts(sessionId: string): Promise<number> {
    console.log('[Acontext] Getting token counts for session:', sessionId);

    try {
      const result = await this.client.sessions.getTokenCounts(sessionId);
      const totalTokens = result?.total_tokens || 0;
      console.log('[Acontext] Token count:', totalTokens);
      return totalTokens;
    } catch (error) {
      console.error('[Acontext] Failed to get token counts:', error);
      return 0;
    }
  }

  // ==========================================
  // Session Info
  // ==========================================

  async getSession(sessionId: string): Promise<{ id: string; diskId: string; createdAt: string; expiresAt: string } | null> {
    console.log('[Acontext] Getting session:', sessionId);
    return {
      id: sessionId,
      diskId: '', // Disk ID is stored in Supabase conversations table
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    console.log('[Acontext] Deleting session:', sessionId);
    try {
      await this.client.sessions.delete(sessionId);
      return true;
    } catch (error) {
      console.error('[Acontext] Failed to delete session:', error);
      return false;
    }
  }

  // ==========================================
  // Disk Operations
  // ==========================================

  async createDisk(_sessionId: string, _name?: string): Promise<{ diskId: string }> {
    // Use createSessionWithDisk instead for proper 1:1:1 binding
    const disk = await this.client.disks.create();
    return { diskId: disk.id };
  }

  async listFiles(diskId: string, path: string = '/'): Promise<Array<{
    name: string;
    path: string;
    type: 'file' | 'directory';
    size?: number;
    mimeType?: string;
  }>> {
    console.log('[Acontext] Listing files:', { diskId, path });

    try {
      const result = await this.client.disks.artifacts.list(diskId, { path });
      const artifacts = result?.artifacts || [];

      return artifacts.map(a => ({
        name: a.filename || '',
        path: a.path || '',
        type: 'file' as 'file' | 'directory',
      }));
    } catch (error) {
      console.error('[Acontext] Failed to list files:', error);
      return [];
    }
  }

  async readFile(diskId: string, path: string): Promise<string | null> {
    console.log('[Acontext] Reading file:', { diskId, path });

    try {
      const filename = path.split('/').pop() || path;
      const result = await this.client.disks.artifacts.get(diskId, {
        filePath: path,
        filename,
        withContent: true,
      });

      return result?.content?.raw || null;
    } catch (error) {
      console.error('[Acontext] Failed to read file:', error);
      return null;
    }
  }

  async writeFile(
    diskId: string,
    path: string,
    content: string,
    mimeType?: string
  ): Promise<boolean> {
    console.log('[Acontext] Writing file:', { diskId, path, mimeType });

    try {
      // Create a buffer from content
      const buffer = Buffer.from(content, 'utf-8');

      await this.client.disks.artifacts.upsert(diskId, {
        file: [path, buffer, mimeType || 'text/plain'],
        filePath: path,
      });

      return true;
    } catch (error) {
      console.error('[Acontext] Failed to write file:', error);
      return false;
    }
  }

  async deleteFile(diskId: string, path: string): Promise<boolean> {
    console.log('[Acontext] Deleting file:', { diskId, path });

    try {
      const filename = path.split('/').pop() || path;
      await this.client.disks.artifacts.delete(diskId, {
        filePath: path,
        filename,
      });
      return true;
    } catch (error) {
      console.error('[Acontext] Failed to delete file:', error);
      return false;
    }
  }

  async getFileUrl(diskId: string, path: string): Promise<string | null> {
    console.log('[Acontext] Getting file URL:', { diskId, path });

    try {
      const filename = path.split('/').pop() || path;
      const result = await this.client.disks.artifacts.get(diskId, {
        filePath: path,
        filename,
        withPublicUrl: true,
      });
      return result?.public_url || null;
    } catch (error) {
      console.error('[Acontext] Failed to get file URL:', error);
      return null;
    }
  }

  async getArtifactInfo(diskId: string, path: string): Promise<ArtifactInfo | null> {
    console.log('[Acontext] Getting artifact info:', { diskId, path });

    try {
      const filename = path.split('/').pop() || path;
      const result = await this.client.disks.artifacts.get(diskId, {
        filePath: path,
        filename,
        withPublicUrl: true,
      });

      return {
        path,
        filename: result?.artifact?.filename || filename,
        public_url: result?.public_url || undefined,
      };
    } catch (error) {
      console.error('[Acontext] Failed to get artifact info:', error);
      return null;
    }
  }

  // ==========================================
  // Sandbox Execution
  // ==========================================

  async executePython(
    diskId: string,
    code: string,
    options?: {
      timeout?: number;
      files?: Record<string, string>;
    }
  ): Promise<{
    success: boolean;
    stdout: string;
    stderr: string;
    result?: unknown;
    files?: Record<string, string>;
  }> {
    console.log('[Acontext] Executing Python:', { diskId, codeLength: code.length });

    try {
      // Create a sandbox for execution
      const sandbox = await this.client.sandboxes.create();
      console.log('[Acontext] Sandbox created:', sandbox.sandbox_id);

      // Write the Python code to a file and execute it
      const pythonFile = '/tmp/script.py';
      const writeCommand = `cat > ${pythonFile} << 'PYTHON_EOF'\n${code}\nPYTHON_EOF`;

      // Write code to file
      await this.client.sandboxes.execCommand({
        sandboxId: sandbox.sandbox_id,
        command: writeCommand,
        timeout: 10000,
      });

      // Execute Python
      const result = await this.client.sandboxes.execCommand({
        sandboxId: sandbox.sandbox_id,
        command: `python3 ${pythonFile}`,
        timeout: options?.timeout || 30000,
      });

      // Get list of generated files from disk
      let generatedFiles: Record<string, string> = {};
      try {
        const artifacts = await this.client.disks.artifacts.list(diskId);
        if (artifacts?.artifacts) {
          for (const artifact of artifacts.artifacts) {
            if (artifact.path && artifact.filename) {
              generatedFiles[artifact.filename] = artifact.path;
            }
          }
        }
      } catch {
        // Ignore file listing errors
      }

      // Clean up sandbox
      try {
        await this.client.sandboxes.kill(sandbox.sandbox_id);
        console.log('[Acontext] Sandbox killed:', sandbox.sandbox_id);
      } catch {
        // Ignore cleanup errors
      }

      const success = result?.exit_code === 0;

      return {
        success,
        stdout: result?.stdout || '',
        stderr: result?.stderr || '',
        files: Object.keys(generatedFiles).length > 0 ? generatedFiles : undefined,
      };
    } catch (error) {
      console.error('[Acontext] Python execution failed:', error);
      return {
        success: false,
        stdout: '',
        stderr: error instanceof Error ? error.message : 'Python execution failed',
      };
    }
  }
}

// Singleton instance
let acontextClient: AcontextClient | null = null;

export function getAcontextClient(): AcontextClient {
  if (!acontextClient) {
    acontextClient = new AcontextClient();
  }
  return acontextClient;
}

// Re-export types
export type { ChatMessage, SessionWithDisk, GetMessagesOptions };
