/**
 * Acontext Sandbox Tool - Python Code Execution
 *
 * Executes Python code in Acontext Sandbox for data analysis and figure generation.
 * Uses matplotlib/seaborn for creating publication-quality charts.
 *
 * Key Features:
 * - Isolated Python environment (clean state each execution)
 * - Pre-installed: matplotlib, seaborn, pandas, numpy
 * - Automatic file upload/download to/from Disk
 * - Skill mounting support for domain-specific scripts
 * - Returns diskPath for frontend image rendering
 */

import type { AcontextClient } from './client';

// ============ Types ============

/**
 * Sandbox tool parameters
 */
export interface SandboxToolArgs {
  think: string;
  python_code: string;
  output_filename?: string;
}

/**
 * Sandbox tool result
 * IMPORTANT: Returns diskPath (not publicUrl) for frontend rendering
 */
export interface SandboxToolResult {
  success: boolean;
  /** Artifact path in Acontext Disk (e.g., "/figures/2026-02-17/figure.png") */
  artifactPath: string;
  /** Permanent reference with disk:: prefix for frontend Markdown rendering */
  diskPath: string;
  /** Python stdout output */
  stdout: string;
  /** Python stderr output */
  stderr: string;
  /** Error message if execution failed */
  error?: string;
}

/**
 * Sandbox execution context
 */
export interface SandboxContext {
  acontextClient: AcontextClient;
  diskId: string;
  /** Optional: Skill IDs to mount into sandbox */
  skillIds?: string[];
}

// ============ Tool Schema ============

/**
 * Tool name constant
 */
export const SANDBOX_TOOL_NAME = 'analyze_data' as const;

/**
 * Check if a tool name is the sandbox tool
 */
export function isSandboxToolName(name: string): name is typeof SANDBOX_TOOL_NAME {
  return name === SANDBOX_TOOL_NAME;
}

/**
 * Get OpenAI-compatible tool schema
 */
export function getSandboxToolSchema() {
  return {
    type: 'function' as const,
    function: {
      name: SANDBOX_TOOL_NAME,
      description:
        'Execute Python code in Acontext Sandbox to generate research figures from experimental data. ' +
        'The code must save the figure to /workspace/figure.png (or custom filename via output_filename). ' +
        'Results are saved as artifacts to the current Acontext Disk. ' +
        'IMPORTANT: Return ONLY the artifactPath. Do NOT output any presigned/public URLs. ' +
        'When mentioning a generated figure in your response, refer to it using the artifact path ' +
        "with a 'disk::' prefix (for example: disk::figures/2026-02-01/chart.png), not a URL.",
      parameters: {
        type: 'object' as const,
        properties: {
          think: {
            type: 'string' as const,
            description:
              "Briefly describe what figure you're generating (for logging and debugging). " +
              "Example: 'Generating a line chart showing temperature vs pressure with error bars'",
          },
          python_code: {
            type: 'string' as const,
            description:
              'Complete Python code that:\n' +
              '1. Imports necessary libraries (matplotlib, seaborn, pandas, numpy)\n' +
              '2. Defines or loads the data\n' +
              '3. Creates the figure using matplotlib/seaborn\n' +
              '4. Saves the figure to /workspace/figure.png (or output_filename if specified)\n' +
              '5. Prints success message\n\n' +
              'Important:\n' +
              "- Use matplotlib.use('Agg') for non-interactive backend\n" +
              '- Set dpi=300 or higher for publication quality\n' +
              "- Use bbox_inches='tight' to avoid clipping\n" +
              '- Include print() statements for debugging\n' +
              '- Save to /workspace/figure.png (default) or custom filename',
            minLength: 50,
            maxLength: 10000,
          },
          output_filename: {
            type: 'string' as const,
            description:
              "Optional: Custom output filename (e.g., 'temperature_plot.png'). " +
              "Defaults to 'figure.png'. Useful when generating multiple figures.",
          },
        },
        required: ['think', 'python_code'],
      },
    },
  };
}

// ============ Execution ============

/**
 * Execute Python code in Acontext Sandbox
 *
 * Flow:
 * 1. Write Python script to Disk
 * 2. Create new Sandbox container (clean state)
 * 3. Download script from Disk to Sandbox
 * 4. Mount skills if provided
 * 5. Install dependencies (seaborn, pandas)
 * 6. Execute Python code
 * 7. Upload generated figure from Sandbox to Disk
 * 8. Clean up Sandbox
 */
export async function executeSandboxTool(
  args: unknown,
  context: SandboxContext
): Promise<SandboxToolResult> {
  // Validate arguments
  const validated = args as SandboxToolArgs;
  const { think, python_code, output_filename = 'figure.png' } = validated;

  if (!think || !python_code) {
    return {
      success: false,
      artifactPath: '',
      diskPath: '',
      stdout: '',
      stderr: '',
      error: 'Missing required arguments: think and python_code',
    };
  }

  const timestamp = Date.now();
  const dateStr = new Date().toISOString().split('T')[0];

  console.log('[Sandbox] Starting execution', {
    think,
    output_filename,
    code_length: python_code.length,
    diskId: context.diskId,
    skillIds: context.skillIds,
  });

  const { acontextClient, diskId, skillIds } = context;
  const rawClient = acontextClient.getRawClient();
  let sandbox: { sandbox_id: string } | null = null;

  try {
    // 1. Write Python script to Disk
    const scriptFilename = `script_${timestamp}.py`;
    const scriptPath = `/scripts/${dateStr}/`;
    const scriptBuffer = Buffer.from(python_code, 'utf-8');

    await rawClient.disks.artifacts.upsert(diskId, {
      file: [scriptFilename, scriptBuffer, 'text/x-python'],
      filePath: scriptPath,
    });

    console.log('[Sandbox] Script uploaded to disk');

    // 2. Create new Sandbox container (clean state)
    sandbox = await rawClient.sandboxes.create();
    console.log('[Sandbox] Container created', { sandbox_id: sandbox.sandbox_id });

    // 3. Download script to Sandbox
    await rawClient.disks.artifacts.downloadToSandbox(diskId, {
      filePath: scriptPath,
      filename: scriptFilename,
      sandboxId: sandbox.sandbox_id,
      sandboxPath: '/workspace/',
    });

    console.log('[Sandbox] Script downloaded to container');

    // 4. Mount skills if provided
    if (skillIds && skillIds.length > 0) {
      for (const skillId of skillIds) {
        try {
          await rawClient.skills.downloadToSandbox(skillId, {
            sandboxId: sandbox.sandbox_id,
          });
          console.log('[Sandbox] Skill mounted', { skillId });
        } catch (skillError) {
          console.warn('[Sandbox] Failed to mount skill (non-critical)', {
            skillId,
            error: String(skillError),
          });
        }
      }
    }

    // 5. Install Python dependencies
    try {
      const installResult = await rawClient.sandboxes.execCommand({
        sandboxId: sandbox.sandbox_id,
        command: `pip3 install seaborn pandas --quiet 2>&1`,
        timeout: 120000,
      });

      if (installResult.exit_code !== 0) {
        console.warn('[Sandbox] Dependency installation warning', {
          stderr: installResult.stderr,
        });
      }
    } catch (installError) {
      console.warn('[Sandbox] Dependency installation failed (continuing)', {
        error: String(installError),
      });
    }

    // 6. Execute Python code
    const execResult = await rawClient.sandboxes.execCommand({
      sandboxId: sandbox.sandbox_id,
      command: `cd /workspace && python3 ${scriptFilename} 2>&1`,
      timeout: 60000,
    });

    console.log('[Sandbox] Python execution complete', {
      exit_code: execResult.exit_code,
      stdout_length: execResult.stdout?.length || 0,
      stderr_length: execResult.stderr?.length || 0,
    });

    // 7. Upload generated figure to Disk
    const artifactPath = `/figures/${dateStr}/${output_filename}`;

    await rawClient.disks.artifacts.uploadFromSandbox(diskId, {
      sandboxId: sandbox.sandbox_id,
      sandboxPath: '/workspace/',
      sandboxFilename: output_filename,
      filePath: `/figures/${dateStr}/`,
    });

    console.log('[Sandbox] Figure uploaded to disk', { artifactPath });

    // Build result with diskPath (not publicUrl)
    const result: SandboxToolResult = {
      success: execResult.exit_code === 0,
      artifactPath,
      diskPath: `disk::figures/${dateStr}/${output_filename}`,
      stdout: execResult.stdout || '',
      stderr: execResult.stderr || '',
      error: execResult.exit_code !== 0 ? execResult.stderr : undefined,
    };

    console.log('[Sandbox] Execution complete', {
      success: result.success,
      diskPath: result.diskPath,
    });

    return result;
  } catch (error) {
    console.error('[Sandbox] Execution failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      artifactPath: '',
      diskPath: '',
      stdout: '',
      stderr: '',
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    // 8. Clean up Sandbox
    if (sandbox) {
      try {
        await rawClient.sandboxes.kill(sandbox.sandbox_id);
        console.log('[Sandbox] Container cleaned up');
      } catch (cleanupError) {
        console.warn('[Sandbox] Cleanup failed (non-critical)', {
          error: String(cleanupError),
        });
      }
    }
  }
}
