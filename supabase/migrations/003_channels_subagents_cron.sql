-- Migration: Add channels, subagents, and cron_jobs tables
-- Run this in Supabase SQL Editor

-- ============================================
-- Channels - Multi-platform integration
-- Stores connections to Telegram, Discord, Feishu, etc.
-- ============================================
CREATE TABLE IF NOT EXISTS channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('telegram', 'discord', 'feishu', 'web')),
  platform_user_id TEXT NOT NULL,  -- User's ID on the platform
  platform_chat_id TEXT NOT NULL,  -- Chat/Channel ID on the platform
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  config JSONB DEFAULT '{}',       -- Platform-specific config (tokens, etc.)
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(platform, platform_chat_id)
);

CREATE INDEX IF NOT EXISTS idx_channels_user ON channels(user_id);
CREATE INDEX IF NOT EXISTS idx_channels_platform ON channels(platform, platform_chat_id);
CREATE INDEX IF NOT EXISTS idx_channels_enabled ON channels(enabled);

-- ============================================
-- Subagents - Background task processing
-- ============================================
CREATE TABLE IF NOT EXISTS subagents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  task TEXT NOT NULL,
  label TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  result TEXT,
  error TEXT,
  progress INTEGER DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_subagents_user ON subagents(user_id);
CREATE INDEX IF NOT EXISTS idx_subagents_status ON subagents(status);
CREATE INDEX IF NOT EXISTS idx_subagents_conversation ON subagents(conversation_id);
CREATE INDEX IF NOT EXISTS idx_subagents_created_at ON subagents(created_at DESC);

-- ============================================
-- Cron Jobs - Scheduled tasks
-- ============================================
CREATE TABLE IF NOT EXISTS cron_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN DEFAULT true,
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('cron', 'interval', 'once')),
  schedule_expr TEXT NOT NULL,     -- Cron expression or interval (e.g., "0 9 * * *", "1h", "2024-12-25T09:00:00Z")
  message TEXT NOT NULL,           -- The message/prompt to execute
  channel_id UUID REFERENCES channels(id) ON DELETE SET NULL,  -- Optional: send result to this channel
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  last_status TEXT CHECK (last_status IN ('success', 'failed', 'skipped')),
  last_result TEXT,
  run_count INTEGER DEFAULT 0,
  max_runs INTEGER,                -- Optional: max number of executions
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cron_jobs_user ON cron_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled ON cron_jobs(enabled);
CREATE INDEX IF NOT EXISTS idx_cron_jobs_next_run ON cron_jobs(next_run_at) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_cron_jobs_channel ON cron_jobs(channel_id);

-- ============================================
-- MCP Servers - External tool ecosystem
-- ============================================
CREATE TABLE IF NOT EXISTS mcp_servers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  transport_type TEXT NOT NULL CHECK (transport_type IN ('stdio', 'http', 'sse')),
  command TEXT,                    -- For stdio transport
  args JSONB DEFAULT '[]',         -- For stdio transport
  env JSONB DEFAULT '{}',          -- Environment variables
  url TEXT,                        -- For http/sse transport
  enabled BOOLEAN DEFAULT true,
  last_connected_at TIMESTAMPTZ,
  status TEXT DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'error')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_mcp_servers_user ON mcp_servers(user_id);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled ON mcp_servers(enabled);

-- ============================================
-- MCP Tools - Cached discovered tools from MCP servers
-- ============================================
CREATE TABLE IF NOT EXISTS mcp_tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  description TEXT,
  input_schema JSONB DEFAULT '{}',
  enabled BOOLEAN DEFAULT true,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(server_id, tool_name)
);

CREATE INDEX IF NOT EXISTS idx_mcp_tools_server ON mcp_tools(server_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tools_name ON mcp_tools(tool_name);

-- ============================================
-- Row Level Security (RLS)
-- ============================================
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE subagents ENABLE ROW LEVEL SECURITY;
ALTER TABLE cron_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_tools ENABLE ROW LEVEL SECURITY;

-- Channels: Users can only access their own channels
CREATE POLICY "Users can view own channels" ON channels
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own channels" ON channels
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own channels" ON channels
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own channels" ON channels
  FOR DELETE USING (auth.uid() = user_id);

-- Subagents: Users can only access their own subagents
CREATE POLICY "Users can view own subagents" ON subagents
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own subagents" ON subagents
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own subagents" ON subagents
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own subagents" ON subagents
  FOR DELETE USING (auth.uid() = user_id);

-- Cron Jobs: Users can only access their own cron jobs
CREATE POLICY "Users can view own cron_jobs" ON cron_jobs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own cron_jobs" ON cron_jobs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own cron_jobs" ON cron_jobs
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own cron_jobs" ON cron_jobs
  FOR DELETE USING (auth.uid() = user_id);

-- MCP Servers: Users can only access their own MCP servers
CREATE POLICY "Users can view own mcp_servers" ON mcp_servers
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own mcp_servers" ON mcp_servers
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own mcp_servers" ON mcp_servers
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own mcp_servers" ON mcp_servers
  FOR DELETE USING (auth.uid() = user_id);

-- MCP Tools: Access through server ownership
CREATE POLICY "Users can view mcp_tools from own servers" ON mcp_tools
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM mcp_servers
      WHERE mcp_servers.id = mcp_tools.server_id
      AND mcp_servers.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create mcp_tools in own servers" ON mcp_tools
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM mcp_servers
      WHERE mcp_servers.id = mcp_tools.server_id
      AND mcp_servers.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update mcp_tools in own servers" ON mcp_tools
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM mcp_servers
      WHERE mcp_servers.id = mcp_tools.server_id
      AND mcp_servers.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete mcp_tools from own servers" ON mcp_tools
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM mcp_servers
      WHERE mcp_servers.id = mcp_tools.server_id
      AND mcp_servers.user_id = auth.uid()
    )
  );

-- ============================================
-- Updated_at Triggers
-- ============================================
CREATE TRIGGER update_channels_updated_at
  BEFORE UPDATE ON channels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cron_jobs_updated_at
  BEFORE UPDATE ON cron_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_mcp_servers_updated_at
  BEFORE UPDATE ON mcp_servers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Functions for Edge Functions (Service Role)
-- ============================================

-- Function to get or create channel session
CREATE OR REPLACE FUNCTION get_or_create_channel_session(
  p_platform TEXT,
  p_platform_user_id TEXT,
  p_platform_chat_id TEXT,
  p_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  channel_id UUID,
  conversation_id UUID,
  session_id TEXT,
  disk_id TEXT,
  is_new BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_channel channels%ROWTYPE;
  v_conversation_id UUID;
  v_session_id TEXT;
  v_disk_id TEXT;
  v_is_new BOOLEAN := false;
BEGIN
  -- Try to find existing channel
  SELECT * INTO v_channel
  FROM channels
  WHERE platform = p_platform
    AND platform_chat_id = p_platform_chat_id;

  IF FOUND THEN
    -- Get conversation details
    SELECT acontext_session_id, acontext_disk_id INTO v_session_id, v_disk_id
    FROM conversations
    WHERE id = v_channel.conversation_id;

    RETURN QUERY SELECT v_channel.id, v_channel.conversation_id, v_session_id, v_disk_id, false;
  ELSE
    -- Need to create new channel and conversation
    -- This requires a user_id
    IF p_user_id IS NULL THEN
      RAISE EXCEPTION 'User not found for channel %:%', p_platform, p_platform_chat_id;
    END IF;

    -- Create conversation
    INSERT INTO conversations (user_id, title, metadata)
    VALUES (
      p_user_id,
      p_platform || ' chat',
      jsonb_build_object('channel', p_platform, 'chat_id', p_platform_chat_id)
    )
    RETURNING id INTO v_conversation_id;

    -- Create channel
    INSERT INTO channels (user_id, platform, platform_user_id, platform_chat_id, conversation_id)
    VALUES (p_user_id, p_platform, p_platform_user_id, p_platform_chat_id, v_conversation_id)
    RETURNING * INTO v_channel;

    RETURN QUERY SELECT v_channel.id, v_conversation_id, NULL::TEXT, NULL::TEXT, true;
  END IF;
END;
$$;

-- Function to calculate next run time for cron jobs
CREATE OR REPLACE FUNCTION calculate_next_run(
  p_schedule_type TEXT,
  p_schedule_expr TEXT,
  p_last_run TIMESTAMPTZ DEFAULT NULL
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
AS $$
DECLARE
  v_next_run TIMESTAMPTZ;
BEGIN
  CASE p_schedule_type
    WHEN 'once' THEN
      -- One-time execution at specified time
      v_next_run := p_schedule_expr::TIMESTAMPTZ;
    WHEN 'interval' THEN
      -- Interval-based (e.g., '1h', '1d', '1w')
      IF p_last_run IS NULL THEN
        v_next_run := NOW();
      ELSE
        v_next_run := p_last_run + p_schedule_expr::INTERVAL;
      END IF;
    WHEN 'cron' THEN
      -- Cron expression - simplified parsing for common patterns
      -- Full cron parsing should be done in application code
      -- This is a basic implementation
      v_next_run := NOW() + INTERVAL '1 hour'; -- Placeholder
    ELSE
      v_next_run := NULL;
  END CASE;

  RETURN v_next_run;
END;
$$;

-- Function to mark cron job as executed
CREATE OR REPLACE FUNCTION mark_cron_executed(
  p_job_id UUID,
  p_status TEXT,
  p_result TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE cron_jobs
  SET
    last_run_at = NOW(),
    last_status = p_status,
    last_result = p_result,
    run_count = run_count + 1,
    next_run_at = CASE
      WHEN schedule_type = 'once' THEN NULL
      ELSE calculate_next_run(schedule_type, schedule_expr, NOW())
    END,
    enabled = CASE
      WHEN schedule_type = 'once' THEN false
      WHEN max_runs IS NOT NULL AND run_count + 1 >= max_runs THEN false
      ELSE enabled
    END
  WHERE id = p_job_id;
END;
$$;
