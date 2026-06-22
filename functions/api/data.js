// Pages Function: /api/data
// GET  /api/data?key=foo  -> { value: "..." } | "null"
// PUT  /api/data?key=foo  -> body becomes the stored value (last-write-wins)
//
// Auth: if FAMILY_PIN env var is set on the Pages project, requests must
// include an `X-Pin` header matching it. If unset, the endpoint is open
// (use Cloudflare Access in front for stronger protection).

const MAX_VALUE_BYTES = 256 * 1024; // 256 KB — generous for this app

function authed(request, env) {
  if (!env.FAMILY_PIN) return true;
  return request.headers.get('X-Pin') === env.FAMILY_PIN;
}

function bad(status, msg) {
  return new Response(msg, { status, headers: { 'Content-Type': 'text/plain' } });
}

export async function onRequestGet({ request, env }) {
  if (!authed(request, env)) return bad(401, 'unauthorized');
  if (!env.DATA) return bad(500, 'KV binding DATA not configured');

  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!key) return bad(400, 'missing key');

  const value = await env.DATA.get(key);
  if (value === null) {
    return new Response('null', {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
  return new Response(JSON.stringify({ value }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestPut({ request, env }) {
  if (!authed(request, env)) return bad(401, 'unauthorized');
  if (!env.DATA) return bad(500, 'KV binding DATA not configured');

  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!key) return bad(400, 'missing key');

  const value = await request.text();
  if (value.length > MAX_VALUE_BYTES) return bad(413, 'value too large');

  await env.DATA.put(key, value);
  return new Response('ok', { headers: { 'Content-Type': 'text/plain' } });
}

// Reject everything else
export async function onRequest({ request }) {
  return bad(405, `method ${request.method} not allowed`);
}
