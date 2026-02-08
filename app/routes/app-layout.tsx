import { Outlet, redirect, useLoaderData } from "react-router";
import { getAuth, createClerkClient } from "@clerk/react-router/server";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import { AppSidebar } from "~/components/layout/app-sidebar";
import { ensureUser, getUserSessions } from "~/lib/db/queries";

import type { Route } from "./+types/app-layout";

export async function loader(args: Route.LoaderArgs) {
  const { userId } = await getAuth(args);
  if (!userId) {
    throw redirect("/sign-in");
  }

  const clerkClient = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY,
  });
  const clerkUser = await clerkClient.users.getUser(userId);

  const name =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
    clerkUser.username ||
    "User";
  const email = clerkUser.emailAddresses[0]?.emailAddress ?? "";
  const avatarUrl = clerkUser.imageUrl ?? null;

  const dbUserId = await ensureUser(userId, { email, name, avatarUrl });

  const sessions = await getUserSessions(dbUserId, 10);

  return {
    user: { name, email, avatarUrl },
    dbUserId,
    sessions: sessions.map((s) => ({
      id: s.id,
      title: s.title,
      persona: {
        name: s.persona?.name ?? "对话",
        slug: s.persona?.slug ?? "",
      },
    })),
  };
}

export default function AppLayout() {
  const { sessions, user } = useLoaderData<typeof loader>();

  return (
    <SidebarProvider>
      <AppSidebar sessions={sessions} user={user} />
      <SidebarInset className="overflow-hidden">
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  );
}
