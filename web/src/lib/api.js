// Tiny fetch wrapper — every API error surfaces as a thrown Error with the
// server's message, so pages can show it verbatim.
export async function api(path, options = {}) {
  const token = localStorage.getItem('crm_token');
  const headers = {
    'content-type': 'application/json',
    ...(token ? { 'authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(`/api${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401) {
    localStorage.removeItem('crm_token');
    window.dispatchEvent(new Event('unauthorized'));
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const inr = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
export const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
