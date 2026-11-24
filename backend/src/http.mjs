// Small helpers shared by the routes.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type,x-api-key',
  'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
};

export function json(status, body) {
  return { statusCode: status, headers: { 'content-type': 'application/json', ...CORS }, body: JSON.stringify(body) };
}

export function str(v, max = 200) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

export function requireString(v, name, max = 2000) {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `${name} is required`);
  if (v.length > max) throw new HttpError(413, `${name} is too long`);
  return v.trim();
}

// Accept only the fields we use from the page, and cap their size.
export function cleanElements(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 60).map((e, i) => ({
    id: Number.isInteger(e && e.id) ? e.id : i,
    kind: str(e && e.kind, 20),
    label: str(e && e.label, 120),
    hint: str(e && e.hint, 60),
  })).filter((e) => e.label);
}
