export const STATIC_ASSET_LIMIT = 30;

// Only build-fingerprinted public JavaScript and CSS belong in the shared cache.
const publicStaticPath = /^\/_next\/static\/(?:chunks|css)\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*[.-][A-Za-z0-9_-]{8,}\.(?:js|css)$/;

function publicStaticAssetUrl(value: string, origin: string): string | null {
  // URL.search/hash hide empty delimiters, so reject them before parsing too.
  if (!value || value.trim() !== value || /[?#%]/.test(value)) return null;
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.username || url.password || !publicStaticPath.test(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function isPublicStaticAssetUrl(value: string, origin: string): boolean {
  return publicStaticAssetUrl(value, origin) !== null;
}

export function collectStaticAssetUrls(origin: string, candidates: Iterable<string>): string[] {
  const urls = new Set<string>();
  for (const candidate of candidates) {
    const url = publicStaticAssetUrl(candidate, origin);
    if (url) urls.add(url);
    if (urls.size === STATIC_ASSET_LIMIT) break;
  }
  return [...urls];
}
