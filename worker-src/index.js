// Cloudflare Worker entry point.
// Routes /api/data to KV; everything else falls through to static assets
// (the React build output in ./dist, bound as ASSETS in wrangler.toml).

const MAX_VALUE_BYTES = 256 * 1024;

function authed(request, env) {
  if (!env.FAMILY_PIN) return true; // open if unset
  return request.headers.get('X-Pin') === env.FAMILY_PIN;
}

function bad(status, msg) {
  return new Response(msg, { status, headers: { 'Content-Type': 'text/plain' } });
}

async function handleApi(request, env) {
  if (!authed(request, env)) return bad(401, 'unauthorized');
  if (!env.DATA) return bad(500, 'KV binding DATA not configured');

  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!key) return bad(400, 'missing key');

  if (request.method === 'GET') {
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

  if (request.method === 'PUT') {
    const value = await request.text();
    if (value.length > MAX_VALUE_BYTES) return bad(413, 'value too large');
    await env.DATA.put(key, value);
    return new Response('ok');
  }

  return bad(405, `method ${request.method} not allowed`);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/data') {
      return handleApi(request, env);
    }

    // Static assets (the built React app)
    return env.ASSETS.fetch(request);
  },
};
