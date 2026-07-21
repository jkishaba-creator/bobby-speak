// Same-origin proxy to Cloudflare Workers AI.
//
// Why this exists: api.cloudflare.com sends no CORS headers (a preflight
// returns 405), so a browser page cannot call it directly — the request is
// blocked before it leaves the device. The Chrome extension gets away with
// direct calls because extensions bypass CORS via host permissions; a web app
// has no such escape hatch.
//
// Two ways to reach the models, preferred in this order:
//   1. The project's own Workers AI binding (env.AI) — no credentials needed
//      anywhere, so the app works with zero setup on the user's device.
//   2. Credentials forwarded from the client — the fallback when no binding
//      is configured, and what lets the app run on non-Cloudflare hosts.

interface Env {
  AI?: { run(model: string, input: unknown): Promise<unknown> };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const model = request.headers.get("x-cf-model");
  if (!model) {
    return json({ success: false, errors: [{ message: "Missing model." }] }, 400);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ success: false, errors: [{ message: "Invalid JSON body." }] }, 400);
  }

  // 1. Bound Workers AI — nothing for the user to configure.
  if (env.AI?.run) {
    try {
      const result = await env.AI.run(model, payload);
      return json({ success: true, result });
    } catch (err) {
      return json(
        {
          success: false,
          errors: [
            { message: (err as Error)?.message ?? "Workers AI call failed." },
          ],
        },
        502,
      );
    }
  }

  // 2. Fall back to the caller's own credentials.
  const accountId = request.headers.get("x-cf-account");
  const token = request.headers.get("x-cf-token");
  if (!accountId || !token) {
    return json(
      { success: false, errors: [{ message: "Missing Cloudflare credentials." }] },
      400,
    );
  }

  const upstream =
    "https://api.cloudflare.com/client/v4/accounts/" +
    encodeURIComponent(accountId) +
    "/ai/run/" +
    model;

  try {
    const res = await fetch(upstream, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    return new Response(await res.text(), {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return json(
      { success: false, errors: [{ message: "Upstream request failed." }] },
      502,
    );
  }
};
