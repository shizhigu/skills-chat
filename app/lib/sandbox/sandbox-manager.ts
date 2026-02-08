import { Sandbox } from "e2b";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Types ───────────────────────────────────────────────────────────────────

export interface SandboxEvent {
  type:
    | "init"
    | "text_delta"
    | "tool_call"
    | "tool_result"
    | "done"
    | "error";
  [key: string]: unknown;
}

export interface SkillFile {
  slug: string;
  content: string;
}

export interface RunAgentOptions {
  sessionId: string;
  message: string;
  systemPrompt: string;
  personaSlug: string;
  model?: string;
  envVars: Record<string, string>;
  mcpServers?: Array<{
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
  skills?: SkillFile[];
  onEvent: (event: SandboxEvent) => void;
}

// ── Agent runner source (read once at startup) ──────────────────────────────

const AGENT_RUNNER_SOURCE = readFileSync(
  join(process.cwd(), "sandbox", "agent-runner.mjs"),
  "utf-8"
);

const SANDBOX_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes for agent execution

// ── In-memory sandbox tracking ──────────────────────────────────────────────
// Maps sessionId → E2B sandboxId. Later this moves to DB when auth is added.

const sandboxMap = new Map<string, string>();
const agentSessionMap = new Map<string, string>();

// ── Core function ───────────────────────────────────────────────────────────

export async function runAgentInSandbox(
  opts: RunAgentOptions
): Promise<void> {
  const {
    sessionId,
    message,
    systemPrompt,
    model = "claude-sonnet-4-20250514",
    envVars,
    mcpServers = [],
    skills = [],
    onEvent,
  } = opts;

  // 1. Get or create sandbox
  const sandbox = await getOrCreateSandbox(sessionId, envVars);

  // 2. Look up agentSessionId for resume
  const agentSessionId = agentSessionMap.get(sessionId) || null;

  // 3. Write agent-input.json into sandbox
  const agentInput = {
    message,
    systemPrompt,
    model,
    mcpServers,
    agentSessionId,
    skills,
    cwd: "/home/user",
  };

  await sandbox.files.write(
    "/home/user/agent-input.json",
    JSON.stringify(agentInput, null, 2)
  );

  // 4. Write agent-runner.mjs into sandbox
  await sandbox.files.write("/home/user/agent-runner.mjs", AGENT_RUNNER_SOURCE);

  // 5. Run agent-runner.mjs with NDJSON stdout parsing (cwd = /home/user so node_modules resolves)
  let stdoutBuffer = "";

  const result = await sandbox.commands.run(
    "node /home/user/agent-runner.mjs /home/user/agent-input.json",
    {
      cwd: "/home/user",
      envs: envVars,
      timeoutMs: COMMAND_TIMEOUT_MS,
      onStdout: (data: string) => {
        stdoutBuffer += data;

        // Parse complete NDJSON lines
        const lines = stdoutBuffer.split("\n");
        // Keep the last (potentially incomplete) line in the buffer
        stdoutBuffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const event = JSON.parse(trimmed) as SandboxEvent;

            // Persist session ID from init or done events
            const sid =
              (event.type === "init" && event.agentSessionId) ||
              (event.type === "done" && event.sessionId);
            if (sid) {
              agentSessionMap.set(sessionId, sid as string);
            }

            onEvent(event);
          } catch {
            console.error(
              "[sandbox-manager] Failed to parse NDJSON line:",
              trimmed
            );
          }
        }
      },
      onStderr: (data: string) => {
        console.error("[sandbox-stderr]", data);
      },
    }
  );

  // 6. Process any remaining buffer
  if (stdoutBuffer.trim()) {
    try {
      const event = JSON.parse(stdoutBuffer.trim()) as SandboxEvent;
      onEvent(event);
    } catch {
      console.error(
        "[sandbox-manager] Trailing buffer not valid JSON:",
        stdoutBuffer
      );
    }
  }

  // 7. Handle non-zero exit code
  if (result.exitCode !== 0) {
    console.error(
      `[sandbox-manager] Agent exited with code ${result.exitCode}`
    );
    onEvent({
      type: "error",
      message: `Agent process exited with code ${result.exitCode}`,
    });
  }
}

// ── Sandbox lifecycle ───────────────────────────────────────────────────────

async function getOrCreateSandbox(
  sessionId: string,
  envVars: Record<string, string>
): Promise<Sandbox> {
  // Check in-memory map for an existing sandbox
  const existingId = sandboxMap.get(sessionId);

  if (existingId) {
    try {
      console.error(
        `[sandbox-manager] Reconnecting to sandbox ${existingId}`
      );
      const sandbox = await Sandbox.connect(existingId, {
        timeoutMs: SANDBOX_TIMEOUT_MS,
      });
      return sandbox;
    } catch (err) {
      console.error(
        "[sandbox-manager] Failed to reconnect, creating new sandbox:",
        err
      );
      sandboxMap.delete(sessionId);
    }
  }

  // Create new sandbox
  console.error("[sandbox-manager] Creating new E2B sandbox...");

  const sandbox = await Sandbox.create({
    timeoutMs: SANDBOX_TIMEOUT_MS,
    envs: envVars,
    metadata: { sessionId },
  });

  console.error(
    `[sandbox-manager] Sandbox created: ${sandbox.sandboxId}`
  );

  // Track in memory
  sandboxMap.set(sessionId, sandbox.sandboxId);

  // Initialize package.json and install Agent SDK locally in /home/user
  console.error(
    "[sandbox-manager] Installing @anthropic-ai/claude-agent-sdk..."
  );
  await sandbox.commands.run("npm init -y 2>&1", {
    cwd: "/home/user",
    timeoutMs: 30_000,
  });
  const installResult = await sandbox.commands.run(
    "npm install @anthropic-ai/claude-agent-sdk 2>&1",
    { cwd: "/home/user", timeoutMs: 120_000 }
  );

  if (installResult.exitCode !== 0) {
    console.error(
      "[sandbox-manager] npm install failed:",
      installResult.stdout
    );
    throw new Error(
      `Failed to install Agent SDK in sandbox: ${installResult.stdout}`
    );
  }
  console.error("[sandbox-manager] Agent SDK installed successfully");

  return sandbox;
}

export async function destroySandbox(sessionId: string): Promise<void> {
  const existingId = sandboxMap.get(sessionId);
  if (!existingId) return;

  try {
    const sandbox = await Sandbox.connect(existingId);
    await sandbox.kill();
  } catch {
    // Sandbox may already be dead
  }

  sandboxMap.delete(sessionId);
  agentSessionMap.delete(sessionId);
}
