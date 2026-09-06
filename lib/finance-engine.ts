export type VariableKind = "input" | "formula" | "output";
export type Unit = "₹" | "#" | "%";

export type ModelVariable = {
  key: string;
  name: string;
  unit: Unit;
  kind: VariableKind;
  base?: number;
  steps?: { from: number; value: number }[];
  expr?: string;
  range?: string;
  actualRange?: string;
  writable?: boolean;
  forecast?: (number | null)[];
  actuals?: (number | null)[];
  read?: (number | null)[];
  metric?: string;
  account?: string;
  agg?: "sum" | "avg" | "last";
};

export type GenericModel = {
  periods: string[];
  closed: number;
  displayVars: string[];
  scenarioName: string;
  vars: ModelVariable[];
  ov: Record<string, Record<number, number>>;
  pages?: string[];
  canvasPage?: number;
  nodePos?: Record<string, { x: number; y: number; pg: number }>;
  solveMode?: "proportional" | "single";
  solveDriver?: string;
};

type Token = { n: number } | { v: string } | { op: string };

export function compileExpression(expr: string) {
  const tokens = String(expr).match(/[A-Za-z_][A-Za-z0-9_]*|\d+\.?\d*|[()+\-*/]/g) || [];
  const out: Token[] = [];
  const ops: string[] = [];
  const prec: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2 };
  for (const token of tokens) {
    if (/^[\d.]/.test(token)) out.push({ n: Number(token) });
    else if (/^[A-Za-z_]/.test(token)) out.push({ v: token });
    else if (token === "(") ops.push(token);
    else if (token === ")") {
      while (ops.length && ops[ops.length - 1] !== "(") out.push({ op: ops.pop() as string });
      ops.pop();
    } else {
      while (ops.length && prec[ops[ops.length - 1]] >= prec[token]) out.push({ op: ops.pop() as string });
      ops.push(token);
    }
  }
  while (ops.length) out.push({ op: ops.pop() as string });
  return { rpn: out, deps: [...new Set(out.filter((x): x is { v: string } => "v" in x).map((x) => x.v))] };
}

function evalRpn(rpn: Token[], scope: Record<string, number>) {
  const stack: number[] = [];
  for (const token of rpn) {
    if ("n" in token) stack.push(token.n);
    else if ("v" in token) stack.push(Number(scope[token.v.toLowerCase()]) || 0);
    else {
      const b = stack.pop() ?? 0;
      const a = stack.pop() ?? 0;
      stack.push(token.op === "+" ? a + b : token.op === "-" ? a - b : token.op === "*" ? a * b : a / (b || 1));
    }
  }
  return stack.length ? stack[stack.length - 1] : 0;
}

export function inputSchedule(v: ModelVariable, count: number) {
  const arr = new Array(count).fill(Number(v.base) || 0);
  (v.steps || [])
    .slice()
    .sort((a, b) => a.from - b.from)
    .forEach((step) => {
      for (let p = Math.max(0, step.from); p < count; p++) arr[p] = step.value;
    });
  return arr;
}

export function inputValue(model: GenericModel, v: ModelVariable, period: number, scenario: boolean) {
  const base = inputSchedule(v, model.periods.length);
  const anchors = scenario ? model.ov?.[v.key] : null;
  if (anchors) {
    let anchor = -1;
    for (const key of Object.keys(anchors)) {
      const p = Number(key);
      if (p <= period && p > anchor) anchor = p;
    }
    if (anchor >= 0) return anchors[anchor] + (base[period] - base[anchor]);
  }
  return base[period];
}

export function evaluateModel(model: GenericModel, scenario: boolean) {
  const n = model.periods.length;
  const result: Record<string, number[]> = {};
  model.vars.forEach((v) => (result[v.key] = new Array(n).fill(0)));

  for (let p = 0; p < n; p++) {
    const scope: Record<string, number> = {};
    for (const v of model.vars.filter((x) => x.kind === "input")) {
      const value = inputValue(model, v, p, scenario);
      scope[v.key.toLowerCase()] = value;
      result[v.key][p] = value;
    }
    for (const v of model.vars.filter((x) => x.kind === "output")) {
      const value = Number(v.read?.[p] ?? v.forecast?.[p] ?? 0);
      scope[v.key.toLowerCase()] = value;
      result[v.key][p] = value;
    }
    let remaining = model.vars.filter((x) => x.kind === "formula");
    for (let i = 0; i < remaining.length + 2 && remaining.length; i++) {
      remaining = remaining.filter((v) => {
        const compiled = compileExpression(v.expr || "");
        if (compiled.deps.every((dep) => dep.toLowerCase() in scope)) {
          const value = evalRpn(compiled.rpn, scope);
          scope[v.key.toLowerCase()] = value;
          result[v.key][p] = value;
          return false;
        }
        return true;
      });
    }
  }
  return result;
}

export function leavesOf(model: GenericModel, key: string) {
  const found = new Set<string>();
  const walk = (lookup: string, seen: Set<string>) => {
    const v = model.vars.find((x) => x.key.toLowerCase() === lookup.toLowerCase());
    if (!v || seen.has(v.key)) return;
    if (v.kind === "input") {
      found.add(v.key);
      return;
    }
    if (v.kind === "formula") {
      seen.add(v.key);
      compileExpression(v.expr || "").deps.forEach((dep) => walk(dep, seen));
    }
  };
  walk(key, new Set());
  return [...found];
}

export function setOverride(model: GenericModel, key: string, period: number, value: number) {
  return {
    ...model,
    ov: { ...model.ov, [key]: { ...(model.ov[key] || {}), [period]: Number(value.toFixed(4)) } },
  };
}

export function aggregate(values: (number | null | undefined)[], method: "sum" | "avg" | "last" = "sum") {
  const clean = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!clean.length) return 0;
  if (method === "avg") return clean.reduce((s, v) => s + v, 0) / clean.length;
  if (method === "last") return clean[clean.length - 1];
  return clean.reduce((s, v) => s + v, 0);
}

export function formatValue(value: number, unit: Unit) {
  if (unit === "#") return Math.round(value).toLocaleString("en-IN");
  if (unit === "%") return `${(value * 100).toFixed(1)}%`;
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)}L`;
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
}

export function demoGenericModel(): GenericModel {
  return {
    periods: ["Jan '26", "Feb '26", "Mar '26", "Apr '26", "May '26", "Jun '26", "Jul '26", "Aug '26", "Sep '26", "Oct '26", "Nov '26", "Dec '26"],
    closed: 0,
    displayVars: ["revenue", "ebitda"],
    scenarioName: "Working scenario",
    ov: {},
    pages: ["Revenue build", "Profit bridge"],
    canvasPage: 0,
    nodePos: {
      price: { x: 28, y: 32, pg: 0 },
      users: { x: 28, y: 142, pg: 0 },
      retention: { x: 28, y: 252, pg: 0 },
      revenue: { x: 360, y: 116, pg: 0 },
      gross_margin: { x: 28, y: 38, pg: 1 },
      gross_profit: { x: 330, y: 38, pg: 1 },
      opex: { x: 28, y: 166, pg: 1 },
      ebitda: { x: 630, y: 102, pg: 1 },
    },
    vars: [
      { key: "price", name: "Subscription price", unit: "₹", kind: "input", base: 950, writable: true, range: "" },
      { key: "users", name: "Active users", unit: "#", kind: "input", base: 1200, steps: [{ from: 6, value: 1500 }], writable: true, range: "" },
      { key: "retention", name: "Revenue retention", unit: "%", kind: "input", base: 1.02, writable: true, range: "" },
      { key: "gross_margin", name: "Gross margin", unit: "%", kind: "input", base: 0.62, writable: true, range: "" },
      { key: "opex", name: "Operating expenses", unit: "₹", kind: "input", base: 620000, writable: true, range: "" },
      { key: "revenue", name: "Revenue", unit: "₹", kind: "formula", expr: "price * users * retention" },
      { key: "gross_profit", name: "Gross profit", unit: "₹", kind: "formula", expr: "revenue * gross_margin" },
      { key: "ebitda", name: "EBITDA", unit: "₹", kind: "formula", expr: "gross_profit - opex" },
    ],
  };
}
