import type { LoaderFunctionArgs } from "react-router";
import { db } from "~/lib/db";
import { sandboxes } from "~/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  const filePath = url.searchParams.get("path");

  if (!sessionId || !filePath) {
    return new Response(
      JSON.stringify({ error: "Missing sessionId or path" }),
      { status: 400 }
    );
  }

  // Look up active sandbox for this session
  const [sbRecord] = await db
    .select({ externalId: sandboxes.externalId })
    .from(sandboxes)
    .where(
      and(
        eq(sandboxes.sessionId, sessionId),
        inArray(sandboxes.status, ["running", "paused"])
      )
    )
    .limit(1);

  if (!sbRecord?.externalId) {
    return new Response(JSON.stringify({ error: "No active sandbox" }), {
      status: 404,
    });
  }

  try {
    const { Sandbox } = await import("e2b");
    const sandbox = await Sandbox.connect(sbRecord.externalId);
    const content = await sandbox.files.read(filePath, { format: "blob" });

    return new Response(content, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filePath.split("/").pop()}"`,
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Failed to read file",
      }),
      { status: 500 }
    );
  }
}
