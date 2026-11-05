export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); this.name = "ApiError"; }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options.headers }, credentials: "same-origin", cache: "no-store" }); }
  catch { throw new ApiError("연결을 확인한 후 다시 시도해주세요. 작성한 내용은 그대로 있어요.", 0); }
  const data = await response.json().catch(() => null) as { error?: { message?: string; code?: string } } | null;
  if (!response.ok) throw new ApiError(data?.error?.message || (response.status === 401 ? "로그인 후 우리 캘린더를 시작할 수 있어요." : "요청을 처리하지 못했어요. 잠시 후 다시 시도해주세요."), response.status, data?.error?.code);
  return data as T;
}
