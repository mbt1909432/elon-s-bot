/**
 * Cron Trigger Edge Function
 * Triggered on a schedule to execute pending cron jobs
 * Should be called by a scheduler (e.g., pg_cron, external cron service)
 */

import { corsHeaders, errorResponse, jsonResponse, log } from '../_shared/channel-utils.ts';

// Environment variables
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// LLM config
const LLM_ENDPOINT = Deno.env.get('LLM_ENDPOINT') || 'https://openrouter.ai/api/v1';
const LLM_API_KEY = Deno.env.get('LLM_API_KEY') || Deno.env.get('OPENROUTER_API_KEY') || '';
const LLM_MODEL = Deno.env.get('LLM_MODEL') || 'anthropic/claude-sonnet-4';

/**
 * Get due cron jobs
 */
async function getDueJobs(): Promise<Record<string, unknown>[]> {
  const now = new Date().toISOString();

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/cron_jobs?enabled=eq.true&next_run_at=lte.${now}&select=*`,
    {
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        apikey: SUPABASE_SERVICE_KEY,
      },
    }
  );

  if (!response.ok) {
    log('Failed to fetch due jobs:', await response.text());
    return [];
  }

  return await response.json();
}

/**
 * Mark job as executed
 */
async function markJobExecuted(
  jobId: string,
  status: 'success' | 'failed' | 'skipped',
  result?: string
): Promise<void> {
  // Get current job to calculate next run
  const jobResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/cron_jobs?id=eq.${jobId}&select=*`,
    {
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        apikey: SUPABASE_SERVICE_KEY,
      },
    }
  );

  if (!jobResponse.ok) return;

  const jobs = await jobResponse.json();
  const job = jobs[0];
  if (!job) return;

  // Calculate next run time
  let nextRunAt: string | null = null;

  if (job.schedule_type !== 'once') {
    nextRunAt = calculateNextRun(
      job.schedule_type,
      job.schedule_expr,
      new Date()
    )?.toISOString();

    // Check max runs
    if (job.max_runs && job.run_count + 1 >= job.max_runs) {
      // Disable job after max runs reached
      await fetch(`${SUPABASE_URL}/rest/v1/cron_jobs?id=eq.${jobId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          apikey: SUPABASE_SERVICE_KEY,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          enabled: false,
          last_run_at: new Date().toISOString(),
          last_status: status,
          last_result: result,
          run_count: job.run_count + 1,
        }),
      });
      return;
    }
  }

  // Update job
  await fetch(`${SUPABASE_URL}/rest/v1/cron_jobs?id=eq.${jobId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      apikey: SUPABASE_SERVICE_KEY,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      last_run_at: new Date().toISOString(),
      last_status: status,
      last_result: result,
      run_count: job.run_count + 1,
      next_run_at: nextRunAt,
    }),
  });
}

/**
 * Calculate next run time
 */
function calculateNextRun(
  scheduleType: string,
  scheduleExpr: string,
  from: Date
): Date | null {
  switch (scheduleType) {
    case 'interval':
      // Parse interval (e.g., "1h", "30m", "1d")
      const match = scheduleExpr.match(/^(\d+)([mhdw])$/);
      if (!match) return null;

      const amount = parseInt(match[1]);
      const unit = match[2];

      const next = new Date(from);
      switch (unit) {
        case 'm':
          next.setMinutes(next.getMinutes() + amount);
          break;
        case 'h':
          next.setHours(next.getHours() + amount);
          break;
        case 'd':
          next.setDate(next.getDate() + amount);
          break;
        case 'w':
          next.setDate(next.getDate() + amount * 7);
          break;
      }
      return next;

    case 'cron':
      // Simplified cron parsing (assume hourly if we can't parse)
      const nextHour = new Date(from);
      nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
      return nextHour;

    case 'once':
    default:
      return null;
  }
}

/**
 * Execute a cron job
 */
async function executeJob(job: Record<string, unknown>): Promise<{ status: string; result?: string }> {
  try {
    // Call LLM to process the message
    const response = await fetch(`${LLM_ENDPOINT}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are a scheduled task executor. Execute the requested task and provide a result.',
          },
          { role: 'user', content: job.message as string },
        ],
        max_tokens: 2048,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      return { status: 'failed', result: `LLM request failed: ${response.statusText}` };
    }

    const data = await response.json();
    const result = data.choices?.[0]?.message?.content || 'No result';

    // If there's a channel, send the result there
    if (job.channel_id) {
      await sendToChannel(
        job.channel_id as string,
        `⏰ Scheduled task "${job.name}":\n\n${result}`
      );
    }

    return { status: 'success', result };
  } catch (error) {
    return {
      status: 'failed',
      result: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Send result to a channel
 */
async function sendToChannel(channelId: string, message: string): Promise<void> {
  // Get channel info
  const channelResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/channels?id=eq.${channelId}&select=*`,
    {
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        apikey: SUPABASE_SERVICE_KEY,
      },
    }
  );

  if (!channelResponse.ok) return;

  const channels = await channelResponse.json();
  const channel = channels[0];
  if (!channel) return;

  // Send based on platform
  const platform = channel.platform;
  const chatId = channel.platform_chat_id;

  if (platform === 'telegram') {
    const botToken = channel.config?.telegramBotToken || Deno.env.get('TELEGRAM_BOT_TOKEN');
    if (botToken) {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message.slice(0, 4000),
          parse_mode: 'HTML',
        }),
      });
    }
  }
  // Add other platforms as needed
}

/**
 * Main handler
 */
Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Accept both GET (from cron) and POST (manual trigger)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    log('Cron trigger started');

    // Get due jobs
    const jobs = await getDueJobs();
    log(`Found ${jobs.length} due jobs`);

    if (jobs.length === 0) {
      return jsonResponse({ message: 'No due jobs', processed: 0 });
    }

    // Process each job
    const results = [];
    for (const job of jobs) {
      log(`Processing job: ${job.name} (${job.id})`);

      try {
        const { status, result } = await executeJob(job);
        await markJobExecuted(job.id as string, status as 'success' | 'failed', result);

        results.push({
          jobId: job.id,
          name: job.name,
          status,
          result: result?.slice(0, 200),
        });

        log(`Job ${job.name} completed with status: ${status}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await markJobExecuted(job.id as string, 'failed', errorMessage);

        results.push({
          jobId: job.id,
          name: job.name,
          status: 'failed',
          error: errorMessage,
        });

        log(`Job ${job.name} failed:`, errorMessage);
      }
    }

    return jsonResponse({
      message: 'Cron trigger completed',
      processed: results.length,
      results,
    });
  } catch (error) {
    log('Error in cron trigger:', error);
    return errorResponse('Internal server error', 500);
  }
});
