export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export async function readText(request, limit) {
  if (Number(request.headers.get('Content-Length')) > limit) {
    throw new HttpError(413, 'Request is too large');
  }
  const text = await request.text();
  if (text.length > limit) throw new HttpError(413, 'Request is too large');
  return text;
}

export function parseJson(text) {
  try {
    const data = JSON.parse(text);
    if (data && typeof data === 'object') return data;
  } catch {
    // Fall through to the error below.
  }
  throw new HttpError(400, 'Invalid JSON');
}

export async function readJson(request, limit = 16 * 1024) {
  return parseJson(await readText(request, limit));
}
