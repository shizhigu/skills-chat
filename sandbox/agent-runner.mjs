/**
 * agent-runner.mjs — Runs inside E2B sandbox
 *
 * Reads agent-input.json, calls query() from Claude Agent SDK,
 * and outputs NDJSON lines to stdout for the server to parse.
 *
 * All debug logging goes to stderr (console.error).
 *
 * SDK Message types (from docs):
 *   SDKSystemMessage         — type: 'system', subtype: 'init', session_id, tools, model
 *   SDKAssistantMessage      — type: 'assistant', message: { content: [...] }
 *   SDKPartialAssistantMessage — type: 'stream_event', event: RawMessageStreamEvent
 *   SDKResultMessage         — type: 'result', subtype: 'success'|'error_*', session_id, usage, total_cost_usd
 *   SDKUserMessage           — type: 'user', message: { content: [...] }
 */

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { query } from "@anthropic-ai/claude-agent-sdk";

// ── Read input ──────────────────────────────────────────────────────────────
const inputPath = process.argv[2] || "/home/user/agent-input.json";
const input = JSON.parse(readFileSync(inputPath, "utf-8"));

const {
  message,
  systemPrompt,
  model = "claude-sonnet-4-20250514",
  mcpServers = [],
  agentSessionId,
  skills = [],
  cwd = "/home/user",
} = input;

console.error(`[agent-runner] Starting agent, model=${model}, resume=${agentSessionId || "none"}`);

/** Write one NDJSON line to stdout */
function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

// ── Set up skills on filesystem ─────────────────────────────────────────────
for (const skill of skills) {
  const skillDir = `/home/user/.claude/skills/${skill.slug}`;
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(`${skillDir}/SKILL.md`, skill.content, "utf-8");
  console.error(`[agent-runner] Wrote skill: ${skillDir}/SKILL.md`);
}

// ── Build MCP config ────────────────────────────────────────────────────────
const mcpConfig = {};
for (const server of mcpServers) {
  mcpConfig[server.name] = {
    command: server.command,
    args: server.args || [],
    env: server.env || {},
  };
}

// ── Build query options ─────────────────────────────────────────────────────
const options = {
  model,
  systemPrompt,
  maxTurns: 30,
  maxBudgetUsd: 5.0,
  cwd,
  permissionMode: "bypassPermissions",
  allowDangerouslySkipPermissions: true,
  includePartialMessages: true,
  settingSources: skills.length > 0 ? ["user"] : [],
  allowedTools: [
    "Bash",
    "Read",
    "Write",
    "Edit",
    "Glob",
    "Grep",
    ...(skills.length > 0 ? ["Skill"] : []),
  ],
};

if (Object.keys(mcpConfig).length > 0) {
  options.mcpServers = mcpConfig;
}

if (agentSessionId) {
  options.resume = agentSessionId;
}

// ── Run agent ───────────────────────────────────────────────────────────────
try {
  const response = query({ prompt: message, options });

  for await (const msg of response) {
    console.error(`[agent-runner] msg.type=${msg.type} subtype=${msg.subtype || ""}`);

    switch (msg.type) {
      // ── System init: session_id, tools, model ──
      case "system": {
        if (msg.subtype === "init") {
          emit({
            type: "init",
            agentSessionId: msg.session_id,
            model: msg.model,
            tools: msg.tools,
          });
        }
        break;
      }

      // ── Streaming partial: RawMessageStreamEvent from Anthropic SDK ──
      case "stream_event": {
        const event = msg.event;
        if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            emit({ type: "text_delta", text: event.delta.text });
          }
        }
        break;
      }

      // ── Final assistant message ──
      case "assistant": {
        const content = msg.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_use") {
              emit({
                type: "tool_call",
                toolName: block.name,
                toolCallId: block.id,
                toolInput: block.input,
              });
            }
          }
        }
        break;
      }

      // ── Result: success or error ──
      case "result": {
        emit({
          type: "done",
          subtype: msg.subtype,
          sessionId: msg.session_id,
          usage: msg.usage || null,
          totalCostUsd: msg.total_cost_usd || null,
          isError: msg.is_error || false,
          numTurns: msg.num_turns || 0,
          ...(msg.subtype === "success"
            ? { result: msg.result }
            : { errors: msg.errors }),
        });
        break;
      }

      // ── User messages (replays during resume) — skip ──
      case "user":
        break;

      default:
        console.error(`[agent-runner] Unknown msg.type: ${msg.type}`);
    }
  }
} catch (err) {
  console.error(`[agent-runner] Error: ${err.message}`);
  emit({ type: "error", message: err.message });
  process.exit(1);
}
