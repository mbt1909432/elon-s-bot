-- Migration: Add user_memory and user_history tables
-- Run this in Supabase SQL Editor

-- ============================================
-- User Memory (like MEMORY.md in nanobot)
-- One row per user, stores long-term memory in Markdown format
-- ============================================
CREATE TABLE IF NOT EXISTS user_memory (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- User History (like HISTORY.md in nanobot)
-- Multiple rows per user, stores conversation summaries
-- ============================================
CREATE TABLE IF NOT EXISTS user_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  entry TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_history_user_id ON user_history(user_id);
CREATE INDEX IF NOT EXISTS idx_user_history_created_at ON user_history(created_at DESC);

-- ============================================
-- Row Level Security (RLS)
-- ============================================
ALTER TABLE user_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_history ENABLE ROW LEVEL SECURITY;

-- User Memory: Users can only access their own memory
CREATE POLICY "Users can view own user_memory" ON user_memory
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own user_memory" ON user_memory
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own user_memory" ON user_memory
  FOR UPDATE USING (auth.uid() = user_id);

-- User History: Users can only access their own history
CREATE POLICY "Users can view own user_history" ON user_history
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own user_history" ON user_history
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================
-- Updated_at Trigger for user_memory
-- ============================================
CREATE TRIGGER update_user_memory_updated_at
  BEFORE UPDATE ON user_memory
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Auto-create user_memory on user creation
-- ============================================
CREATE OR REPLACE FUNCTION handle_new_user_memory()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_memory (user_id, content)
  VALUES (NEW.id, '');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created_memory ON auth.users;
CREATE TRIGGER on_auth_user_created_memory
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user_memory();
