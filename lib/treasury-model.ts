import { buildMappingSuggestions, resolveSources, sourceScores } from "./model-mapping.ts";
import type { MappingSuggestion, SourceAssignments } from "./model-mapping.ts";

export type ModuleId = "cash" | "collections" | "receivables" | "payables" | "workingCapital" | "debt" | "liquidity" | "covenants" | "fx";

// Bump this whenever the persisted scan shape or extraction logic changes.
// The UI uses it to rebuild an older workbook scan exactly once.
export const SCAN_SCHEMA_VERSION = 3;

export type ScanRow = {
  id: string;
  sheet: string;
  row: number;
  label: string;
  section: string;
  entity: string;
  currency: string;
  unit: string;
  range: string;
  values: number[];
  display: string[];
  inputCell?: string;
  inputValue?: number;
};

export type ScanResult = {
  schemaVersion?: number;
  workbook: string;
  scannedAt: string;
  periods: string[];
  sheets: string[];
  modules: ModuleId[];
  rows: ScanRow[];
  collections: CollectionRecord[];
  payments: PaymentRecord[];
  sourceAssignments: SourceAssignments;
  sourceScores: ReturnType<typeof sourceScores>;
  mappings: MappingSuggestion[];
};

export type CollectionRecord = {
  id: string;
  sheet: string;
  row: number;
  customer: string;
  invoice: string;
  amount: number;
  currency: string;
  unit: string;
  dueMonth: string;
  expectedMonth: string;
  dueDate?: string;
  expectedDate?: string;
  probability?: number;
  dateCell?: string;
  discountCell?: string;
  driverCell?: string;
  driverValue?: number;
  sourceKind: "invoice" | "account_schedule";
};

export type PaymentRecord = {
  id: string;
  sheet: string;
  row: number;
  supplier: string;
  invoice: string;
  amount: number;
  currency: string;
  unit: string;
  dueMonth: string;
  expectedMonth: string;
  dueDate?: string;
  expectedDate?: string;
  probability?: number;
  dateCell?: string;
  discountCell?: string;
  driverCell?: string;
  driverValue?: number;
  sourceKind: "invoice" | "account_schedule";
};

export type CashBridgeStep = {
  name: string;
  value: number;
  total?: boolean;
  rows?: string[];
};

const openingCashPattern = /beginning cash|opening cash|opening balance|opening.*cash|cash.*opening|cash at (?:the )?start|cash brought forward/i;
const closingCashPattern = /ending cash|closing cash|closing balance|closing.*cash|cash.*closing|cash at (?:the )?end|cash carried forward/i;

export function roundDays(value: number) {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function periodTotal(row: ScanRow, start: number, end: number) {
  return row.values.slice(start, end + 1).reduce((sum, value) => sum + (value || 0), 0);
}

function cashDirection(label: string, value: number, section = "") {
  const inflow = /collection|receipt|received|drawdown|borrowing|proceeds|funding|equity|capital raise|cash injection|interest income|management fee income|inflow|revenue|billing/i;
  const outflow = /payment|paid|repayment|amorti[sz]ation|capex|capital expenditure|purchase|acquisition|payroll|salar|wages|bonus|\btax\b|insurance|rent|interest expense|interest paid|supplier|vendor|creditor|cash operating|opex|operating expense|commitment fee|lease|\bcost\b|expense|outflow|marketing|cloud|infra|g&a|overhead/i;
  const notOutflow = /drawdown|proceeds|received|receipt|collection|funding|equity|raise|injection|inflow|revenue|billing/i;
  // A row's own words win; the section it sits under (e.g. "CASH OUTFLOWS") is the tie-breaker.
  if (inflow.test(label)) return Math.abs(value);
  if (outflow.test(label) && !notOutflow.test(label)) return -Math.abs(value);
  const sect = section.toLowerCase();
  if (/inflow|collection|receipt|revenue|income/.test(sect)) return Math.abs(value);
  if (/outflow|cost|expense|payment|spend/.test(sect)) return -Math.abs(value);
  return value;
}

function cashBridgeCategory(label: string) {
  if (/principal repayment|loan repayment|debt repayment|amorti[sz]ation|repayment of borrow|lease principal/i.test(label)) return "Debt repayments";
  if (/drawdown|debt proceeds|new borrowing|loan proceeds|revolver draw|facility draw/i.test(label)) return "Debt drawdowns";
  if (/interest(?!\s+(?:income|received|earned))|commitment fee|lease interest/i.test(label)) return "Interest & fees";
  if (/equity|capital raise|cash injection|intercompany funding|share issue/i.test(label)) return "Equity & funding";
  if (/customer|collection|receipt|billings|sales proceeds|management fee income|revenue|\bsales\b|turnover|less:\s*returns|less:\s*discount|sales return|customer discount/i.test(label)) return "Customer collections";
  if (/payroll|salar|wages|bonus|employee|staff|headcount|people cost|leadership|team/i.test(label)) return "People costs";
  if (/supplier|vendor|creditor|trade payable|payments made|discount captured|cost of goods|\bcogs\b|\bcosts?\b|purchases?|inventory|materials|shipping|freight|logistics|reverse logistics/i.test(label)) return "Supplier payments";
  if (/income tax|corporate tax|tax paid|\btax(?:es|ation)?\b/i.test(label)) return "Taxes";
  if (/capex|capital expenditure|fixed asset|equipment purchase/i.test(label) && !/operating cash flow|pre[\s-]?capex|ex[\s-]?capex/i.test(label)) return "Capital expenditure";
  if (/acquisition|investment purchase/i.test(label)) return "Acquisitions & investments";
  if (/interest received|interest income|other income|grant received/i.test(label)) return "Other inflows";
  if (/rent|insurance|cash operating|operating expense|opex|professional fee|legal|compliance|marketing|branding|software|saas|subscription|utilities|phone|internet|cloud|infra|hosting|travel|conveyance|banking|\bfees\b|contingency|g&a|general|admin|overhead|management fee to/i.test(label)) return "Other operating costs";
  if (/fx|foreign exchange|currency translation/i.test(label)) return "FX movement";
  return "Other cash movement";
}

export type CashRole = "in" | "out" | "ignore";
// Derived / subtotal / memo rows that must never count as a primitive cash movement.
const EXCLUDED_BRIDGE = /net change|net cash|change in cash|operating cash flow|cash from operations|free cash flow|\bfcf\b|cumulative|running total|net burn|for avg|minimum cash|cash buffer|\bbuffer\b|headroom|coverage|\bdscr\b|\bratio\b|gross margin|operating margin|\bebitda\b|gross profit|operating profit|net profit|memo|non-cash|reconcil|\bcheck\b|\bkpi\b|subtotal|sub-total|^total\b|total cash|cash conversion|closing debt|opening debt|percentage|\bdays\b/i;
// Driver / ratio / count rows: these are model inputs, not cash movements, so they
// are never offered as cash-flow line items.
const NON_CASH_LINE = /%|per unit|per seat|per month|per account|number of|no\. of|headcount|head count|growth rate|\brate\b|efficiency|lag in|lead time|as a %|conversion|utilisation|utilization|multiplier|\bindex\b|\bmargin\b|\bdso\b|\bdpo\b|\bdio\b/i;
// Stock / balance rows: a snapshot held at a point in time, NOT a monthly flow.
// Summing a balance across months (e.g. a ₹2cr revolver held every month) would
// invent billions of phantom cash movement, so these are never movement lines —
// they only ever serve as the opening/closing endpoints of the bridge.
const STOCK_ROW = /\bbalance\b|outstanding|\bdrawn\b|\bundrawn\b|headroom|available|utili[sz]ed|\bstock\b(?!\s*days)|closing|opening|carried forward|brought forward|\bposition\b/i;

function inflowKeyword(label: string) {
  return /collection|receipt|received|drawdown|borrowing|proceeds|funding|equity|capital raise|cash injection|interest income|management fee income|inflow|revenue|billing|sales(?! incentive)|income(?! tax)/i.test(label);
}
function outflowKeyword(label: string) {
  return /payment|paid|repayment|amorti[sz]ation|capex|capital expenditure|purchase|acquisition|payroll|salar|wages|bonus|\btax(?:es|ation)?\b|insurance|rent|interest(?!\s+(?:income|received|earned))|term loan|supplier|vendor|creditor|opex|operating expense|commitment fee|lease|\bcost\b|\bcogs\b|expense|outflow|marketing|branding|cloud|infra|software|saas|legal|compliance|admin|overhead|shipping|logistics|freight|discount|returns|contingency|travel|conveyance|banking|fees|utilities|phone|internet|employee/i.test(label);
}

// True when a row is a plausible cash-flow line the user might tag. Excludes the
// assumptions/driver sheet, ratio/count rows, subtotals and the opening/closing balances.
export function isCashCandidate(row: ScanRow, assumptionsSheet?: string): boolean {
  if (assumptionsSheet && row.sheet === assumptionsSheet) return false;
  if (!row.values.some((v) => Math.abs(v) > 0.01)) return false;
  if (!/[a-z]/i.test(row.label)) return false;   // numeric-only labels are parse artefacts, not real lines
  if (/^[₹$€£]?\s*(?:in\s+)?(?:crore|cr|lakhs?|million|mn|thousands?|000s|units|inr|usd|eur|gbp)$/i.test(row.label.trim())) return false; // bare unit/currency header rows
  if (NON_CASH_LINE.test(row.label)) return false;
  if (STOCK_ROW.test(row.label)) return false;   // balances are endpoints, never monthly movements
  if (openingCashPattern.test(row.label) || closingCashPattern.test(row.label)) return false;
  if (EXCLUDED_BRIDGE.test(row.label)) return false;
  return true;
}

export function cashCandidateRows(rows: ScanRow[], assumptionsSheet?: string): ScanRow[] {
  return rows.filter((row) => isCashCandidate(row, assumptionsSheet));
}

// Smart first-pass roles across the candidate rows. Revenue-like lines are tagged as
// inflows, cost/expense lines as outflows, and anything ambiguous is left "ignore"
// (safer than guessing) for the user to opt in from the cash-flow editor.
export function defaultCashRoles(rows: ScanRow[], assumptionsSheet?: string): Record<string, CashRole> {
  const roles: Record<string, CashRole> = {};
  rows.forEach((row) => {
    if (!isCashCandidate(row, assumptionsSheet)) { roles[row.id] = "ignore"; return; }
    const sect = row.section.toLowerCase();
    if (outflowKeyword(row.label)) roles[row.id] = "out";
    else if (inflowKeyword(row.label)) roles[row.id] = "in";
    else if (/inflow|collection|receipt|revenue|income/.test(sect)) roles[row.id] = "in";
    else if (/outflow|cost|expense|payment|spend/.test(sect)) roles[row.id] = "out";
    else roles[row.id] = "ignore";
  });
  return roles;
}

export type CustomCashLine = { id: string; name: string; role: CashRole; monthly: number };

export function buildCashBridge(
  rows: ScanRow[],
  start: number,
  end: number,
  opts?: { roles?: Record<string, CashRole>; openingId?: string; closingId?: string; customLines?: CustomCashLine[] },
): CashBridgeStep[] {
  const roles = opts?.roles;
  // In curated mode the user picks opening/closing explicitly; only fall back to
  // pattern matching when they haven't (or in fully-automatic mode).
  const openingRow = (opts?.openingId ? rows.find((row) => row.id === opts.openingId) : undefined) || (opts?.openingId === undefined ? rows.find((row) => openingCashPattern.test(row.label)) : undefined);
  const closingRow = (opts?.closingId ? rows.find((row) => row.id === opts.closingId) : undefined) || (opts?.closingId === undefined ? rows.find((row) => closingCashPattern.test(row.label)) : undefined);
  const opening = openingRow?.values[start] ?? 0;
  const buckets = new Map<string, { value: number; rows: string[] }>();

  rows.forEach((row) => {
    if (row === openingRow || row === closingRow) return;
    if (STOCK_ROW.test(row.label)) return;   // a balance/stock row is an endpoint, never a summed monthly movement
    const raw = periodTotal(row, start, end);
    if (Math.abs(raw) <= .01) return;
    let signed: number;
    if (roles) {
      const role = roles[row.id];
      if (role !== "in" && role !== "out") return;          // ignored or untagged rows never enter the bridge
      signed = role === "in" ? Math.abs(raw) : -Math.abs(raw);
    } else {
      if (openingCashPattern.test(row.label) || closingCashPattern.test(row.label) || EXCLUDED_BRIDGE.test(row.label)) return;
      signed = cashDirection(row.label, raw, row.section);
    }
    const name = cashBridgeCategory(row.label);
    const bucket = buckets.get(name) || { value: 0, rows: [] };
    bucket.value += signed;
    bucket.rows.push(row.label);
    buckets.set(name, bucket);
  });

  const order = ["Customer collections","Other inflows","Supplier payments","People costs","Other operating costs","Taxes","Interest & fees","Debt repayments","Debt drawdowns","Equity & funding","Capital expenditure","Acquisitions & investments","FX movement","Other cash movement"];
  const movements = order.flatMap((name) => {
    const bucket = buckets.get(name);
    return bucket && Math.abs(bucket.value) > .01 ? [{ name, value: bucket.value, rows: bucket.rows }] : [];
  });

  // Manually-added lines each become their own labelled step (a flat monthly amount over the window).
  const months = Math.max(1, end - start + 1);
  const customSteps = (opts?.customLines || [])
    .filter((line) => (line.role === "in" || line.role === "out") && Math.abs(line.monthly) > .0001)
    .map((line) => ({ name: line.name || "Custom line", value: (line.role === "in" ? 1 : -1) * Math.abs(line.monthly) * months, rows: ["Manual entry"] }));

  const allMovements = [...movements, ...customSteps];
  const movementSum = allMovements.reduce((sum, step) => sum + step.value, 0);
  const derivedClosing = opening + movementSum;
  // With no closing-cash row, the bridge is a complete sources-and-uses view:
  // closing is derived from the movements, so there is never a reconciliation gap.
  const hasClosing = !!closingRow;
  const closing = hasClosing ? (closingRow!.values[end] ?? 0) : derivedClosing;
  const reconciliation = hasClosing ? closing - derivedClosing : 0;
  return [
    { name: "Opening cash", value: opening, total: true, rows: openingRow ? [openingRow.label] : [] },
    ...allMovements,
    ...(Math.abs(reconciliation) > .01 ? [{ name: "Unmapped / reconciliation", value: reconciliation, rows: [] }] : []),
    { name: "Closing cash", value: closing, total: true, rows: closingRow ? [closingRow.label] : [] },
  ];
}

export const moduleLabels: Record<ModuleId, string> = {
  cash: "Cash flow", collections: "Customer collections", receivables: "Receivables", payables: "Payables",
  workingCapital: "Working capital", debt: "Debt", liquidity: "Liquidity",
  covenants: "Covenants", fx: "FX & entities",
};

export function parseNumber(value: unknown) {
  if (typeof value === "number") return value;
  const raw = String(value ?? "").trim();
  if (!raw || raw === "-" || raw === "—") return 0;
  const negative = /^\(.*\)$/.test(raw);
  const percentage = raw.includes("%");
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return (negative ? -Math.abs(n) : n) / (percentage ? 100 : 1);
}

function periodLabel(value: unknown) {
  if (typeof value === "number" && value >= 20000 && value <= 80000) {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return date.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
  }
  const s = String(value ?? "").trim();
  if (!s) return "";
  const month = s.match(/jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?/i)?.[0];
  const year = s.match(/(?:19|20)\d{2}|(?<!\d)\d{2}(?!\d)/)?.[0];
  if (month && year) {
    const fullYear = year.length === 2 ? 2000 + Number(year) : Number(year);
    const parsed = new Date(`${month} 1, ${fullYear}`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  }
  const numericDate = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (numericDate) {
    const first=Number(numericDate[1]),second=Number(numericDate[2]),rawYear=Number(numericDate[3]),yearValue=rawYear<100?2000+rawYear:rawYear,monthValue=first>12?second:first;
    if (monthValue>=1&&monthValue<=12&&yearValue>=2000&&yearValue<=2100) return new Date(Date.UTC(yearValue,monthValue-1,1)).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
  }
  if (/^\d{4}[-/]\d{1,2}(?:[-/]\d{1,2})?(?:[t ].*)?$/i.test(s)) {
    const isoLike = s.replace(" ", "T");
    const parsed = new Date(/t/i.test(isoLike) ? isoLike : `${isoLike}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.getUTCFullYear() >= 2000 && parsed.getUTCFullYear() <= 2100) return parsed.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
  }
  return "";
}

function colName(index: number) {
  let n = index + 1, out = "";
  while (n) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); }
  return out;
}

function quotedSheet(name: string) { return `'${name.replace(/'/g, "''")}'`; }

function entityFrom(text: string, fallback = "Group") {
  const tests: [RegExp, string][] = [
    [/consolidated/i, "Consolidated"], [/holdco/i, "HoldCo"], [/us\s*opco/i, "US OpCo"],
    [/(europe|eu)\s*opco/i, "Europe OpCo"], [/uk\s*opco/i, "UK OpCo"], [/(india|in)\s*opco/i, "India OpCo"],
  ];
  const known = tests.find(([re]) => re.test(text))?.[1];
  if (known) return known;
  const cleaned = text
    .replace(/^[①②③④⑤⑥\d.)\s-]+/, "")
    .replace(/\b(usd|eur|gbp|inr|000s|crore|cr|lakh|mn|m)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (/(opco|holdco|entity|subsidiary|business unit|division)$/i.test(cleaned) && cleaned.length <= 42) return cleaned;
  return fallback;
}

function currencyFrom(text: string, fallback = "USD") {
  if (/₹|rupee|\binr\b/i.test(text)) return "INR";
  return (text.match(/\b(USD|EUR|GBP|INR)\b/i)?.[1] || fallback).toUpperCase();
}

function unitFrom(text: string, currency = currencyFrom(text, "USD")) {
  if (/₹\s*(crore|cr\b)|\bcrore\b/i.test(text)) return "₹ crore";
  if (/₹\s*(lakh|lac)|\blakh\b/i.test(text)) return "₹ lakh";
  if (/full rupees|₹/i.test(text)) return "₹";
  if (/000s|thousand/i.test(text)) return `${currency} 000s`;
  if (/\bmillion|\bmn\b/i.test(text)) return `${currency} millions`;
  return currency;
}

function parseDate(value: unknown) {
  if (typeof value === "number" && value >= 20000 && value <= 80000) return new Date(Date.UTC(1899, 11, 30) + value * 86400000);
  const parsed = new Date(String(value ?? "").trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isoDate(value: unknown) {
  const date = parseDate(value);
  return date ? date.toISOString().slice(0, 10) : undefined;
}

function monthFromDate(value: unknown) {
  const date = parseDate(value);
  return date ? date.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }) : periodLabel(value);
}

function headerIndex(headers: string[], patterns: RegExp[]) {
  return headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
}

function parseCollectionsFromTab(tab: { name: string; values: unknown[][] }) {
  const records: CollectionRecord[] = [];
  const grid = tab.values || [];
  const tabText = grid.slice(0, 8).flat().map((cell) => String(cell ?? "")).join(" | ");
  for (let r = 0; r < Math.min(80, grid.length); r++) {
    const headers = (grid[r] || []).map((cell) => String(cell ?? "").trim().toLowerCase());
    const customerCol = headerIndex(headers, [/customer|client|account|counterparty/]);
    const amountCol = headerIndex(headers, [/amount|invoice value|receivable|balance|collection/]);
    if (customerCol < 0 || amountCol < 0) continue;
    const dueCol = headerIndex(headers, [/due date|invoice due|contractual/]);
    const expectedCol = headerIndex(headers, [/expected collection|collection date|receipt date|cash date|forecast collection|payment date/]);
    const invoiceCol = headerIndex(headers, [/invoice|bill|reference|document|deal|contract/]);
    const probabilityCol = headerIndex(headers, [/probability|confidence|weighted/]);
    const discountCol = headerIndex(headers, [/discount|early pay|early payment/]);
    const currencyCol = headerIndex(headers, [/currency|ccy/]);
    for (let i = r + 1; i < grid.length; i++) {
      const row = grid[i] || [];
      const customer = String(row[customerCol] ?? "").trim();
      const amount = parseNumber(row[amountCol]);
      if (!customer || !amount) continue;
      const dueMonth = monthFromDate(dueCol >= 0 ? row[dueCol] : row[expectedCol]);
      const expectedMonth = monthFromDate(expectedCol >= 0 ? row[expectedCol] : row[dueCol]);
      if (!dueMonth && !expectedMonth) continue;
      const probabilityRaw = probabilityCol >= 0 ? parseNumber(row[probabilityCol]) : undefined;
      records.push({
        id: `${tab.name}:${i + 1}`,
        sheet: tab.name,
        row: i + 1,
        customer,
        invoice: invoiceCol >= 0 ? String(row[invoiceCol] ?? "").trim() : "",
        amount,
        currency: currencyCol >= 0 ? currencyFrom(String(row[currencyCol] ?? ""), "USD") : currencyFrom(tab.name, "USD"),
        unit: unitFrom(tabText),
        dueMonth: dueMonth || expectedMonth,
        expectedMonth: expectedMonth || dueMonth,
        dueDate: dueCol >= 0 ? isoDate(row[dueCol]) : undefined,
        expectedDate: expectedCol >= 0 ? isoDate(row[expectedCol]) : undefined,
        probability: probabilityRaw === undefined ? undefined : probabilityRaw > 1 ? probabilityRaw / 100 : probabilityRaw,
        dateCell: expectedCol >= 0 ? `${quotedSheet(tab.name)}!${colName(expectedCol)}${i + 1}` : undefined,
        discountCell: discountCol >= 0 ? `${quotedSheet(tab.name)}!${colName(discountCol)}${i + 1}` : undefined,
        sourceKind: "invoice",
      });
    }
    break;
  }
  return records;
}

function parseWideCollectionsFromTab(tab: { name: string; values: unknown[][] }) {
  const grid = tab.values || [], records: CollectionRecord[] = [];
  const joined = grid.slice(0, 60).flat().map((cell) => String(cell ?? "")).join(" | ");
  if (!/debtor|receiv|customer|collection|\bar\b/i.test(`${tab.name} ${joined}`)) return records;
  for (let headerRow = 0; headerRow < Math.min(30, grid.length); headerRow++) {
    const headers = (grid[headerRow] || []).map((cell) => String(cell ?? "").trim());
    const accountCol = headerIndex(headers.map((value) => value.toLowerCase()), [/^account$|customer|client|counterparty/]);
    const daysCol = headerIndex(headers.map((value) => value.toLowerCase()), [/dso|debtor days|collection days|receivable days/]);
    const monthCols = headers.map((header, index) => periodLabel(header) ? index : -1).filter((index) => index >= 0);
    if (accountCol < 0 || daysCol < 0 || monthCols.length < 2) continue;

    const drivers = new Map<string, { cell: string; value: number }>();
    for (let rowIndex = headerRow + 1; rowIndex < grid.length; rowIndex++) {
      const row = grid[rowIndex] || [], account = String(row[accountCol] ?? "").trim(), days = parseNumber(row[daysCol]);
      if (/^total/i.test(account)) break;
      if (/closing receivable|collection/i.test(account) || !account || !days) continue;
      if (row.slice(monthCols[0], monthCols[monthCols.length - 1] + 1).some((cell) => cell !== "" && cell !== null && cell !== undefined)) {
        drivers.set(account.toLowerCase(), { cell: `${quotedSheet(tab.name)}!${colName(daysCol)}${rowIndex + 1}`, value: days });
      }
    }

    let sectionRow = -1;
    for (let rowIndex = headerRow + 1; rowIndex < grid.length; rowIndex++) {
      const label = String((grid[rowIndex] || [])[accountCol] ?? "");
      if (/collections? received|customer receipts|cash collections|receipts from customers/i.test(label)) { sectionRow = rowIndex; break; }
    }
    if (sectionRow < 0) {
      for (let rowIndex = headerRow + 1; rowIndex < grid.length; rowIndex++) {
        const label = String((grid[rowIndex] || [])[accountCol] ?? "");
        if (/closing receivables|accounts receivable detail/i.test(label)) { sectionRow = rowIndex; break; }
      }
    }
    if (sectionRow < 0) continue;

    for (let rowIndex = sectionRow + 1; rowIndex < grid.length; rowIndex++) {
      const row = grid[rowIndex] || [], customer = String(row[accountCol] ?? "").trim();
      if (!customer) continue;
      if (/^total|note|top \d|remaining|memo/i.test(customer)) {
        if (/^total/i.test(customer)) break;
        continue;
      }
      const driver = drivers.get(customer.toLowerCase());
      monthCols.forEach((column) => {
        const amount = parseNumber(row[column]), month = periodLabel(headers[column]);
        if (!amount || !month) return;
        records.push({
          id: `${tab.name}:${rowIndex + 1}:${column + 1}`,
          sheet: tab.name,
          row: rowIndex + 1,
          customer,
          invoice: "",
          amount,
          currency: currencyFrom(joined, "USD"),
          unit: unitFrom(joined),
          dueMonth: month,
          expectedMonth: month,
          driverCell: driver?.cell,
          driverValue: driver?.value,
          sourceKind: "account_schedule",
        });
      });
    }
    break;
  }
  return records;
}

function parsePaymentsFromTab(tab: { name: string; values: unknown[][] }) {
  const records: PaymentRecord[] = [], grid = tab.values || [];
  const tabText = grid.slice(0, 8).flat().map((cell) => String(cell ?? "")).join(" | ");
  for (let r = 0; r < Math.min(80, grid.length); r++) {
    const headers = (grid[r] || []).map((cell) => String(cell ?? "").trim().toLowerCase());
    const supplierCol = headerIndex(headers, [/supplier|vendor|creditor|counterparty|^account$/]);
    const amountCol = headerIndex(headers, [/amount|invoice value|payable|balance|payment/]);
    if (supplierCol < 0 || amountCol < 0) continue;
    const dueCol = headerIndex(headers, [/due date|invoice due|contractual/]);
    const expectedCol = headerIndex(headers, [/expected payment|payment date|cash date|forecast payment|settlement date/]);
    const invoiceCol = headerIndex(headers, [/invoice|bill|reference|document|purchase order|^po$/]);
    const probabilityCol = headerIndex(headers, [/probability|confidence|weighted/]);
    const discountCol = headerIndex(headers, [/discount|early pay|early payment/]);
    const currencyCol = headerIndex(headers, [/currency|ccy/]);
    for (let i = r + 1; i < grid.length; i++) {
      const row = grid[i] || [], supplier = String(row[supplierCol] ?? "").trim(), amount = Math.abs(parseNumber(row[amountCol]));
      if (!supplier || !amount) continue;
      const dueMonth = monthFromDate(dueCol >= 0 ? row[dueCol] : row[expectedCol]);
      const expectedMonth = monthFromDate(expectedCol >= 0 ? row[expectedCol] : row[dueCol]);
      if (!dueMonth && !expectedMonth) continue;
      const probabilityRaw = probabilityCol >= 0 ? parseNumber(row[probabilityCol]) : undefined;
      records.push({
        id: `${tab.name}:${i + 1}`, sheet: tab.name, row: i + 1, supplier,
        invoice: invoiceCol >= 0 ? String(row[invoiceCol] ?? "").trim() : "", amount,
        currency: currencyCol >= 0 ? currencyFrom(String(row[currencyCol] ?? ""), "USD") : currencyFrom(tab.name, "USD"),
        unit: unitFrom(tabText), dueMonth: dueMonth || expectedMonth, expectedMonth: expectedMonth || dueMonth,
        dueDate: dueCol >= 0 ? isoDate(row[dueCol]) : undefined,
        expectedDate: expectedCol >= 0 ? isoDate(row[expectedCol]) : undefined,
        probability: probabilityRaw === undefined ? undefined : probabilityRaw > 1 ? probabilityRaw / 100 : probabilityRaw,
        dateCell: expectedCol >= 0 ? `${quotedSheet(tab.name)}!${colName(expectedCol)}${i + 1}` : undefined,
        discountCell: discountCol >= 0 ? `${quotedSheet(tab.name)}!${colName(discountCol)}${i + 1}` : undefined,
        sourceKind: "invoice",
      });
    }
    break;
  }
  return records;
}

function parseWidePaymentsFromTab(tab: { name: string; values: unknown[][] }) {
  const grid = tab.values || [], records: PaymentRecord[] = [];
  const joined = grid.slice(0, 60).flat().map((cell) => String(cell ?? "")).join(" | ");
  if (!/creditor|payable|supplier|vendor|\bap\b/i.test(`${tab.name} ${joined}`)) return records;
  for (let headerRow = 0; headerRow < Math.min(30, grid.length); headerRow++) {
    const headers = (grid[headerRow] || []).map((cell) => String(cell ?? "").trim());
    const lowered = headers.map((value) => value.toLowerCase());
    const accountCol = headerIndex(lowered, [/^account$|supplier|vendor|creditor|counterparty/]);
    const daysCol = headerIndex(lowered, [/dpo|creditor days|payment days|payable days/]);
    const monthCols = headers.map((header, index) => periodLabel(header) ? index : -1).filter((index) => index >= 0);
    if (accountCol < 0 || daysCol < 0 || monthCols.length < 2) continue;
    const drivers = new Map<string, { cell: string; value: number }>();
    for (let rowIndex = headerRow + 1; rowIndex < grid.length; rowIndex++) {
      const row = grid[rowIndex] || [], account = String(row[accountCol] ?? "").trim();
      const rawDays = row[daysCol], days = parseNumber(rawDays);
      if (/^total/i.test(account)) break;
      if (/closing payable|payment/i.test(account) || !account || rawDays === "" || rawDays === null || rawDays === undefined) continue;
      if (row.slice(monthCols[0], monthCols[monthCols.length - 1] + 1).some((cell) => cell !== "" && cell !== null && cell !== undefined)) {
        drivers.set(account.toLowerCase(), { cell: `${quotedSheet(tab.name)}!${colName(daysCol)}${rowIndex + 1}`, value: days });
      }
    }
    let sectionRow = -1;
    for (let rowIndex = headerRow + 1; rowIndex < grid.length; rowIndex++) {
      const label = String((grid[rowIndex] || [])[accountCol] ?? "");
      if (/payments? made|supplier payments|vendor payments|payments to suppliers|cash paid/i.test(label)) { sectionRow = rowIndex; break; }
    }
    if (sectionRow < 0) {
      for (let rowIndex = headerRow + 1; rowIndex < grid.length; rowIndex++) {
        const label = String((grid[rowIndex] || [])[accountCol] ?? "");
        if (/closing payables|accounts payable detail/i.test(label)) { sectionRow = rowIndex; break; }
      }
    }
    if (sectionRow < 0) continue;
    for (let rowIndex = sectionRow + 1; rowIndex < grid.length; rowIndex++) {
      const row = grid[rowIndex] || [], supplier = String(row[accountCol] ?? "").trim();
      if (!supplier) continue;
      if (/^total|note|top \d|remaining|memo/i.test(supplier)) { if (/^total/i.test(supplier)) break; continue; }
      const driver = drivers.get(supplier.toLowerCase());
      monthCols.forEach((column) => {
        const amount = Math.abs(parseNumber(row[column])), month = periodLabel(headers[column]);
        if (!amount || !month) return;
        records.push({ id: `${tab.name}:${rowIndex + 1}:${column + 1}`, sheet: tab.name, row: rowIndex + 1,
          supplier, invoice: "", amount, currency: currencyFrom(joined, "USD"), unit: unitFrom(joined),
          dueMonth: month, expectedMonth: month, driverCell: driver?.cell, driverValue: driver?.value, sourceKind: "account_schedule" });
      });
    }
    break;
  }
  return records;
}

function detectModules(sheetNames: string[], rowText: string[]): ModuleId[] {
  const joined = [...sheetNames,...rowText].join("|").toLowerCase(), found: ModuleId[] = [];
  if (/cash.?flow|beginning cash|ending cash|net cash/.test(joined)) found.push("cash");
  if (/customer|client|invoice|expected collection|collection date|receipt date/.test(joined)) found.push("collections");
  if (/\bar\b|receivable|collections|dso/.test(joined)) found.push("receivables");
  if (/\bap\b|payable|supplier payments|dpo/.test(joined)) found.push("payables");
  if (/working.?capital|inventory|dio|cash conversion/.test(joined)) found.push("workingCapital");
  if (/debt|loan|borrow|principal|interest expense/.test(joined)) found.push("debt");
  if (/liquidity|bank position|minimum cash|headroom|restricted cash/.test(joined)) found.push("liquidity");
  if (/covenant|dscr|interest cover|leverage test/.test(joined)) found.push("covenants");
  if (/assumption|entit|\bfx\b|exchange rate/.test(joined)) found.push("fx");
  return found;
}

// True when a tab has a row of >=2 recognisable month/period headers.
function tabHasTimeline(values: unknown[][]): boolean {
  const grid = values || [];
  for (let r = 0; r < Math.min(60, grid.length); r++) {
    const hits = (grid[r] || []).filter((v) => periodLabel(v)).length;
    if (hits >= 2) return true;
  }
  return false;
}

export function parseWorkbook(workbook: string, tabs: { name: string; values: unknown[][] }[], selectedSources?: SourceAssignments): ScanResult {
  const rows: ScanRow[] = [];
  const sourceResolution = selectedSources ? resolveSources(tabs, selectedSources) : resolveSources(tabs, Object.fromEntries([
    ["cashFlow", "__auto__"], ["collections", "__auto__"], ["payables", "__auto__"], ["workingCapital", "__auto__"],
    ["debt", "__auto__"], ["liquidity", "__auto__"], ["covenants", "__auto__"], ["assumptions", "__auto__"],
  ]) as SourceAssignments);
  const activeSheets = new Set(Object.values(sourceResolution.resolved).filter((value) => value !== "__skip__" && value !== "__auto__"));
  const activeTabs = tabs.filter((tab) => activeSheets.has(tab.name));
  // Also scan any tab that clearly has a month timeline but wasn't matched to a
  // known module (e.g. a plain "P&L"). Its rows become available for the
  // cash-flow curation editor without changing module detection.
  const extraTimelinedTabs = tabs.filter((tab) => !activeSheets.has(tab.name) && tabHasTimeline(tab.values));
  const scanTabs = [...activeTabs, ...extraTimelinedTabs];
  const collectionTabs = activeTabs.filter((tab) => tab.name === sourceResolution.resolved.collections);
  const payableTabs = activeTabs.filter((tab) => tab.name === sourceResolution.resolved.payables);
  const invoiceCollections = collectionTabs.flatMap(parseCollectionsFromTab);
  const wideCollections = collectionTabs.flatMap(parseWideCollectionsFromTab);
  const collections = invoiceCollections.length ? invoiceCollections : wideCollections;
  const invoicePayments = payableTabs.flatMap(parsePaymentsFromTab);
  const widePayments = payableTabs.flatMap(parseWidePaymentsFromTab);
  const payments = invoicePayments.length ? invoicePayments : widePayments;
  let bestPeriods: string[] = [];
  for (const tab of scanTabs) {
    const grid = tab.values || [];
    const tabText = grid.slice(0, 8).flat().map((cell) => String(cell ?? "")).join(" | ");
    const tabCurrency = currencyFrom(tabText, "USD"), tabUnit = unitFrom(tabText, tabCurrency);
    let headerRow = -1, startCol = 4, tabPeriods: string[] = [];
    for (let r = 0; r < Math.min(60, grid.length); r++) {
      const hits = grid[r].map((v, i) => periodLabel(v) ? i : -1).filter((i) => i >= 0);
      if (hits.length >= 2) { headerRow = r; startCol = hits[0]; tabPeriods = hits.map((i) => periodLabel(grid[r][i])); break; }
    }
    if (tabPeriods.length > bestPeriods.length) bestPeriods = tabPeriods;
    let section = tab.name, entity = "Group", currency = "USD";
    grid.forEach((rawRow, index) => {
      const firstFour = rawRow.slice(0, 4).map((x) => String(x ?? "").trim());
      const label = firstFour.find(Boolean) || "";
      if (!label) return;
      const nonEmpty = rawRow.filter((x) => String(x ?? "").trim()).length;
      const instrumentHeading = /\b(term loan|revolver|revolving facility|overdraft|credit facility|lease|bond|note|debenture)\b/i.test(label);
      const preHeaderHeading = index < headerRow && (/schedule|model|consolidated|entity|①|②|③|④|⑤|⑥/i.test(label) || (label === label.toUpperCase() && label.length > 5));
      const looksSection = index < headerRow ? preHeaderHeading : nonEmpty <= 2 && (/·|①|②|③|④|⑤|⑥|consolidated/i.test(label) || instrumentHeading || (label === label.toUpperCase() && label.length > 5));
      if (looksSection && !/month #|opening/i.test(label)) {
        section = label; entity = entityFrom(label, entity); currency = currencyFrom(label, currency);
      }
      const display = tabPeriods.length ? rawRow.slice(startCol, startCol + tabPeriods.length).map((x) => String(x ?? "")) : [];
      const hasTimeline = display.some((x) => x !== "" && x !== "-" && x !== "—");
      let inputCell: string | undefined, inputValue: number | undefined;
      if (!hasTimeline && /assumption|driver|input/i.test(`${tab.name} ${section} ${label}`)) {
        for (let c = 3; c >= 1; c--) {
          const value = rawRow[c];
          if (value !== undefined && value !== null && String(value).trim() !== "" && Number.isFinite(parseNumber(value))) { inputCell = `${quotedSheet(tab.name)}!${colName(c)}${index + 1}`; inputValue = parseNumber(value); break; }
        }
      }
      if (!hasTimeline && !inputCell) return;
      const endCol = Math.max(startCol, startCol + Math.max(0, tabPeriods.length - 1));
      rows.push({ id: `${tab.name}:${index + 1}`, sheet: tab.name, row: index + 1, label: label.trim(), section, entity: entityFrom(section, entity), currency: currencyFrom(section, tabCurrency || currency), unit: tabUnit, range: `${quotedSheet(tab.name)}!${colName(startCol)}${index + 1}:${colName(endCol)}${index + 1}`, values: display.map(parseNumber), display, inputCell, inputValue });
    });
  }
  const sourceForModule: Record<ModuleId, keyof SourceAssignments> = {
    cash: "cashFlow", collections: "collections", receivables: "collections", payables: "payables",
    workingCapital: "workingCapital", debt: "debt", liquidity: "liquidity", covenants: "covenants", fx: "assumptions",
  };
  const modules = detectModules(activeTabs.map((t) => t.name),rows.flatMap((r)=>[r.label,r.section])).filter((module) => sourceResolution.resolved[sourceForModule[module]] !== "__skip__");
  if (collections.length && !modules.includes("collections")) modules.push("collections");
  if (payments.length && !modules.includes("payables")) modules.push("payables");
  const mappings = buildMappingSuggestions(activeTabs, sourceResolution.resolved);
  return { schemaVersion: SCAN_SCHEMA_VERSION, workbook, scannedAt: new Date().toISOString(), periods: bestPeriods, sheets: scanTabs.map((t) => t.name), modules, rows, collections, payments, sourceAssignments: sourceResolution.resolved, sourceScores: sourceResolution.scores, mappings };
}

/** Recover supplier-by-month records from persisted scan rows created before
 * dedicated payment extraction existed. Fresh scans use `scan.payments` and
 * retain the editable supplier DPO cell detected from the source workbook. */
export function paymentsForScan(scan: ScanResult): PaymentRecord[] {
  if (scan.payments?.length) return scan.payments;
  const source = scan.sourceAssignments?.payables;
  if (!source || source === "__skip__" || source === "__auto__") return [];
  return scan.rows
    .filter((row) => row.sheet === source && /payments? made|supplier payments|vendor payments|payments to suppliers|cash paid/i.test(row.section))
    .flatMap((row) => row.values.flatMap((rawAmount, index) => {
      const amount = Math.abs(rawAmount || 0), month = scan.periods[index];
      if (!amount || !month || /^total|note|top \d|remaining|memo/i.test(row.label)) return [];
      return [{ id: `recovered:${row.id}:${index}`, sheet: row.sheet, row: row.row, supplier: row.label,
        invoice: "", amount, currency: row.currency, unit: row.unit, dueMonth: month,
        expectedMonth: month, sourceKind: "account_schedule" as const }];
    }));
}

export function rowsFor(scan: ScanResult | null, sheet: string, entity?: string) {
  if (!scan) return [];
  return scan.rows.filter((r) => (r.sheet.toLowerCase().includes(sheet.toLowerCase()) || r.section.toLowerCase().includes(sheet.toLowerCase())) && (!entity || r.entity === entity));
}

export function findRow(rows: ScanRow[], terms: string[]) {
  return rows.find((r) => terms.every((t) => r.label.toLowerCase().includes(t.toLowerCase())));
}

export function entitiesFor(scan: ScanResult | null, sheet: string) {
  return [...new Set(rowsFor(scan, sheet).map((r) => r.entity).filter((x) => x !== "Group"))];
}

export function allEntities(scan: ScanResult | null) {
  if (!scan) return [];
  return [...new Set(scan.rows.map((r) => r.entity).filter((x) => x && x !== "Group"))];
}

export function driverRows(scan: ScanResult | null) {
  if (!scan) return [];
  return scan.rows.filter((r) => r.inputCell && /(dso|dpo|dio|minimum cash|sweep trigger|interest rate|margin|commitment|overdraft)/i.test(r.label));
}
