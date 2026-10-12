import { neon } from "@neondatabase/serverless";

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers });
}

export default async function api(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path !== "/" &&
      path !== "/api/v1/health" && path !== "/health" &&
      path !== "/api/v1/songs" && path !== "/songs") {
    return json({ error: "Not found" }, 404);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return json({ error: "Database unavailable" }, 503);
  }

  try {
    const sql = neon(databaseUrl);

    if (path === "/api/v1/health" || path === "/health") {
      await sql`SELECT 1`;
      return json({ status: "ok", service: "musichub-api", database: "connected" });
    }

    if (path === "/") {
      return json({ service: "musichub-api", status: "ok", endpoints: ["/api/v1/health", "/api/v1/songs"] });
    }

    const rawPage = Number.parseInt(url.searchParams.get("page") || "1", 10);
    const rawLimit = Number.parseInt(url.searchParams.get("limit") || "25", 10);
    const page = Number.isFinite(rawPage) ? Math.max(1, rawPage) : 1;
    const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 25;
    const search = (url.searchParams.get("search") || "").trim().slice(0, 100);
    const pattern = `%${search}%`;
    const offset = (page - 1) * limit;

    const songs = await sql`
      SELECT id, title, artist, cover_key, download_price_kes
      FROM songs
      WHERE is_published = TRUE
        AND (${search} = '' OR title ILIKE ${pattern} OR COALESCE(artist, '') ILIKE ${pattern})
      ORDER BY title ASC
      LIMIT ${limit} OFFSET ${offset}
    `;

    return json({
      data: songs,
      pagination: { page, limit, returned: songs.length },
    });
  } catch {
    return json({ error: "Service temporarily unavailable" }, 503);
  }
}
