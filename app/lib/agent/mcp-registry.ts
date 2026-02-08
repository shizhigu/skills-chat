interface McpServerDef {
  command: string;
  args: string[];
  env?: Record<string, string>;
  description: string;
}

type McpRegistry = Record<string, Record<string, McpServerDef>>;

/**
 * Registry of MCP servers by persona slug.
 * Each persona has a set of pre-configured MCP servers.
 */
export const MCP_REGISTRY: McpRegistry = {
  "financial-advisor": {
    "financial-datasets": {
      command: "npx",
      args: ["-y", "@financial-datasets/mcp-server"],
      env: { FINANCIAL_DATASETS_API_KEY: "${FINANCIAL_DATASETS_API_KEY}" },
      description: "Stock prices, financial statements, market news",
    },
    "sequential-thinking": {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-sequentialthinking"],
      description: "Step-by-step reasoning for complex problems",
    },
  },
  photographer: {
    "sharp-image": {
      command: "npx",
      args: ["-y", "sharp-mcp"],
      description: "Image processing: crop, color adjust, watermark",
    },
    "exif-reader": {
      command: "npx",
      args: ["-y", "exif-mcp"],
      description: "EXIF data: camera model, settings, GPS",
    },
  },
  illustrator: {
    "sharp-image": {
      command: "npx",
      args: ["-y", "sharp-mcp"],
      description: "Image processing and manipulation",
    },
    svgmaker: {
      command: "npx",
      args: ["-y", "svgmaker-mcp"],
      description: "AI-powered SVG generation and editing",
    },
    "color-scheme": {
      command: "npx",
      args: ["-y", "color-scheme-mcp"],
      description: "Color palette generation",
    },
  },
  "data-analyst": {
    dbhub: {
      command: "npx",
      args: ["-y", "@bytebase/dbhub", "--transport", "stdio"],
      env: { DATABASE_URL: "${USER_DB_URL}" },
      description: "Multi-database MCP (Postgres, MySQL, SQLite)",
    },
    echarts: {
      command: "npx",
      args: ["-y", "mcp-echarts"],
      description: "Interactive data visualization",
    },
    "sequential-thinking": {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-sequentialthinking"],
      description: "Step-by-step analysis reasoning",
    },
  },
  "legal-advisor": {
    "court-listener": {
      command: "npx",
      args: ["-y", "court-listener-mcp"],
      env: { COURTLISTENER_API_KEY: "${COURTLISTENER_API_KEY}" },
      description: "US court case search and federal regulations",
    },
    "legal-mcp": {
      command: "npx",
      args: ["-y", "@agentic-ops/legal-mcp"],
      description: "Legal document analysis and citation management",
    },
    "sequential-thinking": {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-sequentialthinking"],
      description: "Legal reasoning step by step",
    },
  },
  writer: {
    memory: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-memory"],
      description: "Persistent memory for writing preferences and style",
    },
  },
};

/**
 * Build MCP server configs for a persona, resolving environment variables.
 */
export function buildMcpServers(personaSlug: string) {
  const servers = MCP_REGISTRY[personaSlug];
  if (!servers) return {};

  const resolved: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};

  for (const [name, def] of Object.entries(servers)) {
    const env: Record<string, string> = {};
    if (def.env) {
      for (const [key, val] of Object.entries(def.env)) {
        // Resolve ${VAR} to actual env values
        const envVar = val.replace(/\$\{(\w+)\}/, (_, v) => process.env[v] ?? "");
        if (envVar) {
          env[key] = envVar;
        }
      }
    }

    resolved[name] = {
      command: def.command,
      args: def.args,
      ...(Object.keys(env).length > 0 ? { env } : {}),
    };
  }

  return resolved;
}
