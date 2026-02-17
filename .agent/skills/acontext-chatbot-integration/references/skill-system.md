# Acontext Skill System

Acontext provides a complete Skill system for storing, discovering, and using reusable agent skills.

## Overview

| Component | Purpose | Use Case |
|-----------|---------|----------|
| **Skills API** | Upload/manage skills | Store your custom skills |
| **SKILL_TOOLS** | Read skill content | LLM reads skill docs without sandbox |
| **SANDBOX_TOOLS** | Execute skill scripts | Run Python/bash from skills |

## Skill ZIP Structure

```
my-skill.zip
├── SKILL.md          # Required: name, description, instructions
├── scripts/          # Optional: executable scripts
│   └── extract.py
└── resources/        # Optional: data files, templates
    └── template.json
```

SKILL.md must include frontmatter:
```yaml
---
name: data-extraction
description: Extract structured data from documents
---

# Data Extraction Skill
Instructions for the agent...
```

## Skills API

### Upload Skill

```ts
import { AcontextClient, FileUpload } from "@acontext/acontext";

const client = new AcontextClient({ apiKey: process.env.ACONTEXT_API_KEY });

// Upload skill from ZIP file
const skill = await client.skills.create({
  file: new FileUpload("my-skill.zip", zipBuffer),
  meta: { version: "1.0" }
});

console.log(`Created: ${skill.name} (${skill.id})`);
```

### Browse Catalog

```ts
const catalog = await client.skills.list_catalog();
for (const item of catalog.items) {
  console.log(`${item.name}: ${item.description}`);
}
```

### Get Skill Details

```ts
const skill = await client.skills.get(skill_id);
for (const file_info of skill.file_index) {
  console.log(`${file_info.path} (${file_info.mime})`);
}
```

### Read Skill File

```ts
// Text file
const result = await client.skills.get_file({
  skill_id: skill.id,
  file_path: "SKILL.md"
});
console.log(result.content.raw);

// Binary file (returns URL)
const imageResult = await client.skills.get_file({
  skill_id: skill.id,
  file_path: "images/diagram.png"
});
console.log(imageResult.url);
```

### Delete Skill

```ts
await client.skills.delete(skill.id);
```

## SKILL_TOOLS (Read-Only Access)

Use when skills contain only reference content (no scripts to execute).

```ts
import { SKILL_TOOLS } from "@acontext/acontext";

// Preload skills by UUID
const skillIds = ["uuid-of-skill-1", "uuid-of-skill-2"];
const ctx = SKILL_TOOLS.format_context(client, skillIds);

// Get tools and context
const tools = SKILL_TOOLS.to_openai_tool_schema();
const skillsContext = ctx.get_context_prompt();

// Add to system message
const messages = [
  { role: "system", content: `You have skill access.\n\n${skillsContext}` },
  { role: "user", content: "What guidelines are in the internal-comms skill?" }
];

// Execute tool calls
const result = await SKILL_TOOLS.execute_tool(ctx, "get_skill", {
  skill_name: "data-extraction"
});

const fileContent = await SKILL_TOOLS.execute_tool(ctx, "get_skill_file", {
  skill_name: "data-extraction",
  file_path: "SKILL.md"
});
```

**Available Tools:**

| Tool | Description |
|------|-------------|
| `get_skill` | Get skill metadata and file index |
| `get_skill_file` | Read a file from a skill |

## SANDBOX_TOOLS with Skills (Execute Scripts)

Use when skills have executable scripts.

```ts
import { SANDBOX_TOOLS } from "@acontext/acontext";

const sandbox = await client.sandboxes.create();
const disk = await client.disks.create();

// Mount skills into sandbox
const ctx = SANDBOX_TOOLS.format_context(
  client,
  sandbox.sandbox_id,
  disk.id,
  { mount_skills: ["skill-uuid-1", "skill-uuid-2"] }
);

// Skills available at /skills/{skill_name}/
const result = await SANDBOX_TOOLS.execute_tool(ctx, "bash_execution_sandbox", {
  command: "python3 /skills/my-skill/scripts/analyze.py",
  timeout: 30
});

// Cleanup
await client.sandboxes.kill(sandbox.sandbox_id);
```

## When to Use Which

| Scenario | Use |
|----------|-----|
| Read skill documentation | `SKILL_TOOLS` |
| Access skill templates/data | `SKILL_TOOLS` or direct API |
| Execute skill Python scripts | `SANDBOX_TOOLS` + `mount_skills` |
| Upload custom skills | Skills API (`client.skills.create`) |

## Related

- [Skills API Docs](https://docs.acontext.io/store/skill)
- [Skill Content Tools Docs](https://docs.acontext.io/tool/skill_tools)
- [Sandbox Tools](../SKILL.md#sandbox-tools-code-execution)
