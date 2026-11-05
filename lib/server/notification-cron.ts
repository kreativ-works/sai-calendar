import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTVerifyGetKey } from "jose";

const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "https://sai-our-calendar.seonguk.chatgpt.site/notifications";
const REPOSITORY = "kreativ-works/sai-calendar";
const WORKFLOW = `${REPOSITORY}/.github/workflows/notifications.yml@refs/heads/main`;
const MAX_TOKEN_LENGTH = 8_192;

// The URL is fixed here, never read from a JWT or request. jose caches keys and
// coalesces refreshes; all network failures fail closed without logging tokens.
const githubKeys = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`), {
  timeoutDuration: 8_000,
  cooldownDuration: 30_000,
  cacheMaxAge: 10 * 60 * 1000,
});

function expectedIds(environment: object): { repository: string; owner: string } | null {
  const values = environment as Record<string, unknown>;
  const repository = values.SAI_NOTIFICATION_CRON_REPOSITORY_ID;
  const owner = values.SAI_NOTIFICATION_CRON_OWNER_ID;
  if (typeof repository !== "string" || typeof owner !== "string" || !/^[1-9]\d{0,19}$/.test(repository) || !/^[1-9]\d{0,19}$/.test(owner)) return null;
  return { repository, owner };
}

/** Injectable trusted key resolver allows signed-claim tests without network IO. */
export async function verifyGithubNotificationCronToken(
  token: string,
  environment: object,
  keys: JWTVerifyGetKey = githubKeys,
  now = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const ids = expectedIds(environment);
  if (!ids || typeof token !== "string" || !token || token.length > MAX_TOKEN_LENGTH) return false;
  try {
    const header = decodeProtectedHeader(token);
    if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid || header.kid.length > 128) return false;
    const { payload } = await jwtVerify(token, keys, {
      algorithms: ["RS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
      requiredClaims: ["sub", "iat", "exp", "repository", "repository_id", "repository_owner_id", "workflow_ref", "ref", "event_name"],
      maxTokenAge: 600,
      clockTolerance: 5,
      currentDate: new Date(now * 1000),
    });
    // Numeric IDs also prevent a renamed/transferred namespace from inheriting
    // this trust. Do not assume the pre-July-2026 GitHub subject string format.
    return payload.iss === ISSUER && payload.aud === AUDIENCE
      && typeof payload.sub === "string" && payload.sub.length > 0 && payload.sub.length <= 512
      && typeof payload.iat === "number" && Number.isFinite(payload.iat)
      && payload.iat >= now - 600 && payload.iat <= now + 5
      && typeof payload.exp === "number" && Number.isFinite(payload.exp)
      && payload.exp > now && payload.exp > payload.iat && payload.exp - payload.iat <= 600
      && payload.repository === REPOSITORY && payload.repository_owner === "kreativ-works"
      && payload.repository_id === ids.repository && payload.repository_owner_id === ids.owner
      && payload.workflow_ref === WORKFLOW && payload.ref === "refs/heads/main"
      && (payload.event_name === "schedule" || payload.event_name === "workflow_dispatch");
  } catch { return false; }
}

export async function verifyGithubNotificationCron(request: Request, environment: object): Promise<boolean> {
  if (!expectedIds(environment)) return false;
  const authorization = request.headers.get("authorization");
  if (!authorization || authorization.length > MAX_TOKEN_LENGTH + 7) return false;
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(authorization);
  if (!match) return false;
  return verifyGithubNotificationCronToken(match[1], environment);
}
