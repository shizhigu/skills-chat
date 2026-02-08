import {
  type RouteConfig,
  index,
  layout,
  route,
} from "@react-router/dev/routes";

export default [
  // Public auth routes
  route("sign-in/*", "routes/sign-in.tsx"),
  route("sign-up/*", "routes/sign-up.tsx"),

  layout("routes/app-layout.tsx", [
    index("routes/home.tsx"),
    route("chat/new", "routes/chat-new.tsx"),
    route("chat/:sessionId", "routes/chat.tsx"),
    route("sessions", "routes/sessions.tsx"),
    route("settings", "routes/settings.tsx"),
  ]),

  // API routes
  route("api/chat/stream", "routes/api.chat.stream.ts"),
  route("api/sessions", "routes/api.sessions.ts"),
  route("api/sandbox/files", "routes/api.sandbox.files.ts"),
] satisfies RouteConfig;
