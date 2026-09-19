export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function isAllowedOrigin(origin) {
  return !origin || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
}

export function localRequestUrl(request) {
  // A loopback listener alone does not prevent DNS rebinding. CLI clients may
  // omit Origin, so also require an explicit local Host on every request.
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(request.headers.host || "")
      || !isAllowedOrigin(request.headers.origin)) {
    throw new HttpError(403, "只允许本机画板访问 Codex");
  }
  const target = request.url || "/";
  if (!target.startsWith("/") || target.startsWith("//")) {
    throw new HttpError(400, "请求地址无效");
  }
  try {
    return new URL(target, "http://127.0.0.1");
  } catch {
    throw new HttpError(400, "请求地址无效");
  }
}

export async function readJson(request, maxBytes = 220_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new HttpError(413, "画布或参考素材总大小过大");
    chunks.push(buffer);
  }
  try {
    // Decode once: a UTF-8 character may span multiple TCP chunks.
    return JSON.parse(Buffer.concat(chunks, size).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "请求内容不是有效的 JSON");
  }
}
