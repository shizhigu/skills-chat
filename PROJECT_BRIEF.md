# Skills Chat -- Project Brief

## 1. One-Liner

A full-stack AI chat platform that pairs pre-configured professional personas with composable skills and sandboxed code execution, powered by the Claude Agent SDK running inside E2B cloud sandboxes.

---

## 2. The Problem

Most AI chat interfaces are generic. You open ChatGPT or Claude, type a question, and get back a plausible-sounding response. But there is a gap between "plausible" and "expert." If you ask a general-purpose chatbot to review a contract, analyze a financial statement, or critique a photograph, the response lacks the structured methodology, domain-specific prompting, and specialized tooling that a real professional would bring to the task.

The underlying issue is threefold:

**Prompt engineering is invisible labor.** Getting high-quality, domain-specific output from an LLM requires carefully crafted system prompts. Most users do not know how to write them, and the ones who do end up re-writing the same prompts across sessions. There is no way to package expertise into a reusable unit.

**Skills are not composable.** A financial advisor needs different skills for statement analysis versus tax planning. These skills have different workflows, different output requirements, and different tool dependencies. Current chat interfaces treat every conversation identically -- there is no mechanism to attach domain knowledge modules to a conversation.

**Tool use requires infrastructure.** Real expert work involves running code, querying databases, processing images, and generating files. A chat interface that only produces text cannot do any of this. The Claude Agent SDK supports tool use, but running it requires a sandboxed execution environment that most applications do not provide.

The result: developers who want to build domain-specific AI assistants must wire together authentication, database persistence, prompt management, skill composition, sandbox orchestration, and streaming UI from scratch. There is no reference architecture for this.

---

## 3. The Solution

Skills Chat is a reference implementation of a persona-and-skills AI chat platform. It demonstrates how to build a production-grade application that combines:

- **Personas** -- pre-configured AI roles (Financial Advisor, Photographer, Illustrator, Data Analyst, Legal Advisor, Writer), each with a tailored system prompt, greeting message, and category. Personas are stored in the database, seeded from presets, and editable at runtime.

- **Skills** -- composable knowledge modules written as Markdown documents (`SKILL.md`). Each skill defines when to activate, a step-by-step workflow, and specific output requirements. Skills are stored in the database, mapped to personas through a many-to-many relationship, and injected into the sandbox filesystem at runtime. The Claude Agent SDK reads them from `~/.claude/skills/` exactly as it would in a local development environment.

- **Sandboxed execution** -- every chat conversation runs the Claude Agent SDK inside an E2B cloud sandbox. The sandbox has full access to Bash, file I/O, and code execution. The agent can install packages, run scripts, read and write files, and use MCP servers -- all isolated from the host server.

- **Streaming persistence** -- messages stream from the sandbox through the server to the browser via Server-Sent Events. Every message, including multi-part tool calls and tool results, is persisted to a PostgreSQL database with full provenance tracking (token counts, latency, cost).

- **Session continuity** -- the Claude Agent SDK supports session resumption. Skills Chat tracks agent session IDs so that follow-up messages within a conversation resume the same agent context, maintaining tool state and conversation history.

The user experience is straightforward: sign in, pick a persona, start chatting. Behind the scenes, the system assembles the system prompt, loads the persona's skills, provisions a sandbox, injects the skills into the sandbox filesystem, runs the agent, streams results back, and persists everything.

---

## 4. Architecture Overview

The system has four layers:

```
Browser (React 19 + React Router v7)
    |
    | SSE stream (text/event-stream)
    |
Server (React Router SSR + API routes)
    |
    |--- Neon PostgreSQL (via Drizzle ORM, neon-http driver)
    |
    |--- E2B Cloud Sandbox
              |
              |--- Claude Agent SDK (query() function)
              |--- MCP Servers (per-persona tool chain)
              |--- Skills (SKILL.md files on filesystem)
```

**Request flow for a chat message:**

1. The browser sends a POST to `/api/chat/stream` with `sessionId`, `message`, and `personaSlug`.
2. The server authenticates via Clerk middleware, loads the persona and its skills from the database, and resolves environment variables.
3. The server ensures DB records exist: user (synced from Clerk), persona (created from preset if missing), and session.
4. The server saves the user message to the database and creates a streaming assistant message placeholder.
5. `runAgentInSandbox()` either reconnects to an existing E2B sandbox for this session or creates a new one. On creation, it installs `@anthropic-ai/claude-agent-sdk` via npm.
6. The agent runner script (`agent-runner.mjs`) and an input JSON file are written into the sandbox filesystem. Skills are written as `SKILL.md` files under `~/.claude/skills/{slug}/`.
7. The sandbox executes `node agent-runner.mjs`, which calls `query()` from the Claude Agent SDK. The agent SDK handles multi-turn tool use, MCP server connections, and skill file reading internally.
8. The agent runner emits NDJSON lines to stdout. The sandbox manager on the server parses these lines in real-time and forwards them as SSE events to the browser.
9. The browser reads the SSE stream, appends text deltas to the assistant message, and renders them with animated markdown via the `streamdown` library.
10. When the agent finishes, the server persists the complete assistant message (with token usage metadata) and updates the session.

**Key architectural decisions:**

- **Sandbox-per-session, not sandbox-per-request.** The sandbox stays alive (auto-paused by E2B) between messages in the same session. This means the agent's working directory, installed packages, and generated files persist across turns.
- **NDJSON over stdout, not WebSocket.** Communication between the sandbox and the server uses stdout line parsing. This is simpler than establishing a WebSocket connection inside the sandbox and avoids port management.
- **Skills as filesystem artifacts.** Instead of passing skills as prompt context, Skills Chat writes them to the filesystem where the Claude Agent SDK naturally discovers them. This mirrors the local development workflow and keeps prompt tokens low.
- **Demo mode fallback.** If Anthropic API keys or E2B keys are not configured, the system falls back to a character-by-character demo response. This makes the app functional for showcasing without incurring API costs.

---

## 5. Technical Deep Dive

### 5.1 Persona and Skill System

The persona system has two layers: **presets** and **database records**.

Presets live in `app/lib/personas.ts` and define the client-side presentation -- icon component, color, display name. Database records in the `personas` table store the system prompt, model configuration, sandbox configuration, and MCP server configs. The `ensurePersonaBySlug()` function creates a database record from a preset on first use, enabling a zero-setup developer experience.

Skills are stored in the `skills` table with a full Markdown `prompt` column. The `persona_skills` join table maps skills to personas with a `skill_type` field (default or optional) and a sort order. When a chat session starts, the server loads all skills for the persona and passes them as `{ slug, content }` pairs to the sandbox manager.

Inside the sandbox, `agent-runner.mjs` writes each skill to `~/.claude/skills/{slug}/SKILL.md`. The Claude Agent SDK reads these files during initialization because the agent runner passes `settingSources: ["user"]` and includes `"Skill"` in `allowedTools`. This means the agent can invoke skills by name during a conversation.

Skills are editable from the UI. The persona card's dropdown menu opens a dialog that lazy-loads the full skill prompt (to avoid transferring large Markdown documents on page load), lets the user edit it, and saves via a React Router form action. The next conversation with that persona will use the updated skill.

### 5.2 Sandbox Orchestration

The `sandbox-manager.ts` module manages the E2B sandbox lifecycle:

- **Lazy loading**: The E2B SDK is dynamically imported (`await import("e2b")`) to avoid ESM/CJS issues on Vercel and to keep the module from crashing when E2B is not configured.
- **In-memory tracking**: A `Map<sessionId, sandboxId>` and a `Map<sessionId, agentSessionId>` track active sandboxes and agent sessions. This enables sandbox reuse across messages and agent session resumption.
- **Auto-pause**: Sandboxes are created with `autoPause: true` and a 10-minute timeout. E2B pauses idle sandboxes automatically, and `Sandbox.connect()` resumes them on the next message.
- **SDK installation**: On first sandbox creation, the manager runs `npm install @anthropic-ai/claude-agent-sdk` inside the sandbox. This takes about 30 seconds but only happens once per session.

The agent runner itself is a standalone ESM script (`sandbox/agent-runner.mjs`) that is read from the project filesystem at server startup and written into each sandbox. It calls the Claude Agent SDK's `query()` function with carefully configured options:

- `permissionMode: "bypassPermissions"` -- the sandbox is already isolated, so there is no need for interactive permission prompts.
- `maxTurns: 30` -- prevents runaway agent loops.
- `maxBudgetUsd: 5.0` -- hard cap on per-query spending.
- `allowedTools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Skill"]` -- the agent can execute shell commands, read and write files, and invoke skills.
- MCP servers are configured per-persona from `mcp-registry.ts`, which maps persona slugs to MCP server definitions (financial datasets, image processing, database hub, legal search, etc.).

### 5.3 MCP Server Registry

The MCP (Model Context Protocol) registry in `app/lib/agent/mcp-registry.ts` defines tool servers for each persona:

- **Financial Advisor**: `@financial-datasets/mcp-server` (stock prices, financial statements) + `@modelcontextprotocol/server-sequentialthinking` (step-by-step reasoning)
- **Photographer**: `sharp-mcp` (image processing) + `exif-mcp` (EXIF data reading)
- **Illustrator**: `sharp-mcp` + `svgmaker-mcp` (SVG generation) + `color-scheme-mcp` (palette generation)
- **Data Analyst**: `@bytebase/dbhub` (multi-database access) + `mcp-echarts` (interactive visualization) + sequential thinking
- **Legal Advisor**: `court-listener-mcp` (US court case search) + `@agentic-ops/legal-mcp` (legal document analysis) + sequential thinking
- **Writer**: `@modelcontextprotocol/server-memory` (persistent memory for writing preferences)

Environment variables like `FINANCIAL_DATASETS_API_KEY` are resolved from `process.env` using a `${VAR}` template syntax in `buildMcpServers()`.

### 5.4 Database Design

The database schema (`app/lib/db/schema.ts`) contains 12 tables designed for a serverless PostgreSQL environment (Neon):

The **message parts** pattern is the most consequential design choice. Instead of storing message content as a JSONB blob on the messages table, each message has multiple typed parts in a separate `message_parts` table: text, reasoning, tool_call, tool_result, file, image, error. This follows the pattern pioneered by Vercel's AI SDK persistence layer and provides several advantages: parts can be individually updated during streaming, JSONB queries are avoided (which perform poorly without statistics), and the schema is self-documenting.

Other notable patterns:
- **System prompt snapshots**: Each session stores the system prompt used at creation time, so historical conversations are reproducible even after the persona's prompt is edited.
- **Integer ordinals**: Messages use a monotonically increasing ordinal instead of timestamp ordering, which is deterministic and avoids clock skew issues.
- **Partial indexes**: All soft-deleted tables use partial indexes (`WHERE deleted_at IS NULL`) so that active-record queries never scan deleted rows.
- **Denormalized session stats**: `message_count`, `total_tokens`, and `last_message_at` are stored directly on the sessions table to avoid aggregation queries on the session list sidebar.

### 5.5 Streaming and Markdown Rendering

The chat message component uses `streamdown` with the `@streamdown/code` and `@streamdown/cjk` plugins for animated markdown rendering. `streamdown` is designed specifically for streaming LLM output -- it renders partial markdown correctly as tokens arrive, handles code blocks with syntax highlighting, and provides smooth CJK character rendering (critical for this Chinese-language application).

The SSE protocol is simple: `data: {JSON}\n\n` lines. The browser reads the stream with `ReadableStream.getReader()`, splits on double newlines, and dispatches based on event type (`text_delta`, `tool_call`, `error`, `done`). An `AbortController` ref allows the user to cancel a streaming response.

### 5.6 Authentication

Authentication is handled entirely by Clerk, using the `@clerk/react-router` integration. The root layout applies `clerkMiddleware()`, and the app layout loader checks for authentication and redirects to `/sign-in` if needed. On first authenticated request, the server syncs the Clerk user to the local `users` table via `ensureUser()`, which creates a record with the Clerk ID as `auth_provider_id`.

---

## 6. Tech Stack

| Layer | Technology | Role |
|-------|-----------|------|
| **Framework** | React Router v7 (SSR mode) | Full-stack React framework with server-side rendering, typed loaders/actions |
| **UI** | React 19, Tailwind CSS v4, shadcn/ui (new-york) | Component library with 20+ UI primitives |
| **Markdown** | streamdown + @streamdown/code + @streamdown/cjk | Animated streaming markdown rendering |
| **State** | Zustand | Lightweight client-side state management |
| **Forms** | React Hook Form + Zod | Form validation (available but not heavily used yet) |
| **Auth** | Clerk (@clerk/react-router) | Authentication, user management, session middleware |
| **Database** | Neon PostgreSQL (serverless) | Auto-scaling, auto-suspend, connection pooling |
| **ORM** | Drizzle ORM (neon-http driver) | Type-safe SQL, 7.4KB bundle, zero cold-start overhead |
| **AI** | Claude Agent SDK (@anthropic-ai/claude-agent-sdk) | Multi-turn agent with tool use, skill files, session resumption |
| **Sandbox** | E2B (cloud sandboxes) | Isolated execution environment for agent code |
| **MCP** | Model Context Protocol servers | Domain-specific tool chains (financial data, image processing, etc.) |
| **Build** | Vite 7, TypeScript 5.9 | Fast HMR, strict type checking |
| **Runtime** | Bun | Package manager and production server |
| **Container** | Docker (multi-stage, oven/bun base) | Four-stage build: deps, prod-deps, build, runtime |
| **Icons** | Lucide React | Consistent icon set |

---

## 7. Challenges & Solutions

### Running the Claude Agent SDK inside a cloud sandbox

**Challenge:** The Claude Agent SDK is designed to run locally on a developer's machine. It expects filesystem access, environment variables, and a long-running process. Running it inside an ephemeral E2B sandbox required bridging two execution contexts.

**Solution:** The agent runner pattern. A standalone Node.js script (`agent-runner.mjs`) is injected into the sandbox at runtime. It reads configuration from a JSON file, writes skills to the expected filesystem paths, calls `query()`, and emits structured NDJSON events to stdout. The server parses stdout line-by-line in real-time, converting sandbox output to SSE events. This approach avoids any custom networking between the sandbox and the host -- it is just stdout.

### E2B SDK ESM/CJS compatibility

**Challenge:** The E2B SDK depends on `chalk` v5, which is ESM-only. When Vite bundles the server for production, it leaves `e2b` as an external dependency. On Vercel's Node.js runtime, `require("chalk")` fails because Node.js cannot require an ESM module.

**Solution:** Two complementary fixes. First, `vite.config.ts` sets `ssr.noExternal: ["e2b"]` to force Vite to bundle e2b into the server output, letting Vite handle the ESM/CJS conversion. Second, the E2B Sandbox class is dynamically imported (`await import("e2b")`) so the module only loads when actually needed, preventing import-time crashes.

### Sandbox cold start latency

**Challenge:** Creating a new E2B sandbox and installing the Claude Agent SDK takes 30-60 seconds. This is an unacceptable wait for a chat application.

**Solution:** Sandbox-per-session reuse. Once a sandbox is created for a session, its ID is stored in memory. Subsequent messages in the same session reconnect to the existing (possibly auto-paused) sandbox, which resumes in 1-2 seconds. The `npm install` step only runs once per sandbox lifecycle.

### Keeping skills out of the system prompt

**Challenge:** Injecting skill documents directly into the system prompt would consume thousands of tokens per message, increasing cost and reducing the available context window.

**Solution:** Skills are written to the sandbox filesystem at `~/.claude/skills/{slug}/SKILL.md`, exactly where the Claude Agent SDK looks for them. The SDK loads them as needed during tool use, not upfront. This keeps the system prompt lean (just the persona's role definition) while making the full skill library available to the agent.

### Streaming markdown rendering for CJK text

**Challenge:** Standard markdown renderers do not handle streaming partial text well -- they produce visual glitches as incomplete markdown syntax arrives. CJK (Chinese/Japanese/Korean) text has additional challenges with word boundaries and line breaking.

**Solution:** The `streamdown` library with the `@streamdown/cjk` plugin, purpose-built for streaming LLM output. It renders partial markdown correctly, handles code blocks mid-stream, and provides smooth CJK text animation. The CSS includes `@source` directives to ensure Tailwind scans streamdown's class names.

### Zero-configuration development experience

**Challenge:** The application has many external dependencies (Neon database, Clerk auth, E2B sandbox, Anthropic API). A new developer should be able to run the app without configuring all of them.

**Solution:** Graceful degradation at every layer. The `demoMode()` function returns a simulated streaming response if Anthropic or E2B keys are missing. Database operations are wrapped in try-catch and logged as non-fatal errors if they fail. Personas are seeded from presets on first use. The app remains functional (with reduced capabilities) even with zero environment variables configured.

---

## 8. What I Learned

**The Claude Agent SDK is best treated as an execution engine, not a library.** Running it inside a sandbox, rather than in-process on the server, provides isolation, reproducibility, and access to a full filesystem and shell. The trade-off is latency and operational complexity, but the architectural cleanliness is worth it for a production system.

**Skills as filesystem artifacts are more powerful than skills as prompt injection.** When skills live on the filesystem, the agent can read them on demand, reducing prompt token usage. The Claude Agent SDK's built-in skill discovery mechanism (scanning `~/.claude/skills/`) means the application does not need to implement skill routing logic -- the SDK handles it.

**NDJSON over stdout is a surprisingly robust IPC mechanism.** It is simple to implement, easy to debug (just `console.error` for logging), and naturally handles backpressure. The server reads lines as they arrive, which gives real-time streaming without any framework overhead.

**Drizzle ORM's design philosophy pays off in serverless environments.** Zero cold-start overhead, a tiny bundle, and native Neon driver support make it the right choice for this architecture. The SQL-like API also means there are no surprises when debugging query performance -- the TypeScript code maps directly to the generated SQL.

**The message parts pattern is essential for AI chat persistence.** Storing messages as typed, ordered parts (text, tool_call, tool_result) rather than flat strings or JSONB blobs makes it possible to accurately reconstruct complex multi-tool conversations. It also enables partial updates during streaming without rewriting the entire message.

**System prompt snapshots prevent subtle bugs.** If a persona's prompt is edited after a conversation starts, replaying the conversation would produce different results. Snapshotting the prompt at session creation time ensures every session is self-contained and reproducible.

**Docker multi-stage builds with Bun are fast.** The four-stage Dockerfile (dependency installation, production-only dependencies, build, runtime) produces a minimal image. Bun's install speed and the `oven/bun` base image keep build times low. Copying the `sandbox/` directory into the final image ensures the agent runner script is available at runtime.

---

## 9. Motivation & Context

Skills Chat started as an exploration of a question: what would it look like to build a chat application where the AI is not just answering questions, but actually functioning as a domain expert with tools, skills, and a working environment?

Most AI chat products in 2025-2026 follow the same pattern: a text box, a system prompt, and an API call. The user types, the model responds, and the conversation is a flat sequence of text exchanges. This is fine for casual use, but it falls short when the task requires structured methodology, tool use, or iterative work.

The persona-and-skills architecture addresses this by separating three concerns that are typically conflated:

1. **Who is the AI?** (persona -- system prompt, model configuration, greeting)
2. **What can the AI do?** (skills -- structured workflows, output requirements)
3. **What tools does the AI have?** (MCP servers -- external data sources, file processors)

This separation makes each concern independently composable and editable. You can swap a persona's skills without changing its personality. You can add an MCP server without rewriting prompts. You can edit a skill's workflow without affecting other skills.

The project is also a technical reference for several integration patterns that are not well-documented elsewhere: running the Claude Agent SDK inside E2B sandboxes, streaming sandbox output through SSE, persisting multi-part agent messages to PostgreSQL, and composing MCP servers per persona. Each of these patterns required solving non-obvious problems (ESM/CJS compatibility, stdout buffering, session resumption tracking), and this codebase serves as a working example.

The Chinese-language UI reflects the initial target audience and also served as a testing ground for CJK text streaming, which has unique rendering challenges compared to Latin-script text.

---

## 10. Status

**Current state: functional prototype.** The core loop works end-to-end: sign in, pick a persona, chat with streaming responses, persist messages, resume conversations. Six personas and twelve skills are seeded. The settings page and some features (file attachments, token usage display, user API key management) are scaffolded but not yet wired up.

**What works:**
- Full authentication flow with Clerk (sign up, sign in, session management)
- Six professional personas with tailored system prompts and greeting messages
- Twelve domain-specific skills (two per persona) stored in database, editable from UI
- E2B sandbox creation, reuse, and auto-pause
- Claude Agent SDK execution with skill file injection and MCP server configuration
- Real-time streaming from sandbox to browser via SSE
- Message persistence with the message parts pattern
- Session history in sidebar with persona metadata
- Skill editing and system prompt editing from the persona card
- Docker deployment with Bun runtime
- Demo mode fallback when API keys are not configured

**What is scaffolded but not complete:**
- File attachment handling in the chat input
- Token usage display per message
- User-provided API key management (settings page shows "coming soon")
- Dark mode toggle (switch is rendered but not wired to state)
- Skills marketplace (route exists, lists skills, allows editing, but no install/uninstall flow)
- MCP server display in persona card (shows "0 MCP" as placeholder)

**Known limitations:**
- Sandbox tracking is in-memory (`Map`), not in the database. Server restarts lose sandbox associations.
- Agent session IDs are also in-memory. Multi-server deployments would lose session continuity.
- No rate limiting or usage quota enforcement.
- The Clerk user sync uses minimal data (empty email, "User" name) on the chat stream path; full sync only happens on the app layout loader.
