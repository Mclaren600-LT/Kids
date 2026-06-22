// Storage layer — calls the Pages Function at /api/data
// which reads/writes a single key in Cloudflare KV.

const PIN = import.meta.env.VITE_FAMILY_PIN || '';

const headers = () => ({
  ...(PIN ? { 'X-Pin': PIN } : {}),
});

export async function get(key) {
  try {
    const res = await fetch(`/api/data?key=${encodeURIComponent(key)}`, {
      headers: headers(),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || text === 'null') return null;
    return JSON.parse(text); // { value: "..." }
  } catch (e) {
    console.error('storage.get failed', e);
    return null;
  }
}

export async function set(key, value) {
  try {
    const res = await fetch(`/api/data?key=${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain', ...headers() },
      body: value,
    });
    return res.ok;
  } catch (e) {
    console.error('storage.set failed', e);
    return false;
  }
}
