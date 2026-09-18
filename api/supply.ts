import { getSupply } from "./lib/supply";

/**
 * Serves every supply endpoint. vercel.json rewrites
 * /api/total-supply, /api/circulating-supply, /api/burned-supply and
 * /api/supply onto this function, passing the original path in ?field.
 *
 * Written against the Node request/response signature, which every Vercel Node
 * runtime accepts without a pinned config.runtime. Note that req.url here is a
 * path, not an absolute URL, so it is parsed against a dummy base.
 */

interface NodeRequest {
  method?: string;
  url?: string;
}

interface NodeResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

const CACHE = "public, max-age=60, s-maxage=60, stale-while-revalidate=300";

export default async function handler(req: NodeRequest, res: NodeResponse): Promise<void> {
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
  res.setHeader("cache-control", CACHE);

  const method = req.method ?? "GET";
  if (method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (method !== "GET") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "method not allowed" }));
    return;
  }

  const url = new URL(req.url ?? "/api/supply", "http://localhost");
  const field = url.searchParams.get("field") ?? url.pathname.replace(/^\/api\//, "");

  try {
    const snapshot = await getSupply();
    const body =
      field === "total-supply"
        ? { result: snapshot.totalSupply }
        : field === "circulating-supply"
          ? { result: snapshot.circulatingSupply }
          : field === "burned-supply"
            ? { result: snapshot.burnedSupply }
            : snapshot;
    res.statusCode = 200;
    res.end(JSON.stringify(body));
  } catch (error) {
    res.statusCode = 503;
    res.setHeader("cache-control", "no-store");
    res.end(
      JSON.stringify({ error: error instanceof Error ? error.message : "upstream rpc failure" }),
    );
  }
}
