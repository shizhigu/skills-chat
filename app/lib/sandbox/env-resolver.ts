/**
 * Resolves environment variables needed for each persona's sandbox.
 * Passes Anthropic auth/proxy config + persona-specific keys.
 */

/** Anthropic-related env vars to always forward to sandbox */
const ANTHROPIC_ENV_KEYS = [
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "API_TIMEOUT_MS",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
];

const PERSONA_ENV_KEYS: Record<string, string[]> = {
  "financial-advisor": ["FINANCIAL_DATASETS_API_KEY"],
  photographer: [],
  illustrator: [],
  "data-analyst": [],
  "legal-advisor": ["COURTLISTENER_API_KEY"],
  writer: [],
};

export function resolveSandboxEnvVars(
  personaSlug: string
): Record<string, string> {
  const env: Record<string, string> = {};

  // Forward all Anthropic-related env vars
  for (const key of ANTHROPIC_ENV_KEYS) {
    const value = process.env[key];
    if (value) {
      env[key] = value;
    }
  }

  // Must have at least one auth mechanism
  if (!env.ANTHROPIC_AUTH_TOKEN && !env.ANTHROPIC_API_KEY) {
    throw new Error(
      "Neither ANTHROPIC_AUTH_TOKEN nor ANTHROPIC_API_KEY is set"
    );
  }

  // Add persona-specific env vars
  const keys = PERSONA_ENV_KEYS[personaSlug] ?? [];
  for (const key of keys) {
    const value = process.env[key];
    if (value) {
      env[key] = value;
    }
  }

  return env;
}

/** Returns the default model from env vars or fallback */
export function getDefaultModel(): string {
  return (
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || "claude-sonnet-4-20250514"
  );
}
