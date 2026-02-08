import { redirect } from "react-router";
import type { Route } from "./+types/chat-new";
import { getPersonaPreset } from "~/lib/personas";

export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const personaSlug = url.searchParams.get("persona");

  if (!personaSlug) {
    return redirect("/");
  }

  const persona = getPersonaPreset(personaSlug);
  if (!persona) {
    return redirect("/");
  }

  // Generate a temporary session ID.
  // In production, this would create a session in the database.
  const tempSessionId = crypto.randomUUID();

  return redirect(`/chat/${tempSessionId}?persona=${personaSlug}&new=1`);
}

export default function ChatNew() {
  return null;
}
