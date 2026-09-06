export type SourceModuleId =
  | "cashFlow"
  | "collections"
  | "payables"
  | "workingCapital"
  | "debt"
  | "liquidity"
  | "covenants"
  | "assumptions";

export type SourceAssignments = Record<SourceModuleId, string>;

export type MappingSuggestion = {
  id: string;
  module: SourceModuleId;
  metric: string;
  label: string;
  sheet: string;
  range: string;
  confidence: number;
  writable: boolean;
  accepted: boolean;
  reason: string;
  filled?: number; // how many real numeric cells the mapped range holds (used to pick the best row per concept)
};

export type SheetPreview = { name: string; values: unknown[][] };

type ModuleDefinition = {
  id: SourceModuleId;
  label: string;
  tabTerms: RegExp[];
  contentTerms: RegExp[];
};

export const AUTO_SOURCE = "__auto__";
export const SKIP_SOURCE = "__skip__";

export const sourceModules: ModuleDefinition[] = [
  { id: "cashFlow", label: "Cash flow", tabTerms: [/cash.?flow|cash.?position|cash.?forecast/i], contentTerms: [/opening cash|beginning cash/i, /closing cash|ending cash/i, /net cash|change in cash/i] },
  { id: "collections", label: "Customer collections", tabTerms: [/debtor|receiv|collection|\bar\b/i], contentTerms: [/customer|client|account/i, /dso|debtor days|collection days/i, /collections received|customer receipts|cash collections/i] },
  { id: "payables", label: "Supplier payments", tabTerms: [/creditor|payable|supplier|\bap\b/i], contentTerms: [/supplier|vendor|creditor/i, /dpo|payment days|payable days/i, /payments made|supplier payments/i] },
  { id: "workingCapital", label: "Working capital", tabTerms: [/working.?capital|\bwc\b|cash conversion/i], contentTerms: [/dso|debtor days/i, /dpo|creditor days/i, /dio|inventory days/i, /net working capital|cash conversion/i] },
  { id: "debt", label: "Debt", tabTerms: [/debt|loan|borrow|facility|revolver/i], contentTerms: [/principal/i, /interest/i, /opening balance|closing balance/i, /drawdown|repayment/i] },
  { id: "liquidity", label: "Liquidity", tabTerms: [/liquidity|bank.?position|cash.?position/i], contentTerms: [/minimum cash|cash buffer/i, /restricted cash/i, /headroom|available cash|overdraft/i] },
  { id: "covenants", label: "Covenants", tabTerms: [/covenant|compliance/i], contentTerms: [/dscr|debt service coverage/i, /leverage/i, /interest cover/i, /covenant test|breach/i] },
  { id: "assumptions", label: "Assumptions", tabTerms: [/assumption|driver|input|control/i], contentTerms: [/growth|rate/i, /days/i, /opening cash|minimum cash/i, /capex|tax/i] },
];

export const emptySourceAssignments = Object.fromEntries(
  sourceModules.map((module) => [module.id, AUTO_SOURCE]),
) as SourceAssignments;

const metricDictionary: Array<{
  module: SourceModuleId;
  metric: string;
  label: string;
  terms: RegExp[];
  writable?: boolean;
  exclude?: RegExp; // skip this concept when the label also matches this (kills look-alikes, e.g. "pre-capex")
}> = [
  { module: "cashFlow", metric: "opening_cash", label: "Opening cash", terms: [/opening cash|beginning cash|cash at start/i] },
  { module: "cashFlow", metric: "closing_cash", label: "Closing cash", terms: [/closing cash|ending cash|cash at end/i] },
  { module: "cashFlow", metric: "net_cash", label: "Net cash movement", terms: [/net cash|net change.*cash|change in cash/i] },
  { module: "cashFlow", metric: "operating_cash_flow", label: "Operating cash flow", terms: [/operating cash flow|cash from operations|cash generated from operations|\bocf\b/i] },
  { module: "cashFlow", metric: "customer_cash", label: "Customer collections", terms: [/collections from customers|customer receipts|collections received|cash received from customers/i] },
  { module: "cashFlow", metric: "supplier_cash", label: "Supplier payments", terms: [/payments to suppliers|supplier payments|payments made|vendor payments/i] },
  { module: "cashFlow", metric: "capex", label: "Capital expenditure", terms: [/capital expenditure|\bcapex\b|purchase of fixed assets/i], exclude: /operating cash flow|pre[\s-]?capex|before capex|ex[\s-]?capex|excluding capex|post[\s-]?capex|net of capex/i },
  { module: "cashFlow", metric: "debt_service", label: "Debt service", terms: [/debt service|principal repayment|loan repayment|interest paid|interest expense/i] },
  { module: "collections", metric: "dso", label: "DSO / collection days", terms: [/\bdso\b|debtor days|collection days|receivable days/i], writable: true },
  { module: "collections", metric: "receivables", label: "Closing receivables", terms: [/closing receivables|trade debtors|accounts receivable|closing ar/i] },
  { module: "payables", metric: "dpo", label: "DPO / payment days", terms: [/\bdpo\b|creditor days|payment days|payable days/i], writable: true },
  { module: "payables", metric: "payables", label: "Closing payables", terms: [/closing payables|trade creditors|accounts payable|closing ap/i] },
  { module: "workingCapital", metric: "dso", label: "DSO", terms: [/\bdso\b|debtor days|collection days/i] },
  { module: "workingCapital", metric: "dpo", label: "DPO", terms: [/\bdpo\b|creditor days|payment days/i] },
  { module: "workingCapital", metric: "dio", label: "DIO", terms: [/\bdio\b|inventory days|stock days/i], writable: true },
  { module: "workingCapital", metric: "nwc", label: "Net working capital", terms: [/net working capital|\bnwc\b/i] },
  { module: "debt", metric: "interest", label: "Interest", terms: [/interest paid|cash interest|interest expense|interest.*rate/i], writable: true },
  { module: "debt", metric: "principal", label: "Principal repayment", terms: [/principal repayment|loan repayment|amortisation|amortization/i], writable: true },
  { module: "liquidity", metric: "minimum_cash", label: "Minimum cash", terms: [/minimum cash|cash buffer|minimum balance/i], writable: true },
  { module: "covenants", metric: "dscr", label: "DSCR", terms: [/\bdscr\b|debt service coverage/i] },
];

function cellText(values: unknown[][]) {
  return values.slice(0, 100).flatMap((row) => row.slice(0, 40)).map((cell) => String(cell ?? "").trim()).filter(Boolean).join(" | ");
}

export function sourceScores(tabs: SheetPreview[]) {
  const scores: Record<SourceModuleId, Array<{ sheet: string; score: number; reason: string }>> = Object.fromEntries(
    sourceModules.map((module) => [module.id, []]),
  ) as unknown as Record<SourceModuleId, Array<{ sheet: string; score: number; reason: string }>>;

  tabs.forEach((tab) => {
    const content = cellText(tab.values);
    sourceModules.forEach((module) => {
      const tabHits = module.tabTerms.filter((term) => term.test(tab.name)).length;
      const contentHits = module.contentTerms.filter((term) => term.test(content)).length;
      const score = Math.min(100, tabHits * 45 + contentHits * 14);
      if (score > 0) scores[module.id].push({
        sheet: tab.name,
        score,
        reason: [tabHits ? "sheet name" : "", contentHits ? `${contentHits} recognised labels` : ""].filter(Boolean).join(" and "),
      });
    });
  });

  sourceModules.forEach((module) => scores[module.id].sort((a, b) => b.score - a.score));
  return scores;
}

export function resolveSources(tabs: SheetPreview[], selected: SourceAssignments) {
  const scores = sourceScores(tabs);
  const resolved = { ...selected };
  sourceModules.forEach((module) => {
    if (selected[module.id] === SKIP_SOURCE) return;
    if (selected[module.id] !== AUTO_SOURCE && tabs.some((tab) => tab.name === selected[module.id])) return;
    const best = scores[module.id][0];
    resolved[module.id] = best && best.score >= 28 ? best.sheet : SKIP_SOURCE;
  });
  return { resolved, scores };
}

function colName(index: number) {
  let n = index + 1, out = "";
  while (n) { const remainder = (n - 1) % 26; out = String.fromCharCode(65 + remainder) + out; n = Math.floor((n - 1) / 26); }
  return out;
}

function quoteSheet(name: string) { return `'${name.replace(/'/g, "''")}'`; }

function timeline(values: unknown[][]) {
  for (let row = 0; row < Math.min(values.length, 60); row++) {
    const columns = (values[row] || []).map((cell, index) => /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-\s/]?\d{2,4}/i.test(String(cell ?? "")) || (typeof cell === "number" && cell > 20000 && cell < 80000) ? index : -1).filter((index) => index >= 0);
    if (columns.length >= 2) return { row, start: columns[0], end: columns[columns.length - 1] };
  }
  return null;
}

export function buildMappingSuggestions(tabs: SheetPreview[], assignments: SourceAssignments): MappingSuggestion[] {
  const suggestions: MappingSuggestion[] = [];
  sourceModules.forEach((module) => {
    const sheet = assignments[module.id];
    if (!sheet || sheet === SKIP_SOURCE || sheet === AUTO_SOURCE) return;
    const tab = tabs.find((candidate) => candidate.name === sheet);
    if (!tab) return;
    const time = timeline(tab.values);
    (tab.values || []).forEach((row, rowIndex) => {
      const labelColumn = row.findIndex((cell, index) => index < 5 && String(cell ?? "").trim());
      if (labelColumn < 0) return;
      const label = String(row[labelColumn] ?? "").trim();
      metricDictionary.filter((metric) => metric.module === module.id).forEach((metric) => {
        const matchedTerms = metric.terms.filter((term) => term.test(label));
        if (!matchedTerms.length) return;
        if (metric.exclude && metric.exclude.test(label)) return;
        if (["dso", "dpo", "dio"].includes(metric.metric) && /cash conversion|dso\s*\+.*dpo/i.test(label)) return;
        const hasTimeline = !!time && row.slice(time.start, time.end + 1).some((cell) => cell !== "" && cell !== null && cell !== undefined);
        let start = hasTimeline && time ? time.start : Math.min(row.length - 1, labelColumn + 1);
        let end = hasTimeline && time ? time.end : start;
        let inputFound = false;
        if (metric.writable && !hasTimeline) {
          const inputIndex = row.findIndex((cell, index) => index > labelColumn && index < 6 && typeof cell === "number");
          if (inputIndex >= 0) { start = end = inputIndex; inputFound = true; }
        }
        if (!hasTimeline && !inputFound) return;
        const filled = row.slice(start, end + 1).filter((cell) => typeof cell === "number" && Number.isFinite(cell)).length;
        const confidence = Math.min(99, 64 + matchedTerms.length * 12 + (hasTimeline ? 10 : 0) + (metric.writable && start === end ? 8 : 0));
        suggestions.push({
          id: `${module.id}:${metric.metric}:${sheet}:${rowIndex + 1}`,
          module: module.id,
          metric: metric.metric,
          label,
          sheet,
          range: `${quoteSheet(sheet)}!${colName(start)}${rowIndex + 1}${end !== start ? `:${colName(end)}${rowIndex + 1}` : ""}`,
          confidence,
          writable: !!metric.writable && inputFound,
          accepted: confidence >= 75,
          reason: `${metric.label} matched from “${label}”${hasTimeline ? " across the detected timeline" : ""}`,
          filled,
        });
      });
    });
    if (module.id === "collections" || module.id === "payables") {
      for (let rowIndex = 0; rowIndex < Math.min(40, tab.values.length); rowIndex++) {
        const headers = (tab.values[rowIndex] || []).map((cell) => String(cell ?? "").trim());
        const accountColumn = headers.findIndex((header) => /^(account|customer|client|supplier|vendor|counterparty)$/i.test(header));
        const daysColumn = headers.findIndex((header) => module.id === "collections" ? /dso|debtor days|collection days|receivable days/i.test(header) : /dpo|creditor days|payment days|payable days/i.test(header));
        if (accountColumn < 0 || daysColumn < 0) continue;
        let firstData = -1, lastData = -1;
        for (let dataRow = rowIndex + 1; dataRow < tab.values.length; dataRow++) {
          const label = String((tab.values[dataRow] || [])[accountColumn] ?? "").trim();
          if (/^total/i.test(label)) break;
          const value = (tab.values[dataRow] || [])[daysColumn];
          if (label && typeof value === "number") { if (firstData < 0) firstData = dataRow; lastData = dataRow; }
        }
        if (firstData >= 0) suggestions.push({
          id: `${module.id}:${module.id === "collections" ? "customer_dso" : "supplier_dpo"}:${sheet}:${rowIndex + 1}`,
          module: module.id,
          metric: module.id === "collections" ? "customer_dso" : "supplier_dpo",
          label: headers[daysColumn],
          sheet,
          range: `${quoteSheet(sheet)}!${colName(daysColumn)}${firstData + 1}:${colName(daysColumn)}${lastData + 1}`,
          confidence: 96,
          writable: true,
          accepted: true,
          reason: `Account column and editable ${headers[daysColumn]} column detected`,
        });
        break;
      }
    }
  });
  // Keep only the single best row per concept: highest confidence, then the row
  // that actually holds the most numeric values (a real monthly series beats a
  // one-off KPI cell). Ties keep the earliest row, encountered first.
  const bestByConcept = new Map<string, MappingSuggestion>();
  for (const suggestion of suggestions) {
    const key = `${suggestion.module}:${suggestion.metric}`;
    const current = bestByConcept.get(key);
    const isBetter = !current
      || suggestion.confidence > current.confidence
      || (suggestion.confidence === current.confidence && (suggestion.filled ?? 0) > (current.filled ?? 0));
    if (isBetter) bestByConcept.set(key, suggestion);
  }
  return [...bestByConcept.values()].sort((a, b) => b.confidence - a.confidence);
}

export function moduleLabel(id: SourceModuleId) {
  return sourceModules.find((module) => module.id === id)?.label || id;
}
