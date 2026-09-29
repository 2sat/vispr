export type DeploymentMode = 'hosted' | 'local';

export type UrlCheck = { ok: true; url: URL } | { ok: false; error: string };

/**
 * First-pass validation for operator-registered endpoints.
 * Hosted mode requires https and rejects loopback, private and link-local
 * hosts. Local mode allows them explicitly, per the spec.
 *
 * NOTE: this checks the literal host only. The outbound request path must
 * also resolve DNS and re-check the resolved address at connect time,
 * or a public name could point at a private address.
 */
export function validateEndpointUrl(raw: string, mode: DeploymentMode): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: 'Enter a full URL, including https://.' };
  }
  if (url.username || url.password) return { ok: false, error: 'Put credentials in the secret reference, not the URL.' };
  if (mode === 'local') {
    return url.protocol === 'http:' || url.protocol === 'https:' ? { ok: true, url } : { ok: false, error: 'Use http or https.' };
  }
  if (url.protocol !== 'https:') return { ok: false, error: 'Hosted mode requires https.' };
  if (isPrivateHost(url.hostname)) {
    return { ok: false, error: 'Hosted mode can’t reach private or loopback addresses. Run Vispr locally, or expose an authenticated public endpoint.' };
  }
  return { ok: true, url };
}

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;

  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (h.includes(':')) {
    if (h === '::' || h === '::1') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(h)) return true; // fc00::/7 unique local
    if (/^fe[89ab][0-9a-f]:/.test(h)) return true; // fe80::/10 link-local
    const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) return isPrivateHost(mapped[1]);
  }
  return false;
}
