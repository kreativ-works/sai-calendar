// Firebase's documented reverse-proxy approach keeps its sign-in helper and
// browser storage on the app's origin, including on browsers blocking third-
// party storage: https://firebase.google.com/docs/auth/web/redirect-best-practices
const REQUEST_HEADERS = ["accept", "accept-language", "content-type", "origin", "user-agent"];
const REMOVE_RESPONSE_HEADERS = [
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te",
  "trailer", "transfer-encoding", "upgrade", "set-cookie", "content-length",
];
const POST_BODY_MAX_BYTES = 128 * 1024;
const POST_BODY_TIMEOUT_MS = 15_000;

function isHelperPath(pathname: string): boolean {
  return pathname === "/__/auth" || pathname.startsWith("/__/auth/") || pathname === "/__/firebase/init.json";
}

function validHelperPath(pathname: string): boolean {
  // Reject encoded separators and traversal rather than allowing a helper URL
  // to turn into a proxy for unrelated Firebase Hosting paths after decoding.
  return /^[a-zA-Z0-9_./-]+$/.test(pathname) && !pathname.split("/").some((part) => part === "." || part === "..");
}

function failure(status: number, code: string, message: string, allow?: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...(allow ? { Allow: allow } : {}) } });
}

async function readPostBody(request: Request): Promise<ArrayBuffer | Response> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > POST_BODY_MAX_BYTES) {
    // Do not leave an oversized upload running after rejecting its headers.
    void request.body?.cancel().catch(() => {});
    return failure(413, "AUTH_HELPER_BODY_TOO_LARGE", "로그인 요청이 너무 커요. 로그인 화면에서 다시 시도해 주세요.");
  }
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  let tooLarge = false, timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      void reader.cancel().catch(() => {});
      reject(new Error("Auth helper request deadline reached"));
    }, POST_BODY_TIMEOUT_MS);
  });
  const read = async (): Promise<ArrayBuffer> => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (timedOut) throw new Error("Auth helper request deadline reached");
        if (chunk.done) break;
        total += chunk.value.byteLength;
        if (total > POST_BODY_MAX_BYTES) {
          tooLarge = true;
          void reader.cancel().catch(() => {});
          throw new Error("Auth helper request body limit reached");
        }
        chunks.push(chunk.value);
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return bytes.buffer;
    } finally { reader.releaseLock(); }
  };
  try { return await Promise.race([read(), deadline]); }
  catch {
    if (tooLarge) return failure(413, "AUTH_HELPER_BODY_TOO_LARGE", "로그인 요청이 너무 커요. 로그인 화면에서 다시 시도해 주세요.");
    if (timedOut) return failure(408, "AUTH_HELPER_BODY_TIMEOUT", "로그인 요청이 지연되었어요. 다시 시도해 주세요.");
    return failure(400, "AUTH_HELPER_BODY_INVALID", "로그인 요청을 확인하지 못했어요. 다시 시도해 주세요.");
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

export async function proxyFirebaseAuthRequest(request: Request, environment: object, upstreamFetch: typeof fetch = fetch): Promise<Response | null> {
  const publicUrl = new URL(request.url);
  if (!isHelperPath(publicUrl.pathname)) return null;
  if (!validHelperPath(publicUrl.pathname)) return failure(400, "INVALID_AUTH_HELPER_PATH", "올바른 로그인 주소에서 다시 시도해 주세요.");
  if (!["GET", "HEAD", "POST"].includes(request.method)) return failure(405, "METHOD_NOT_ALLOWED", "지원하지 않는 로그인 요청이에요.", "GET, HEAD, POST");

  const project = (environment as Record<string, unknown>).SAI_FIREBASE_PROJECT_ID;
  // Google Cloud project IDs contain 6–30 lowercase letters, digits or hyphens.
  // Neither request parameters nor authDomain can choose the upstream host.
  if (typeof project !== "string" || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)) return failure(503, "AUTH_NOT_CONFIGURED", "로그인 서비스를 준비하고 있어요. 잠시 후 다시 시도해 주세요.");
  const upstreamOrigin = `https://${project}.firebaseapp.com`;
  const upstreamUrl = new URL(`${publicUrl.pathname}${publicUrl.search}`, upstreamOrigin);
  const body = request.method === "POST" ? await readPostBody(request) : null;
  if (body instanceof Response) return body;
  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  // A Referer can contain invitation codes or other app state. It is never
  // forwarded; Cookie, Authorization, Sites identity and proxy headers are also
  // excluded by the allowlist above. OAuth helper parameters remain unchanged.
  const options: RequestInit = {
    method: request.method, headers, redirect: "manual", signal: AbortSignal.timeout(15_000),
    // Buffer only the bounded OAuth payload, so an oversized/unfinished request
    // can never forward partial credentials to the upstream sign-in helper.
    ...(request.method === "POST" ? { body } : {}),
  };

  try {
    const upstream = await upstreamFetch(upstreamUrl, options);
    const responseHeaders = new Headers(upstream.headers);
    for (const name of REMOVE_RESPONSE_HEADERS) responseHeaders.delete(name);
    responseHeaders.set("Cache-Control", "no-store");
    responseHeaders.set("X-Content-Type-Options", "nosniff");
    const location = responseHeaders.get("location");
    if (location) {
      try {
        const target = new URL(location, upstreamUrl);
        if (target.origin === upstreamOrigin && (target.pathname === "/__/auth" || target.pathname.startsWith("/__/auth/"))) {
          responseHeaders.set("location", `${publicUrl.origin}${target.pathname}${target.search}${target.hash}`);
        }
      } catch { /* Preserve an upstream location that is not a parseable URL. */ }
    }
    return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
  } catch {
    // Authentication request bodies and URLs may carry OAuth credentials. Do
    // not log them or echo an upstream exception back to the browser.
    return failure(502, "AUTH_HELPER_UNAVAILABLE", "로그인 화면에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.");
  }
}
