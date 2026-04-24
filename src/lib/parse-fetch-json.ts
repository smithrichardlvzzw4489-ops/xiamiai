export type ParsedFetch = {
  json: Record<string, unknown>;
  httpOk: boolean;
  errorMessage: string | null;
};

/**
 * Reads fetch Response body safely (empty / HTML / crash pages won't break JSON.parse).
 */
export async function parseFetchJson(response: Response): Promise<ParsedFetch> {
  const raw = await response.text();
  if (!raw.trim()) {
    return {
      json: {},
      httpOk: response.ok,
      errorMessage: response.ok
        ? null
        : `请求失败（HTTP ${response.status}），响应体为空`,
    };
  }
  try {
    const json = JSON.parse(raw) as Record<string, unknown>;
    const bodyErr = typeof json.error === "string" ? json.error : null;
    if (!response.ok) {
      return {
        json,
        httpOk: false,
        errorMessage: bodyErr ?? `请求失败（HTTP ${response.status}）`,
      };
    }
    return { json, httpOk: true, errorMessage: bodyErr };
  } catch {
    return {
      json: {},
      httpOk: false,
      errorMessage: "服务器返回了非 JSON（可能是错误页或网关中断）",
    };
  }
}
