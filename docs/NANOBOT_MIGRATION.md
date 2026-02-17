# Nanobot 迁移文档：从 Python CLI 到 Supabase + Next.js

## 目录

1. [产品概述](#1-产品概述)
2. [功能分析](#2-功能分析)
3. [当前架构分析](#3-当前架构分析)
4. [迁移策略](#4-迁移策略)
5. [数据库设计](#5-数据库设计)
6. [API 设计](#6-api-设计)
7. [前端设计](#7-前端设计)
8. [实施路线图](#8-实施路线图)

---

## 1. 产品概述

### 1.1 什么是 Nanobot？

**Nanobot** 是一个**超轻量级个人 AI 助手**，灵感来自 OpenClaw。它的核心理念是用最少的代码（约 4,000 行）实现完整的 AI Agent 功能。

### 1.2 核心价值主张

| 特性 | 描述 |
|------|------|
| **超轻量** | 仅 ~4,000 行核心代码，比同类项目小 99% |
| **研究友好** | 清晰可读的代码，易于理解和修改 |
| **多平台** | 支持 Telegram、Discord、WhatsApp、飞书、Slack 等 9+ 平台 |
| **可扩展** | 技能系统、MCP 协议支持 |

### 1.3 用户场景

```
┌─────────────────────────────────────────────────────────────┐
│                     Nanobot 用户场景                         │
├─────────────────┬─────────────────┬─────────────────────────┤
│ 📈 市场分析     │ 🚀 软件工程     │ 📅 日程管理             │
│ 24/7实时监控    │ 代码生成/调试   │ 智能提醒/任务调度        │
├─────────────────┼─────────────────┼─────────────────────────┤
│ 📚 知识助手     │ 🔧 自动化任务   │ 💬 多平台聊天            │
│ 记忆/推理/学习  │ Shell/文件操作  │ Telegram/Discord/...    │
└─────────────────┴─────────────────┴─────────────────────────┘
```

### 1.4 迁移目标

将 Nanobot 从 **Python CLI 工具** 迁移为 **Web 应用 + 多平台 Bot 服务**：

```
当前: Python CLI → 本地运行 → 文件存储
目标: Next.js Web App + Supabase → 云端部署 → 数据库存储
```

---

## 2. 功能分析

### 2.1 核心功能模块

#### 2.1.1 对话系统 (Conversation)

```python
# 当前实现
- SessionManager: 管理会话状态
- ContextBuilder: 构建系统提示词
- AgentLoop: LLM ↔ 工具执行循环
```

**功能点**:
- 多轮对话上下文管理
- 会话持久化
- 历史消息检索

#### 2.1.2 记忆系统 (Memory)

```python
# 当前实现
- MEMORY.md: 长期记忆（事实、偏好、关系）
- HISTORY.md: 事件日志（追加写入，grep 搜索）
- memory_window: 滑动窗口控制
```

**功能点**:
- 长期记忆存储
- 事件历史记录
- 语义搜索（当前是关键词搜索）

#### 2.1.3 工具系统 (Tools)

| 工具 | 功能 | 迁移优先级 |
|------|------|-----------|
| `read_file` | 读取文件 | P1 |
| `write_file` | 写入文件 | P1 |
| `edit_file` | 编辑文件 | P2 |
| `list_dir` | 列出目录 | P2 |
| `exec` | 执行 Shell | P3 (安全考虑) |
| `web_search` | 网页搜索 | P1 |
| `web_fetch` | 网页抓取 | P1 |
| `message` | 发送消息 | P1 |
| `spawn` | 后台任务 | P2 |
| `cron` | 定时任务 | P2 |

#### 2.1.4 渠道系统 (Channels)

| 平台 | 难度 | 协议 | 迁移建议 |
|------|------|------|----------|
| **Telegram** | 简单 | HTTP Bot API | 首选试点 |
| **Discord** | 简单 | WebSocket | 第二优先 |
| **Web Chat** | 新增 | WebSocket | 核心功能 |
| **飞书** | 中等 | WebSocket | 可选 |
| **Slack** | 中等 | Socket Mode | 可选 |
| **WhatsApp** | 中等 | Baileys Bridge | 可选 |

#### 2.1.5 定时任务 (Cron)

```python
# 当前实现
- CronService: 管理 cron 任务
- 支持 cron 表达式和间隔秒数
- 任务持久化到配置文件
```

#### 2.1.6 心跳系统 (Heartbeat)

```python
# 当前实现
- HEARTBEAT.md: 每 30 分钟检查
- 周期性任务列表
- 自动触发 Agent 执行任务
```

### 2.2 技能系统 (Skills)

内置技能:
- **github**: Issue/PR 管理
- **weather**: 天气查询
- **summarize**: 内容摘要
- **tmux**: 远程会话控制
- **skill-creator**: 创建新技能
- **memory**: 记忆管理

### 2.3 提供商系统 (Providers)

支持 14+ LLM 提供商:
- OpenRouter (推荐，统一网关)
- Anthropic (Claude 直连)
- OpenAI (GPT 直连)
- DeepSeek
- Groq (语音转录)
- Gemini
- Moonshot/Kimi
- Zhipu GLM
- vLLM (本地)
- 等等...

---

## 3. 当前架构分析

### 3.1 系统架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                         Nanobot 系统架构                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  Telegram   │  │  Discord    │  │  WhatsApp   │  ...        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         │                │                │                     │
│         └────────────────┼────────────────┘                     │
│                          ▼                                      │
│                 ┌────────────────┐                              │
│                 │  ChannelManager │                             │
│                 └────────┬───────┘                              │
│                          │                                      │
│                          ▼                                      │
│                 ┌────────────────┐                              │
│                 │   MessageBus   │◄──── CronService             │
│                 │  (事件驱动)     │◄──── HeartbeatChecker        │
│                 └────────┬───────┘                              │
│                          │                                      │
│         ┌────────────────┼────────────────┐                     │
│         ▼                ▼                ▼                     │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐                │
│  │ AgentLoop  │  │ AgentLoop  │  │ AgentLoop  │  (多实例)       │
│  │ (Session A)│  │ (Session B)│  │ (Session C)│                │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘                │
│        │               │               │                        │
│        └───────────────┼───────────────┘                        │
│                        ▼                                        │
│              ┌─────────────────┐                                │
│              │  LLM Provider   │ (LiteLLM → 100+ 模型)          │
│              └────────┬────────┘                                │
│                       │                                         │
│        ┌──────────────┼──────────────┐                          │
│        ▼              ▼              ▼                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                      │
│  │ Context  │  │  Memory  │  │  Tools   │                      │
│  │ Builder  │  │  Store   │  │ Registry │                      │
│  └──────────┘  └──────────┘  └──────────┘                      │
│                                                                 │
│  ┌─────────────────────────────────────────────────┐            │
│  │              文件存储层                          │            │
│  │  config.json │ MEMORY.md │ HISTORY.md │ workspace/│          │
│  └─────────────────────────────────────────────────┘            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 数据流

```
用户消息 → Channel → MessageBus → AgentLoop
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
            ContextBuilder                    ToolRegistry
            (构建系统提示)                    (执行工具调用)
                    │                               │
                    └───────────────┬───────────────┘
                                    ▼
                            LLM Provider
                                    │
                                    ▼
                            Response → MessageBus → Channel → 用户
```

### 3.3 当前存储模型

```yaml
文件存储:
  config.json:
    - 提供商配置 (API keys, base URLs)
    - 渠道配置 (tokens, credentials)
    - 工具配置 (超时, 限制)
    - Agent 默认值 (model, temperature)

  workspace/:
    MEMORY.md:        # 长期记忆
      - 用户偏好
      - 事实知识
      - 关系信息

    HISTORY.md:       # 事件日志
      - 追加写入
      - grep 搜索

    HEARTBEAT.md:     # 周期任务
      - 任务列表
      - 每 30 分钟检查

  session/:           # 会话数据
    - 对话历史
    - 上下文窗口
```

---

## 4. 迁移策略

### 4.1 迁移原则

1. **渐进式迁移**: 优先迁移核心功能，逐步添加高级特性
2. **保持兼容**: 尽可能保留原有概念和命名
3. **云原生**: 充分利用 Supabase 的实时、认证、存储能力
4. **安全优先**: 敏感操作需要用户确认

### 4.2 迁移架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    迁移后架构 (Next.js + Supabase + Acontext)            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                  │
│  │  Web Chat    │  │  Telegram    │  │  Discord     │                  │
│  │  (新增)      │  │  Bot         │  │  Bot         │                  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                  │
│         │                 │                 │                           │
│         └─────────────────┼─────────────────┘                           │
│                           ▼                                             │
│                  ┌────────────────┐                                     │
│                  │  Next.js API   │                                     │
│                  │  Routes        │                                     │
│                  └───────┬────────┘                                     │
│                          │                                              │
│         ┌────────────────┼────────────────┐                             │
│         ▼                ▼                ▼                             │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐                        │
│  │ /api/chat  │  │/api/tools  │  │/api/cron   │                        │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘                        │
│        │               │               │                                │
│        └───────────────┼───────────────┘                                │
│                        ▼                                                │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                        存储层                                      │  │
│  │  ┌─────────────────────────┐  ┌─────────────────────────────┐    │  │
│  │  │      Supabase           │  │       Acontext SDK          │    │  │
│  │  │  ┌─────────┐ ┌────────┐ │  │  ┌──────────┐ ┌──────────┐ │    │  │
│  │  │  │  Auth   │ │Database│ │  │  │ sessions │ │  disks   │ │    │  │
│  │  │  ├─────────┤ ├────────┤ │  │  │ (会话)   │ │ (文件)   │ │    │  │
│  │  │  │ Realtime│ │Storage │ │  │  ├──────────┤ ├──────────┤ │    │  │
│  │  │  └─────────┘ └────────┘ │  │  │sandboxes │ │artifacts │ │    │  │
│  │  │                         │  │  │(沙箱)    │ │(工件)    │ │    │  │
│  │  │  用户/配置/元数据        │  │  └──────────┘ └──────────┘ │    │  │
│  │  └─────────────────────────┘  │  对话历史/文件/Python执行   │    │  │
│  │                               └─────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                        外部服务                                    │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐         │  │
│  │  │OpenRouter│  │Brave API │  │Telegram  │  │ Acontext │         │  │
│  │  │(LLM)     │  │(Search)  │  │API       │  │ API      │         │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘         │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.2.1 Supabase vs Acontext 职责划分

| 职责 | Supabase | Acontext |
|------|----------|----------|
| **用户认证** | ✅ | - |
| **用户配置** | ✅ | - |
| **会话元数据** | ✅ | - |
| **对话历史** | 可选 | ✅ (推荐) |
| **记忆系统** | ✅ (结构化) | ✅ (原始消息) |
| **文件存储** | Storage | ✅ Disks (更丰富) |
| **Python 执行** | - | ✅ Sandboxes |
| **工件 CDN** | - | ✅ Artifacts |
| **实时订阅** | ✅ Realtime | - |
| **定时任务** | pg_cron | - |

### 4.3 技术栈对比

| 组件 | 当前 (Python) | 迁移后 (Next.js) |
|------|--------------|-----------------|
| **语言** | Python 3.11+ | TypeScript |
| **运行时** | Python async | Node.js / Edge Runtime |
| **框架** | 无 (原生) | Next.js 15 App Router |
| **认证** | 无 (单用户) | Supabase Auth |
| **数据库** | 文件 (JSON/MD) | Supabase (PostgreSQL) + Acontext |
| **实时通信** | WebSocket (各平台) | Supabase Realtime + WebSocket |
| **LLM** | LiteLLM | Vercel AI SDK / OpenAI SDK |
| **定时任务** | CronService | Vercel Cron / pg_cron |
| **文件存储** | 本地文件 | Acontext Disks + Supabase Storage |
| **代码执行** | 本地 Shell | Acontext Sandboxes (安全沙箱) |

### 4.4 Acontext SDK 集成

> Acontext 提供 会话管理、文件操作、Python 沙箱执行 等核心能力

#### 4.4.1 核心功能映射

```
Nanobot 原型                    →  Acontext SDK
─────────────────────────────────────────────────
MEMORY.md / HISTORY.md         →  sessions.* (会话存储)
read_file / write_file         →  disks.artifacts.* (文件操作)
exec (Shell)                   →  sandboxes.* (Python 沙箱)
工具执行                        →  DISK_TOOLS (内置工具集)
上下文压缩                       →  editStrategies (令牌感知)
```

#### 4.4.2 安装与配置

```bash
npm install @acontext/acontext openai
```

```typescript
// lib/acontext/config.ts
export function getAcontextConfig() {
  const apiKey = process.env.ACONTEXT_API_KEY;
  if (!apiKey) return null;

  return {
    apiKey,
    baseUrl: process.env.ACONTEXT_BASE_URL ?? "https://api.acontext.com/api/v1",
  };
}
```

#### 4.4.3 会话管理

```typescript
// lib/acontext/session.ts
import { Acontext } from "@acontext/acontext";

export async function createSession(client: Acontext, userId: string) {
  return client.sessions.create({
    configs: { userId, source: "elonsbot" }
  });
}

export async function storeMessage(
  client: Acontext,
  sessionId: string,
  message: { role: string; content: string | any[] }
) {
  await client.sessions.storeMessage(sessionId, message, { format: "openai" });
}

export async function loadMessages(
  client: Acontext,
  sessionId: string,
  options?: { tokenLimit?: number }
) {
  const editStrategies = options?.tokenLimit
    ? [{ type: "token_limit", params: { limit_tokens: options.tokenLimit } }]
    : [];

  const result = await client.sessions.getMessages(sessionId, {
    format: "openai",
    editStrategies
  });

  return result?.items || [];
}
```

#### 4.4.4 磁盘工具 (替代原生文件工具)

```typescript
// lib/acontext/disk-tools.ts
import { DISK_TOOLS } from "@acontext/acontext";

// 内置工具列表
const TOOL_NAMES = [
  "write_file_disk",     // 写入文件
  "read_file_disk",      // 读取文件
  "replace_string_disk", // 替换字符串
  "list_disk",           // 列出目录
  "download_file_disk",  // 下载文件 (获取公开 URL)
  "grep_disk",           // 搜索内容
  "glob_disk",           // 匹配路径
];

export function getDiskToolSchemas() {
  return DISK_TOOLS.toOpenAIToolSchema();
}

export async function executeDiskTool(
  client: Acontext,
  diskId: string,
  toolName: string,
  args: Record<string, any>
) {
  const ctx = DISK_TOOLS.formatContext(client, diskId);
  return DISK_TOOLS.executeTool(ctx, toolName, args);
}
```

#### 4.4.5 Python 沙箱执行 (替代 exec)

```typescript
// lib/acontext/sandbox.ts
import { Acontext } from "@acontext/acontext";

export async function executePython(
  client: Acontext,
  diskId: string,
  script: string,
  outputFile: string = "output.png"
): Promise<{ success: boolean; output?: string; error?: string; diskPath?: string }> {
  let sandbox: any = null;

  try {
    // 1. 创建沙箱
    sandbox = await client.sandboxes.create();

    // 2. 上传脚本到磁盘
    await client.disks.artifacts.upsert(diskId, {
      file: ["script.py", Buffer.from(script), "text/x-python"],
      filePath: "/scripts/"
    });

    // 3. 下载脚本到沙箱
    await client.disks.artifacts.downloadToSandbox(diskId, {
      filePath: "/scripts/",
      filename: "script.py",
      sandboxId: sandbox.sandbox_id,
      sandboxPath: "/workspace/"
    });

    // 4. 安装依赖并执行
    const result = await client.sandboxes.execCommand({
      sandboxId: sandbox.sandbox_id,
      command: "pip3 install seaborn pandas matplotlib --quiet && python3 /workspace/script.py",
      timeout: 60000
    });

    if (result.exit_code !== 0) {
      return { success: false, error: result.stderr };
    }

    // 5. 验证输出文件存在
    const verify = await client.sandboxes.execCommand({
      sandboxId: sandbox.sandbox_id,
      command: `test -f /workspace/${outputFile} && echo "EXISTS" || echo "NOT_FOUND"`
    });

    if (!verify.stdout?.includes("EXISTS")) {
      return { success: false, error: `Output file ${outputFile} not found` };
    }

    // 6. 上传结果到磁盘
    await client.disks.artifacts.uploadFromSandbox(diskId, {
      sandboxId: sandbox.sandbox_id,
      sandboxPath: "/workspace/",
      sandboxFilename: outputFile,
      filePath: "/outputs/"
    });

    return {
      success: true,
      output: result.stdout,
      diskPath: `disk::/outputs/${outputFile}`
    };

  } catch (error) {
    return { success: false, error: String(error) };
  } finally {
    // 7. 清理沙箱
    if (sandbox) {
      await client.sandboxes.kill(sandbox.sandbox_id);
    }
  }
}
```

#### 4.4.6 disk:: 协议 (前端图像渲染)

```typescript
// lib/acontext/disk-protocol.ts

/**
 * LLM 返回的图像路径格式: disk::/outputs/chart.png
 * 前端需要转换为 API URL: /api/acontext/artifacts?path=/outputs/chart.png
 */
export function rewriteDiskPath(content: string, diskId: string): string {
  const pattern = /disk::\s*([A-Za-z0-9/_-]+\.(?:png|jpg|jpeg|webp|gif))/gi;

  return content.replace(pattern, (_, path) => {
    return `/api/acontext/artifacts?path=${encodeURIComponent(path)}&diskId=${diskId}`;
  });
}
```

```typescript
// app/api/acontext/artifacts/route.ts
import { getAcontextConfig } from "@/lib/acontext/config";
import { Acontext } from "@acontext/acontext";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  const diskId = url.searchParams.get("diskId");

  if (!path || !diskId) {
    return Response.json({ error: "Missing parameters" }, { status: 400 });
  }

  const config = getAcontextConfig();
  if (!config) {
    return Response.json({ error: "Acontext not configured" }, { status: 500 });
  }

  const client = new Acontext({ apiKey: config.apiKey });

  const parts = path.split("/").filter(Boolean);
  const filename = parts[parts.length - 1];
  const filePath = parts.length > 1 ? "/" + parts.slice(0, -1).join("/") : "/";

  const result = await client.disks.artifacts.get(diskId, {
    filePath,
    filename,
    withContent: true,
    withPublicUrl: true
  });

  if (result?.public_url) {
    return Response.redirect(result.public_url);
  }

  return Response.json({ error: "Artifact not found" }, { status: 404 });
}
```

### 4.5 迁移优先级

```
Phase 1: 核心功能 (MVP)
├── 用户认证 (Supabase Auth)
├── Web 聊天界面
├── 对话 API (/api/chat)
├── 基础工具 (web_search, web_fetch)
└── 记忆系统 (数据库版)

Phase 2: 多平台支持
├── Telegram Bot 集成
├── Discord Bot 集成
├── 渠道管理 API
└── 消息路由

Phase 3: 高级功能
├── 定时任务 (Cron)
├── 文件工具 (受限制)
├── 技能系统
└── MCP 协议支持

Phase 4: 增强功能
├── 多模型支持
├── 使用统计
├── 团队协作
└── 管理后台
```

---

## 5. 数据库设计

### 5.1 核心表结构

```sql
-- ============================================
-- 用户与认证 (使用 Supabase Auth，auth.users)
-- ============================================

-- 用户配置表
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  timezone TEXT DEFAULT 'UTC',
  language TEXT DEFAULT 'zh-CN',
  communication_style TEXT DEFAULT 'casual', -- casual, professional, technical
  response_length TEXT DEFAULT 'adaptive', -- brief, detailed, adaptive
  technical_level TEXT DEFAULT 'intermediate', -- beginner, intermediate, expert
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 对话系统
-- ============================================

-- 会话表 (Supabase 存储元数据, Acontext 存储消息)
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT,
  channel TEXT NOT NULL DEFAULT 'web', -- web, telegram, discord, etc.
  channel_metadata JSONB DEFAULT '{}', -- 平台特定信息

  -- Acontext 关联
  acontext_session_id TEXT,           -- Acontext 会话 ID
  acontext_disk_id TEXT,              -- Acontext 磁盘 ID

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 消息表
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL,
  tool_calls JSONB, -- 工具调用信息
  tool_call_id TEXT, -- 工具响应关联
  metadata JSONB DEFAULT '{}', -- 额外元数据
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 记忆系统
-- ============================================

-- 长期记忆表 (替代 MEMORY.md)
CREATE TABLE memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL, -- preference, fact, relationship, context
  key TEXT NOT NULL, -- 记忆键
  value TEXT NOT NULL, -- 记忆值
  importance INTEGER DEFAULT 5, -- 1-10 重要性
  source TEXT, -- 来源 (用户输入, 推断, 等)
  embedding VECTOR(1536), -- OpenAI embedding (可选，用于语义搜索)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, category, key)
);

-- 事件历史表 (替代 HISTORY.md)
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- message, action, reminder, etc.
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 工具与任务
-- ============================================

-- 定时任务表
CREATE TABLE cron_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  message TEXT NOT NULL, -- 要发送的消息/任务
  cron_expression TEXT, -- cron 表达式
  interval_seconds INTEGER, -- 或间隔秒数
  next_run_at TIMESTAMPTZ NOT NULL,
  last_run_at TIMESTAMPTZ,
  channel TEXT DEFAULT 'web',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 心跳任务表
CREATE TABLE heartbeat_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  is_completed BOOLEAN DEFAULT FALSE,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 工具执行日志
CREATE TABLE tool_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  parameters JSONB NOT NULL,
  result TEXT,
  status TEXT DEFAULT 'success', -- success, error, timeout
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 渠道配置
-- ============================================

-- 用户渠道配置 (加密存储)
CREATE TABLE channel_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL, -- telegram, discord, etc.
  config JSONB NOT NULL, -- 加密的配置信息
  is_enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, channel)
);

-- ============================================
-- 提供商配置
-- ============================================

-- 用户 LLM 提供商配置
CREATE TABLE provider_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, -- openrouter, anthropic, openai, etc.
  api_key_encrypted TEXT, -- 加密的 API Key
  api_base TEXT,
  extra_headers JSONB,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

-- ============================================
-- Agent 配置
-- ============================================

-- 用户 Agent 配置
CREATE TABLE agent_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  default_model TEXT DEFAULT 'anthropic/claude-opus-4-5',
  max_tokens INTEGER DEFAULT 8192,
  temperature REAL DEFAULT 0.7,
  max_tool_iterations INTEGER DEFAULT 20,
  memory_window INTEGER DEFAULT 50,
  system_prompt_overrides TEXT, -- 自定义系统提示
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 索引
-- ============================================

CREATE INDEX idx_conversations_user ON conversations(user_id);
CREATE INDEX idx_conversations_channel ON conversations(channel);
CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_memories_user_category ON memories(user_id, category);
CREATE INDEX idx_events_user_time ON events(user_id, created_at DESC);
CREATE INDEX idx_cron_jobs_next_run ON cron_jobs(next_run_at) WHERE is_active = TRUE;
CREATE INDEX idx_tool_executions_user ON tool_executions(user_id);

-- ============================================
-- RLS 策略 (Row Level Security)
-- ============================================

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cron_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE heartbeat_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_settings ENABLE ROW LEVEL SECURITY;

-- 用户只能访问自己的数据
CREATE POLICY "Users can manage own profile" ON user_profiles
  FOR ALL USING (auth.uid() = id);

CREATE POLICY "Users can manage own conversations" ON conversations
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own messages" ON messages
  FOR ALL USING (
    EXISTS (SELECT 1 FROM conversations WHERE id = messages.conversation_id AND user_id = auth.uid())
  );

CREATE POLICY "Users can manage own memories" ON memories
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own events" ON events
  FOR ALL USING (auth.uid() = user_id);

-- ... 其他表的 RLS 策略类似
```

### 5.2 实时订阅

```sql
-- Supabase Realtime 配置
-- 在 Supabase Dashboard 中启用 Realtime

-- 订阅消息更新 (用于实时聊天)
SUPABASE_REALTIME_CHANNEL: messages

-- 订阅任务状态更新
SUPABASE_REALTIME_CHANNEL: cron_jobs
```

---

## 6. API 设计

### 6.1 API 路由结构

```
app/api/
├── chat/
│   └── route.ts                    # POST - 对话 API (流式响应, Acontext 集成)
├── conversations/
│   ├── route.ts                    # GET - 列表, POST - 创建 (Supabase 元数据)
│   └── [id]/
│       └── route.ts                # GET, DELETE - 单个会话
├── messages/
│   └── route.ts                    # GET - 获取历史消息 (从 Acontext 加载)
├── memory/
│   ├── route.ts                    # GET, POST - 记忆管理 (Supabase 结构化存储)
│   └── search/
│       └── route.ts                # POST - 记忆搜索
├── tools/
│   ├── disk/
│   │   └── route.ts                # POST - 磁盘工具执行 (Acontext DISK_TOOLS)
│   ├── sandbox/
│   │   └── route.ts                # POST - Python 沙箱执行 (Acontext Sandboxes)
│   ├── web-search/
│   │   └── route.ts                # POST - 网页搜索 (Brave API)
│   └── web-fetch/
│       └── route.ts                # POST - 网页抓取
├── acontext/
│   ├── session/
│   │   └── route.ts                # POST - 创建 Acontext 会话
│   ├── disk/
│   │   └── route.ts                # POST - 创建 Acontext 磁盘
│   └── artifacts/
│       └── route.ts                # GET - 获取工件 (disk:: 协议支持)
├── cron/
│   ├── route.ts                    # GET - 列表, POST - 创建
│   ├── [id]/
│   │   └── route.ts                # DELETE - 删除任务
│   └── execute/
│       └── route.ts                # POST - Cron 触发端点 (Vercel Cron)
├── channels/
│   ├── route.ts                    # GET - 渠道状态
│   ├── telegram/
│   │   └── webhook/
│   │       └── route.ts            # POST - Telegram Webhook
│   └── discord/
│       └── interactions/
│           └── route.ts            # POST - Discord Interactions
├── providers/
│   └── route.ts                    # GET, POST - 提供商配置
├── agent/
│   └── settings/
│       └── route.ts                # GET, PUT - Agent 设置
└── auth/
    └── callback/
        └── route.ts                # GET - OAuth 回调
```

### 6.2 核心 API 规范

#### 6.2.1 对话 API (Acontext 集成版)

```typescript
// POST /api/chat
// 流式响应，使用 Acontext SDK 进行会话管理和工具执行

import OpenAI from "openai";
import { Acontext } from "@acontext/acontext";
import { DISK_TOOLS } from "@acontext/acontext";
import { createClient } from '@/lib/supabase/server';
import { getAcontextConfig, getLLMConfig } from '@/lib/config';
import { executePython } from '@/lib/acontext/sandbox';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { messages, conversationId, acontextSessionId, acontextDiskId } = await request.json();

  // 获取配置
  const acontextConfig = getAcontextConfig();
  const llmConfig = getLLMConfig();

  if (!acontextConfig) {
    return new Response('Acontext not configured', { status: 500 });
  }

  // 初始化客户端
  const acontext = new Acontext({ apiKey: acontextConfig.apiKey });
  const openai = new OpenAI({ apiKey: llmConfig.apiKey, baseURL: llmConfig.endpoint });

  // 获取或创建 Acontext 会话和磁盘
  let sessionId = acontextSessionId;
  let diskId = acontextDiskId;

  if (!sessionId) {
    const session = await acontext.sessions.create({
      configs: { userId: user.id, source: "elonsbot" }
    });
    sessionId = session.id;
  }

  if (!diskId) {
    const disk = await acontext.disks.create();
    diskId = disk.id;
  }

  // 获取用户配置
  const { data: settings } = await supabase
    .from('agent_settings')
    .select('*')
    .eq('user_id', user.id)
    .single();

  // 获取记忆上下文 (从 Supabase)
  const { data: memories } = await supabase
    .from('memories')
    .select('category, key, value')
    .eq('user_id', user.id)
    .order('importance', { ascending: false })
    .limit(20);

  // 构建系统提示
  const systemPrompt = buildSystemPrompt(memories, settings);

  // 加载历史消息 (从 Acontext)
  const history = await acontext.sessions.getMessages(sessionId, {
    format: "openai",
    editStrategies: [
      { type: "token_limit", params: { limit_tokens: 70000 } },
      { type: "remove_tool_result", params: { keep_recent_n_tool_results: 5 } }
    ]
  });

  // 存储用户消息
  const userMessage = messages[messages.length - 1];
  if (userMessage?.role === "user") {
    await acontext.sessions.storeMessage(sessionId, userMessage, { format: "openai" });
  }

  // 获取工具定义
  const tools = [
    ...DISK_TOOLS.toOpenAIToolSchema(),  // 磁盘工具
    {
      type: "function" as const,
      function: {
        name: "execute_python",
        description: "Execute Python code in a sandbox for data analysis and visualization",
        parameters: {
          type: "object",
          properties: {
            code: { type: "string", description: "Python code to execute" },
            output_file: { type: "string", description: "Expected output filename", default: "output.png" }
          },
          required: ["code"]
        }
      }
    },
    {
      type: "function" as const,
      function: {
        name: "web_search",
        description: "Search the web for information",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" }
          },
          required: ["query"]
        }
      }
    }
  ];

  // 创建 SSE 流
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: any) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      // 发送会话信息
      send("session", { sessionId, diskId });

      let currentMessages = [
        { role: "system", content: systemPrompt },
        ...history.items,
        ...messages
      ];

      let assistantContent = "";
      const maxIterations = 10;

      try {
        for (let i = 0; i < maxIterations; i++) {
          const response = await openai.chat.completions.create({
            model: settings?.default_model || llmConfig.model || "gpt-4o-mini",
            messages: currentMessages,
            temperature: settings?.temperature || 0.7,
            max_tokens: settings?.max_tokens || 2048,
            stream: true,
            tools,
            tool_choice: "auto"
          });

          let content = "";
          const toolCallsAccumulator: any[] = [];

          for await (const chunk of response) {
            const delta = chunk.choices[0]?.delta;
            if (delta?.content) {
              content += delta.content;
              send("message", { content: delta.content });
            }
            if (delta?.tool_calls) {
              for (const d of delta.tool_calls) {
                const idx = d.index ?? 0;
                if (!toolCallsAccumulator[idx]) {
                  toolCallsAccumulator[idx] = {
                    id: d.id ?? "",
                    type: "function",
                    function: { name: d.function?.name ?? "", arguments: d.function?.arguments ?? "" }
                  };
                } else {
                  toolCallsAccumulator[idx].function.arguments += d.function?.arguments ?? "";
                }
              }
            }
          }

          const assistantToolCalls = toolCallsAccumulator.filter(tc => tc.id && tc.function.name);

          if (assistantToolCalls.length === 0) {
            // 无工具调用，结束
            send("final_message", { message: content });
            assistantContent = content;
            break;
          }

          // 执行工具调用
          const toolResults: any[] = [];
          for (const tc of assistantToolCalls) {
            const args = JSON.parse(tc.function.arguments || "{}");

            send("tool_call_start", { id: tc.id, name: tc.function.name, arguments: args });

            try {
              let result: any;

              // 磁盘工具
              if (DISK_TOOLS.toOpenAIToolSchema().some(t => t.function.name === tc.function.name)) {
                const ctx = DISK_TOOLS.formatContext(acontext, diskId);
                result = await DISK_TOOLS.executeTool(ctx, tc.function.name, args);
              }
              // Python 沙箱
              else if (tc.function.name === "execute_python") {
                result = await executePython(acontext, diskId, args.code, args.output_file);
              }
              // 网页搜索
              else if (tc.function.name === "web_search") {
                result = await executeWebSearch(args.query);
              }

              toolResults.push({ id: tc.id, result });
              send("tool_call_complete", { id: tc.id, result });

            } catch (error) {
              toolResults.push({ id: tc.id, error: String(error) });
              send("tool_call_error", { id: tc.id, error: String(error) });
            }
          }

          // 构建下一轮消息
          currentMessages = [
            ...currentMessages,
            { role: "assistant", content, tool_calls: assistantToolCalls },
            ...toolResults.map(tr => ({
              role: "tool",
              tool_call_id: tr.id,
              content: JSON.stringify(tr.error ? { error: tr.error } : tr.result)
            }))
          ];
        }

        // 存储助手消息到 Acontext
        await acontext.sessions.storeMessage(sessionId, {
          role: "assistant",
          content: assistantContent
        }, { format: "openai" });

        // 更新 Supabase 会话元数据
        if (conversationId) {
          await supabase
            .from('conversations')
            .update({
              acontext_session_id: sessionId,
              acontext_disk_id: diskId,
              updated_at: new Date().toISOString()
            })
            .eq('id', conversationId);
        }

      } catch (error) {
        send("error", { error: String(error) });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    }
  });
}
```

#### 6.2.2 记忆 API

```typescript
// GET /api/memory
// 获取用户记忆

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: memories } = await supabase
    .from('memories')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  return Response.json(memories);
}

// POST /api/memory
// 创建/更新记忆

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { category, key, value, importance } = await request.json();

  const { data, error } = await supabase
    .from('memories')
    .upsert({
      user_id: user.id,
      category,
      key,
      value,
      importance: importance || 5
    }, { onConflict: 'user_id,category,key' });

  return Response.json(data);
}
```

#### 6.2.3 定时任务 API

```typescript
// POST /api/cron
// 创建定时任务

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { name, message, cronExpression, intervalSeconds, channel } = await request.json();

  // 计算下次执行时间
  const nextRunAt = calculateNextRun(cronExpression, intervalSeconds);

  const { data, error } = await supabase
    .from('cron_jobs')
    .insert({
      user_id: user.id,
      name,
      message,
      cron_expression: cronExpression,
      interval_seconds: intervalSeconds,
      next_run_at: nextRunAt,
      channel
    });

  return Response.json(data);
}

// POST /api/cron/execute
// Vercel Cron 调用端点

export async function POST(request: Request) {
  // 验证请求来自 Vercel Cron
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = createAdminClient();

  // 获取需要执行的任务
  const now = new Date();
  const { data: jobs } = await supabase
    .from('cron_jobs')
    .select('*, user_profiles!inner(display_name), channel_configs!inner(config)')
    .eq('is_active', true)
    .lte('next_run_at', now.toISOString());

  // 执行每个任务
  for (const job of jobs || []) {
    await executeCronJob(job);

    // 更新下次执行时间
    const nextRun = calculateNextRun(job.cron_expression, job.interval_seconds);
    await supabase
      .from('cron_jobs')
      .update({ last_run_at: now, next_run_at: nextRun })
      .eq('id', job.id);
  }

  return Response.json({ executed: jobs?.length || 0 });
}
```

### 6.3 Telegram Webhook

```typescript
// POST /api/channels/telegram/webhook

import { TelegramBot } from '@/lib/telegram';

export async function POST(request: Request) {
  const body = await request.json();

  // 验证 Telegram 请求
  if (!validateTelegramRequest(request, body)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { message } = body;

  if (!message?.text) {
    return new Response('OK');
  }

  // 根据 Telegram ID 查找用户
  const supabase = createAdminClient();
  const { data: channelConfig } = await supabase
    .from('channel_configs')
    .select('user_id')
    .eq('channel', 'telegram')
    .eq('is_enabled', true)
    .contains('config->allowed_ids', [message.from.id.toString()])
    .single();

  if (!channelConfig) {
    return new Response('Unauthorized user', { status: 403 });
  }

  // 处理消息
  const response = await processMessage({
    userId: channelConfig.user_id,
    text: message.text,
    channel: 'telegram',
    channelId: message.chat.id
  });

  // 发送响应
  const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN!);
  await bot.sendMessage(message.chat.id, response);

  return new Response('OK');
}
```

---

## 7. 前端设计

### 7.1 页面结构

```
app/
├── (auth)/
│   ├── login/
│   │   └── page.tsx           # 登录页
│   ├── signup/
│   │   └── page.tsx           # 注册页
│   └── layout.tsx
├── (app)/
│   ├── layout.tsx             # 主布局 (侧边栏 + 内容区)
│   ├── page.tsx               # 首页/聊天
│   ├── conversations/
│   │   └── [id]/
│   │       └── page.tsx       # 对话详情
│   ├── memory/
│   │   └── page.tsx           # 记忆管理
│   ├── tasks/
│   │   └── page.tsx           # 定时任务
│   ├── settings/
│   │   ├── page.tsx           # 设置首页
│   │   ├── provider/
│   │   │   └── page.tsx       # LLM 提供商设置
│   │   ├── channels/
│   │   │   └── page.tsx       # 渠道配置
│   │   └── agent/
│   │       └── page.tsx       # Agent 设置
│   └── history/
│       └── page.tsx           # 历史记录
└── api/                       # API 路由
```

### 7.2 核心组件

```typescript
// components/chat/

// 聊天界面主组件
components/chat/chat-interface.tsx
├── ChatHeader                  # 对话标题、模型选择
├── MessageList                 # 消息列表 (虚拟滚动)
│   ├── UserMessage            # 用户消息
│   ├── AssistantMessage       # AI 消息 (Markdown 渲染)
│   └── ToolCallMessage        # 工具调用展示
├── ChatInput                   # 输入框
│   ├── TextArea               # 多行输入
│   ├── SendButton             # 发送按钮
│   └── AttachmentButton       # 附件 (可选)
└── TypingIndicator             # 打字指示器

// 侧边栏
components/layout/sidebar.tsx
├── NewChatButton              # 新建对话
├── ConversationList           # 对话列表
│   └── ConversationItem       # 单个对话项
└── SettingsButton             # 设置入口

// 记忆管理
components/memory/memory-panel.tsx
├── MemoryCategory             # 分类标签
├── MemoryList                 # 记忆列表
├── MemoryEditor               # 编辑记忆
└── MemorySearch               # 搜索记忆

// 任务管理
components/tasks/task-panel.tsx
├── TaskList                   # 任务列表
├── TaskEditor                 # 创建/编辑任务
└── TaskStatus                 # 任务状态
```

### 7.3 UI 设计参考

```
┌─────────────────────────────────────────────────────────────────────┐
│  ElonsBot                                     ─  □  ×              │
├────────────────┬────────────────────────────────────────────────────┤
│                │                                                    │
│  + 新建对话     │  💬 今天的市场分析                                 │
│                │  ─────────────────────────────────────────────────│
│  今天          │                                                    │
│  ├ 市场分析     │  User: 分析一下今天的科技股走势                      │
│  └ 代码调试     │                                                    │
│                │  ─────────────────────────────────────────────────│
│  昨天          │  AI: 我来帮你分析今天的科技股走势...                  │
│  ├ 项目规划     │                                                    │
│  └ 文档编写     │  🔧 正在搜索: "科技股 今日走势"                      │
│                │                                                    │
│  更早          │  ─────────────────────────────────────────────────│
│  └ ...         │                                                    │
│                │  根据搜索结果，今天科技股整体表现如下：               │
│  ────────────  │                                                    │
│                │  1. 纳斯达克指数上涨 1.2%                           │
│  ⚙️ 设置       │  2. 芯片股领涨，NVDA +3.5%                         │
│  📊 统计       │  3. 大型科技股多数上涨...                           │
│  💾 记忆       │                                                    │
│  ⏰ 任务       │  ─────────────────────────────────────────────────│
│                │                                                    │
│                │  ┌──────────────────────────────────────────────┐ │
│                │  │ 输入消息...                              发送 │ │
│                │  └──────────────────────────────────────────────┘ │
│                │                                                    │
└────────────────┴────────────────────────────────────────────────────┘
```

### 7.4 关键交互

#### 7.4.1 实时聊天

```typescript
// hooks/use-chat-stream.ts
import { useChat } from 'ai/react';

export function useChatStream(conversationId: string) {
  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    error
  } = useChat({
    api: '/api/chat',
    body: { conversationId },
    onFinish: (message) => {
      // 可选：滚动到底部、播放提示音等
    },
    onError: (error) => {
      console.error('Chat error:', error);
    }
  });

  return {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    error
  };
}
```

#### 7.4.2 实时订阅

```typescript
// hooks/use-realtime-messages.ts
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function useRealtimeMessages(conversationId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const supabase = createClient();

  useEffect(() => {
    // 初始加载
    loadMessages();

    // 订阅实时更新
    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`
      }, (payload) => {
        setMessages(prev => [...prev, payload.new as Message]);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  return messages;
}
```

---

## 8. 实施路线图

### Phase 1: MVP (2-3 周)

**目标**: 基础 Web 聊天功能 + Acontext 集成

**任务清单**:
- [ ] **Supabase 设置**
  - [ ] 数据库表创建与 RLS 配置
  - [ ] 用户认证流程 (注册/登录/密码重置)
- [ ] **Acontext 集成**
  - [ ] 安装 @acontext/acontext
  - [ ] 配置 ACONTEXT_API_KEY
  - [ ] 创建 lib/acontext/ 模块
- [ ] **核心 API**
  - [ ] `/api/chat` 流式响应 API (Acontext 集成)
  - [ ] `/api/acontext/session` 会话创建
  - [ ] `/api/acontext/artifacts` 工件访问
- [ ] **工具集成**
  - [ ] DISK_TOOLS 磁盘工具 (文件操作)
  - [ ] web_search 网页搜索
  - [ ] execute_python 沙箱执行
- [ ] **前端**
  - [ ] 基础聊天 UI
  - [ ] disk:// 协议渲染支持
  - [ ] 工具调用状态展示
- [ ] **记忆系统**
  - [ ] Supabase 结构化记忆存储
  - [ ] 记忆 CRUD API

**验收标准**:
- 用户可以注册登录
- 用户可以进行多轮对话 (历史保存在 Acontext)
- AI 可以搜索网页并返回结果
- AI 可以执行 Python 代码生成图表
- 对话历史正确保存和加载
- 图片正确渲染 (disk:// 协议)

### Phase 2: 多平台 (2 周)

**目标**: Telegram/Discord 集成

**任务清单**:
- [ ] Telegram Bot 注册与 Webhook
- [ ] `/api/channels/telegram/webhook`
- [ ] Telegram 用户绑定流程
- [ ] Discord Bot 注册与 Interactions
- [ ] 渠道配置页面
- [ ] 消息路由 (不同渠道 → 同一会话)

**验收标准**:
- 用户可以在 Telegram 与 AI 对话
- 用户可以在 Discord 与 AI 对话
- 不同渠道的对话共享记忆

### Phase 3: 高级功能 (2 周)

**目标**: 定时任务与增强功能

**任务清单**:
- [ ] Cron 任务创建 API
- [ ] Vercel Cron 集成
- [ ] 任务管理 UI
- [ ] 心跳任务系统
- [ ] 事件历史查看
- [ ] 使用统计

**验收标准**:
- 用户可以创建定时提醒
- 定时任务按时触发
- 用户可以查看历史事件

### Phase 4: 增强功能 (持续)

**目标**: 体验优化与扩展

**任务清单**:
- [ ] 多模型切换
- [ ] 语义搜索 (Embeddings)
- [ ] 技能系统
- [ ] MCP 协议支持
- [ ] 团队协作功能
- [ ] 管理后台
- [ ] 移动端适配

---

## 附录

### A. 环境变量

```env
# ===========================================
# Supabase (认证 + 元数据 + 实时订阅)
# ===========================================
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# ===========================================
# Acontext SDK (会话存储 + 文件操作 + 沙箱执行)
# ===========================================
ACONTEXT_API_KEY=
ACONTEXT_BASE_URL=https://api.acontext.com/api/v1

# ===========================================
# LLM Providers
# ===========================================
# 主 LLM (OpenRouter 推荐，支持多模型)
OPENAI_LLM_ENDPOINT=https://openrouter.ai/api/v1
OPENAI_LLM_API_KEY=
OPENAI_LLM_MODEL=anthropic/claude-opus-4-5
OPENAI_LLM_TEMPERATURE=0.7
OPENAI_LLM_MAX_TOKENS=4096

# 备选 LLM (可选)
OPENROUTER_API_KEY=
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# ===========================================
# Web Search
# ===========================================
BRAVE_SEARCH_API_KEY=

# ===========================================
# 渠道配置
# ===========================================
# Telegram
TELEGRAM_BOT_TOKEN=

# Discord
DISCORD_BOT_TOKEN=
DISCORD_APP_TOKEN=

# ===========================================
# 定时任务
# ===========================================
CRON_SECRET=

# ===========================================
# 安全
# ===========================================
ENCRYPTION_KEY=
```

### B. 技术依赖

```json
{
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",

    "@supabase/supabase-js": "^2.0.0",
    "@supabase/ssr": "^0.4.0",

    "@acontext/acontext": "latest",
    "openai": "^4.0.0",

    "zod": "^3.0.0",

    "tailwindcss": "^3.4.0",
    "@radix-ui/react-*": "latest",
    "lucide-react": "^0.500.0"
  }
}
```

### B.1 项目文件结构 (整合 Acontext)

```
lib/
├── supabase/
│   ├── client.ts              # 浏览器客户端
│   ├── server.ts              # 服务器客户端
│   └── proxy.ts               # 中间件
│
├── acontext/
│   ├── config.ts              # Acontext 配置
│   ├── client.ts              # 客户端封装
│   ├── session.ts             # 会话管理
│   ├── disk-tools.ts          # 磁盘工具
│   ├── sandbox.ts             # Python 沙箱
│   └── disk-protocol.ts       # disk:: 协议处理
│
├── llm/
│   ├── config.ts              # LLM 配置
│   ├── openai-client.ts       # OpenAI 客户端
│   └── tool-router.ts         # 工具路由
│
├── tools/
│   ├── web-search.ts          # 网页搜索
│   ├── web-fetch.ts           # 网页抓取
│   └── index.ts               # 工具注册
│
├── memory/
│   ├── builder.ts             # 记忆构建器
│   └── consolidator.ts        # 记忆合并
│
└── utils.ts                   # 通用工具
```

### C. 参考资源

- [Supabase Documentation](https://supabase.com/docs)
- [Acontext SDK Documentation](https://docs.acontext.com)
- [Vercel AI SDK](https://sdk.vercel.ai/docs)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Discord Developer Portal](https://discord.com/developers/docs)
- [OpenRouter API](https://openrouter.ai/docs)
- [OpenAI API Reference](https://platform.openai.com/docs)

### D. 可复制的代码文件

以下文件可以直接从 `.agent/skills/acontext-chatbot-integration/scripts/` 复制到项目：

| 源文件 | 目标位置 | 用途 |
|--------|---------|------|
| `types.ts` | `lib/types.ts` | 类型定义 |
| `config.ts` | `lib/acontext/config.ts` | 配置管理 |
| `acontext-client.ts` | `lib/acontext/client.ts` | SDK 封装 |
| `disk-tools.ts` | `lib/acontext/disk-tools.ts` | 磁盘工具 |
| `sandbox-tool.ts` | `lib/acontext/sandbox.ts` | Python 沙箱 |
| `openai-client.ts` | `lib/llm/openai-client.ts` | LLM 客户端 |

---

## 9. 审查反馈与修正

> 以下内容基于代码审查结果补充

### 9.1 需要补充的功能点

#### 9.1.1 内存合并逻辑 (Memory Consolidation)

**当前实现的关键特性**:
```python
# 当消息数 > memory_window 时自动触发
# 使用 LLM 进行智能内存压缩
# 增量合并：保留 recent_count 条消息，合并旧消息
# /new 命令触发完整内存归档
```

**数据库设计需要补充**:
```sql
-- 会话表需要添加内存相关字段
ALTER TABLE conversations ADD COLUMN memory_content TEXT;
ALTER TABLE conversations ADD COLUMN history_content TEXT;
ALTER TABLE conversations ADD COLUMN last_consolidated_at TIMESTAMPTZ;
ALTER TABLE conversations ADD COLUMN message_count_since_consolidation INTEGER DEFAULT 0;

-- 消息表需要添加合并标记
ALTER TABLE messages ADD COLUMN is_consolidated BOOLEAN DEFAULT FALSE;
```

#### 9.1.2 技能系统 (Skills)

**SkillsLoader 的复杂性**:
```typescript
interface SkillConfig {
  name: string;
  description: string;
  alwaysLoaded: boolean;      // 是否始终加载
  bins: string[];             // 依赖的可执行文件
  env: string[];              // 依赖的环境变量
  priority: 'workspace' | 'builtin';  // 加载优先级
  metadata: {
    version: string;
    author: string;
    triggers: string[];       // 触发关键词
  };
}
```

**数据库设计补充**:
```sql
-- 技能定义表
CREATE TABLE skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  skill_md TEXT,              -- SKILL.md 内容
  is_builtin BOOLEAN DEFAULT FALSE,
  required_bins TEXT[],
  required_env TEXT[],
  always_loaded BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 用户启用的技能
CREATE TABLE user_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  is_enabled BOOLEAN DEFAULT TRUE,
  custom_config JSONB DEFAULT '{}',
  UNIQUE(user_id, skill_id)
);
```

#### 9.1.3 子代理系统 (Subagents)

```typescript
// SubagentManager 支持后台任务
interface SubagentConfig {
  task: string;               // 任务描述
  label?: string;             // 标签
  parentSessionId: string;    // 父会话 ID
  channel: string;            // 渠道
  chatId: string;             // 聊天 ID
}
```

**数据库设计补充**:
```sql
-- 子代理任务表
CREATE TABLE subagent_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  task TEXT NOT NULL,
  label TEXT,
  status TEXT DEFAULT 'running', -- running, completed, failed
  result TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
```

#### 9.1.4 媒体文件处理

```python
# 当前实现
- 下载媒体文件到 ~/.nanobot/media
- 使用 Groq Whisper 进行语音转录
- 图像使用 Base64 编码上传给 LLM
```

**数据库设计补充**:
```sql
-- 媒体文件表
CREATE TABLE media_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  file_type TEXT NOT NULL,    -- image, audio, video, document
  file_name TEXT,
  storage_path TEXT NOT NULL, -- Supabase Storage 路径
  mime_type TEXT,
  file_size INTEGER,
  transcription TEXT,         -- 语音转录文本
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 9.1.5 工具上下文路由

```typescript
// 工具需要知道当前会话的路由信息
interface ToolContext {
  channel: string;    // web, telegram, discord
  chatId: string;     // 渠道内的聊天 ID
}

// 影响的工具:
// - MessageTool: 需要知道发送到哪个渠道
// - SpawnTool: 子代理需要继承路由信息
// - CronTool: 定时任务需要知道目标渠道
```

#### 9.1.6 Bootstrap 文件系统

```typescript
// 用于初始化代理身份的文件
const BOOTSTRAP_FILES = [
  'AGENTS.md',   // Agent 行为指导
  'SOUL.md',     // 人格/价值观
  'USER.md',     // 用户配置模板
  'TOOLS.md',    // 工具使用说明
  'IDENTITY.md'  // 身份定义
];
```

**数据库设计补充**:
```sql
-- 系统提示模板表
CREATE TABLE system_prompt_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 用户自定义系统提示
CREATE TABLE user_prompt_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  soul_override TEXT,         -- 覆盖 SOUL.md
  agents_override TEXT,       -- 覆盖 AGENTS.md
  custom_instructions TEXT,   -- 额外指令
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 9.2 数据库设计修正

#### 完整的消息表结构

```sql
-- 消息表 (修正版)
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL,

  -- 工具相关
  tool_calls JSONB,           -- 工具调用信息 [{name, arguments, id}]
  tool_call_id TEXT,          -- 工具响应关联 ID

  -- 媒体相关
  media_ids UUID[],           -- 关联的媒体文件 ID

  -- 元数据
  metadata JSONB DEFAULT '{}',
  tools_used TEXT[],          -- 使用的工具列表

  -- 内存合并相关
  is_consolidated BOOLEAN DEFAULT FALSE,

  -- 渠道信息
  channel TEXT,               -- 来源渠道
  channel_message_id TEXT,    -- 渠道原始消息 ID

  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 完整的会话表结构

```sql
-- 会话表 (修正版)
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT,

  -- 渠道信息
  channel TEXT NOT NULL DEFAULT 'web',
  channel_metadata JSONB DEFAULT '{}',

  -- 内存系统
  memory_content TEXT,        -- MEMORY.md 内容
  history_content TEXT,       -- HISTORY.md 内容
  last_consolidated_at TIMESTAMPTZ,
  message_count_since_consolidation INTEGER DEFAULT 0,

  -- 缓存字段
  cached_context TEXT,        -- 缓存的上下文
  context_updated_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 9.3 潜在技术风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| **迁移数据一致性** | 高 | 分阶段迁移，保留文件存储作为备份 |
| **内存合并逻辑** | 中 | 使用 Acontext editStrategies 进行令牌感知压缩 |
| **性能瓶颈** | 中 | 使用数据库连接池，考虑 Redis 缓存 |
| **工具执行安全** | 高 | 使用 Acontext Sandboxes 替代本地 exec |
| **会话缓存失效** | 中 | 实现缓存版本控制，智能失效策略 |
| **技能迁移复杂性** | 中 | 先迁移核心技能，逐步添加自定义技能 |
| **Acontext API 可用性** | 中 | 实现降级策略，关键数据同时存 Supabase |
| **disk:// 协议兼容** | 低 | 前端 URL 重写，支持多种图像格式 |

### 9.4 Acontext 集成优势

通过集成 Acontext SDK，迁移后的系统获得以下优势：

| 原生实现 | Acontext 实现 | 优势 |
|---------|--------------|------|
| 本地 Shell exec | Sandboxes Python 沙箱 | 安全隔离，无需担心恶意代码 |
| 文件系统存储 | Disks 云存储 | 可扩展，多实例共享 |
| 手动消息管理 | Sessions 自动管理 | 令牌感知压缩，避免上下文溢出 |
| 无工件支持 | Artifacts + CDN | 图片自动 CDN 分发 |
| 无协议支持 | disk:// 协议 | 永久图像引用，前端友好 |

### 9.5 修正后的实施路线

```
Phase 1: MVP (2-3 周)
├── 用户认证 (Supabase Auth)
├── Acontext SDK 集成  ← 新增
│   ├── Sessions (会话管理)
│   ├── Disks (文件存储)
│   └── Sandboxes (Python 执行)
├── Web 聊天界面
├── 对话 API (/api/chat) - Acontext 集成
├── 基础工具
│   ├── DISK_TOOLS (文件操作)
│   ├── web_search (网页搜索)
│   └── execute_python (沙箱执行)
├── 记忆系统 (Supabase 结构化 + Acontext 原始消息)
├── disk:// 协议支持  ← 新增
└── Bootstrap 系统提示

Phase 2: 多平台 (2 周)
├── Telegram Bot 集成
├── Discord Bot 集成
├── 工具上下文路由
├── 渠道管理 API
└── 消息路由 (多渠道共享 Acontext Session)

Phase 3: 高级功能 (2-3 周)
├── 定时任务 (Cron)
├── 子代理系统
├── 媒体文件处理
│   ├── 图片上传 (Acontext Artifacts)
│   └── 语音转录 (Groq Whisper)
├── 心跳任务系统
└── 事件历史

Phase 4: 增强功能 (持续)
├── 技能系统
├── 多模型支持
├── 语义搜索 (Embeddings)
├── MCP 协议支持
└── 管理后台
```

---

*文档版本: 1.2*
*最后更新: 2026-02-17*
*审查状态: 已通过代码验证 + Acontext SDK 集成*
