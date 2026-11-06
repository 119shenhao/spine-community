// Spine Community read-only scaffold. No public writes are allowed.
interface Env {
  ASSETS: Fetcher;
  DB?: D1Database;
}
type Category = { slug: string; name: string; description: string };
const categories: Category[] = [
  { slug: "neck", name: "Neck & Cervical Spine", description: "Neck pain, stiffness, and cervical spine experiences." },
  { slug: "lower-back", name: "Lower Back & Lumbar Spine", description: "Low back pain, sciatica, and lumbar spine experiences." },
  { slug: "patient-stories", name: "Patient Stories", description: "First-person stories without claims of medical verification." },
  { slug: "recovery-journals", name: "Recovery Journals", description: "Personal progress updates over time." },
];
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    if (pathname.startsWith("/api/")) {
      if (pathname === "/api/health" && request.method === "GET") {
        return json({ status: "ok", stage: "read-only-scaffold", databaseConfigured: Boolean(env.DB), imageUploadsEnabled: false });
      }
      if (pathname === "/api/categories" && request.method === "GET") {
        return json({ categories });
      }
      // Security: both storage writes AND reads are disabled until access
      // control, abuse limits, and private R2 bindings have been implemented.
      if (pathname === "/api/uploads" || pathname.startsWith("/api/uploads/")) {
        return json({ error: "image_feature_disabled" }, 403);
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        return json({ error: "community_not_open_for_posting" }, 403);
      }
      if (pathname === "/api/topics" && request.method === "GET") {
        if (!env.DB) return json({ error: "database_not_configured", topics: [] }, 503);
        try {
          const result = await env.DB.prepare(
            "SELECT id, category, kind, title, created_at FROM topics WHERE status = ? ORDER BY created_at DESC LIMIT 20"
          ).bind("published").all();
          return json({ topics: result.results ?? [] });
        } catch {
          // Do not leak SQL errors or account details to the public API.
          return json({ error: "forum_not_ready", topics: [] }, 503);
        }
      }
      return json({ error: "not_found" }, 404);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
