import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { getAuth } from "@clerk/react-router/server";
import {
  ensureUser,
  getUserSessions,
  deleteSession,
} from "~/lib/db/queries";

export async function loader(args: LoaderFunctionArgs) {
  const { userId: clerkUserId } = await getAuth(args);
  if (!clerkUserId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbUserId = await ensureUser(clerkUserId, { email: "", name: "User" });
  const sessions = await getUserSessions(dbUserId);
  return Response.json({ sessions });
}

export async function action(args: ActionFunctionArgs) {
  const { userId: clerkUserId } = await getAuth(args);
  if (!clerkUserId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbUserId = await ensureUser(clerkUserId, { email: "", name: "User" });
  const { request } = args;

  if (request.method === "DELETE") {
    const { sessionId } = await request.json();
    const deleted = await deleteSession(sessionId, dbUserId);
    if (!deleted) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }
    return Response.json({ success: true });
  }

  return new Response("Method not allowed", { status: 405 });
}
