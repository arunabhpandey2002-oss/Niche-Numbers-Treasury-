export type SheetConfig = {
  url: string;
  token: string;
  sheetInput: string;
  ssid: string;
  scale: number;
};

export type SheetInfo = {
  name: string;
  rows: number;
  cols: number;
};

export function extractSsid(input: string) {
  const raw = String(input || "").trim();
  const match = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || raw.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(raw) ? raw : "";
}

export function validScriptUrl(input: string) {
  try {
    const url = new URL(input.trim());
    return url.protocol === "https:" && url.hostname === "script.google.com" && /\/macros\/s\/[^/]+\/exec\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function sheetQuery(config: Pick<SheetConfig, "url" | "token" | "ssid">, action: "list" | "read", ranges?: string) {
  const params = new URLSearchParams({ action, token: config.token, ssid: config.ssid });
  if (ranges !== undefined) params.set("ranges", ranges);
  return `${config.url}${config.url.includes("?") ? "&" : "?"}${params.toString()}`;
}

export async function sheetJson(url: string, init?: RequestInit) {
  try {
    const response = await fetch(url, { redirect: "follow", ...init });
    const text = await response.text();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(
        response.url.includes("accounts.google.com") || /<html/i.test(text)
          ? "Apps Script is asking for sign-in. Redeploy the web app with access set to Anyone."
          : "The Apps Script URL did not return JSON. Confirm that you pasted the deployed /exec URL."
      );
    }
    if (!response.ok) throw new Error(`Apps Script returned HTTP ${response.status}.`);
    return body;
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("The browser could not reach Apps Script. Confirm the /exec URL and that deployment access is set to Anyone.");
    }
    throw error;
  }
}

export function sheetNames(body: { sheets?: unknown[] }) {
  return (body.sheets || [])
    .map((sheet) => (typeof sheet === "string" ? sheet : (sheet as { name?: string }).name))
    .filter(Boolean) as string[];
}

export function sheetDetails(body: { sheets?: unknown[] }) {
  return (body.sheets || [])
    .map((sheet) =>
      typeof sheet === "string"
        ? { name: sheet, rows: 500, cols: 80 }
        : {
            name: String((sheet as { name?: string }).name || ""),
            rows: Number((sheet as { rows?: number }).rows) || 500,
            cols: Number((sheet as { cols?: number }).cols) || 80,
          }
    )
    .filter((sheet) => sheet.name);
}

export function columnName(index: number) {
  let n = Math.max(1, index);
  let out = "";
  while (n) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function colToNum(col: string) {
  let n = 0;
  for (const ch of String(col).toUpperCase()) {
    if (ch >= "A" && ch <= "Z") n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n;
}

export function quoteSheet(name: string) {
  return /[^A-Za-z0-9_]/.test(name) ? `'${name.replace(/'/g, "''")}'` : name;
}

export function buildRange(sheet: string, col: string, row: string | number, span: number) {
  if (!sheet || !col || !row) return "";
  const start = colToNum(col);
  if (!start) return "";
  return `${quoteSheet(sheet)}!${columnName(start)}${row}:${columnName(start + Math.max(1, span) - 1)}${row}`;
}

export function parseRange(range: string) {
  const match = String(range || "").match(/^(?:'((?:[^']|'')+)'|([^'!]+))!\s*([A-Za-z]+)(\d+)/);
  if (!match) return { sheet: "", col: "", row: "" };
  return { sheet: (match[1] || match[2] || "").replace(/''/g, "'").trim(), col: (match[3] || "").toUpperCase(), row: match[4] || "" };
}

export function numberValue(value: unknown, scale = 1) {
  if (typeof value === "number") return value * scale;
  const raw = String(value ?? "").trim();
  if (!raw || raw === "-" || raw === "—") return 0;
  const negative = /^\(.*\)$/.test(raw);
  const percentage = raw.includes("%");
  const parsed = Number(raw.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(parsed)) return 0;
  const signed = negative ? -Math.abs(parsed) : parsed;
  return (percentage ? signed / 100 : signed) * scale;
}

export async function writeRanges(config: Pick<SheetConfig, "url" | "token" | "ssid">, writes: { range: string; values: unknown[][] }[]) {
  return sheetJson(config.url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ token: config.token, action: "write", ssid: config.ssid, writes }),
  });
}
