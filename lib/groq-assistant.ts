export const GROQ_MODEL = "openai/gpt-oss-120b";
export const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

export type AssistantLever = {
  id: string;
  name: string;
  kind: "working_capital" | "custom";
  value: number;
  base: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  mapped: boolean;
  business_effect: string;
};

export type AssistantOutputs = {
  closing_cash: number | null;
  runway_months: number | null;
  monthly_burn_rate: number | null;
  operating_cash_flow: number | null;
  net_cash_movement: number | null;
  cash_conversion_cycle_days: number;
  working_capital_cash_impact: number;
  custom_lever_cash_impact: number;
  total_cash_impact: number;
};

export type AssistantEngineState = {
  model: { name: string; mode: "connected_workbook" | "demo"; entity: string; unit: string };
  period: { from: string; to: string };
  inputs: { opening_cash: number; built_in_drivers: Record<string, number>; source_series: Record<string, number[]> };
  available_levers: AssistantLever[];
  computed_outputs: AssistantOutputs;
  cash_bridge_components: Record<string, number>;
  cash_bridge_ranked: Array<{ component: string; amount: number; direction: "inflow" | "outflow" }>;
  computed_model_lines: Array<{ label: string; section: string; values: number[] }>;
};

export type AssistantChange = { lever_id: string; new_value: number; reason: string };
export type AssistantReply = {
  mode: "explain" | "scenario" | "out_of_scope";
  answer: string;
  changes: AssistantChange[];
  business_actions: string[];
};

export type AssistantTopic = "dso" | "dpo" | "dio" | "cash" | "runway" | "ccc" | "debt" | "capex" | "people" | "revenue";
export type Direction = "increase" | "decrease" | "target";
export type MagnitudeUnit = "days" | "months" | "percent" | "currency" | "number";
export type Magnitude = { mode: "to" | "by"; value: number; unit: MagnitudeUnit };
export type RouteGap = "metric" | "topic" | "direction" | "magnitude";

// Everything the deterministic router managed to pull out of the question,
// before any AI is involved. The clarifying step reads `missing` to know
// which of these slots still needs a question put to the user.
export type RouteSlots = {
  intent: "explain" | "scenario" | "out_of_scope";
  topics: AssistantTopic[];
  metric: keyof AssistantOutputs | null;
  direction: Direction | null;
  magnitude: Magnitude | null;
  entity: string | null;
};

export type AssistantRoute = {
  intent: "explain" | "scenario";
  topics: AssistantTopic[];
  requested_outputs: Array<keyof AssistantOutputs>;
  broad_lever_search: boolean;
  slots: RouteSlots;
  missing: RouteGap[];
  confidence: number;
  matched: string[];
};

export type AssistantClarification = {
  question: string;
  options: Array<{ label: string; value: keyof AssistantOutputs }>;
};

// ---------------------------------------------------------------------------
// Deterministic router dictionary
// ---------------------------------------------------------------------------
// Plain-language phrases mapped to the model's topics. This is the part to grow
// over time: when you notice a founder phrasing a question a new way, add the
// phrase to the right list here — no other code needs to change. Matching is
// stem-based, so "collect" already covers "collects/collected/collection".
export const TOPIC_PHRASES: Record<AssistantTopic, string[]> = {
  dso: ["dso", "days sales outstanding", "debtor days", "debtor", "receivable", "accounts receivable", "ar days", "collect", "collection", "get paid", "getting paid", "paid faster", "paid sooner", "customer pay", "customers pay", "customer to pay", "customers to pay", "pay us", "pay faster", "pay sooner", "pay quicker", "paying me", "paying us", "before paying", "time to pay", "days to pay", "taking to pay", "take to pay", "customer payment", "customer term", "credit period", "invoice", "invoicing", "money owed to us", "money customers owe"],
  dpo: ["dpo", "days payable outstanding", "creditor days", "creditor", "payable", "accounts payable", "ap days", "supplier", "vendor", "pay supplier", "paying supplier", "supplier term", "supplier payment", "payment terms to supplier", "stretch payable", "delay paying", "money we owe", "bills we owe"],
  dio: ["dio", "days inventory outstanding", "inventory", "stock", "stock days", "stock holding", "stock level", "warehouse", "goods on hand", "holding period"],
  ccc: ["cash conversion cycle", "ccc", "working capital cycle", "cash cycle", "conversion cycle", "working capital days"],
  runway: ["runway", "months of cash", "month of cash", "cash last", "cash will last", "run out of cash", "run out of money", "out of money", "out of cash", "survive", "stay alive", "last us"],
  debt: ["debt", "loan", "borrow", "interest", "principal", "repayment", "repay", "revolver", "credit line", "line of credit", "facility", "drawdown", "draw down", "covenant", "leverage", "lender", "refinance"],
  capex: ["capex", "capital expenditure", "capital expense", "equipment", "machinery", "buy equipment", "fixed asset", "asset purchase", "capital spend", "capital investment", "plant and machinery"],
  people: ["hiring", "hire", "headcount", "head count", "payroll", "salary", "salaries", "wage", "team cost", "people cost", "staff cost", "compensation", "layoff", "lay off", "reduce staff", "cut staff", "freeze hiring", "hiring freeze"],
  revenue: ["revenue", "sales", "topline", "top line", "subscription", "mrr", "arr", "pricing", "raise price", "volume", "unit sold", "retention", "churn", "grow sales", "new customer", "booking", "upsell"],
  cash: ["cash flow", "cashflow", "cash position", "cash balance", "closing cash", "ending cash", "liquidity", "cash", "cash in bank", "bank balance", "free cash flow", "fcf", "cash burn", "burn rate", "burn", "spending"],
};

// Phrases that identify which OUTPUT the user wants to measure. Order matters:
// the first list that hits sets the primary metric, so the most generic
// ("cash flow" -> net movement) sits last.
const METRIC_PHRASES: Array<[keyof AssistantOutputs, string[]]> = [
  ["runway_months", ["runway", "months of cash", "cash last", "cash will last", "run out of cash", "run out of money", "how long"]],
  ["closing_cash", ["closing cash", "ending cash", "cash position", "cash balance", "cash in bank", "bank balance", "how much cash"]],
  ["operating_cash_flow", ["operating cash flow", "ocf", "cash from operations"]],
  ["cash_conversion_cycle_days", ["cash conversion cycle", "ccc", "working capital cycle", "cash cycle"]],
  ["monthly_burn_rate", ["burn rate", "monthly burn", "how much are we burning", "cash burn"]],
  ["net_cash_movement", ["net cash", "cash movement", "change in cash", "cash flow"]],
];

// Words that mean "run a what-if", rather than "explain the current model".
const SCENARIO_WORDS = ["what if", "if i", "if we", "what happens", "what would happen", "suppose", "imagine", "scenario", "simulate", "play with", "change", "adjust", "move the", "increase", "decrease", "reduce", "raise", "lower", "extend", "improve", "cut", "grow", "shrink", "delay", "accelerate", "stretch", "offer a discount", "pull forward", "push back", "should i", "should we", "how do i", "how can i", "how do we", "how can we", "what should"];

function padded(question: string) {
  return " " + question.toLowerCase().replace(/[^a-z0-9%.]+/g, " ").replace(/\s+/g, " ").trim() + " ";
}
// Stem match: the phrase must start on a word boundary but need not end on one,
// so "collect" matches "collection" and "invoice" matches "invoicing".
function matchStem(hay: string, phrase: string) {
  const p = phrase.toLowerCase().trim();
  if (p.includes("...")) {
    const [a, b] = p.split("...").map((part) => part.trim());
    const ia = hay.indexOf(" " + a), ib = hay.indexOf(b + " ");
    return ia >= 0 && ib >= 0 && ia < ib;
  }
  return hay.includes(" " + p);
}

function parseMagnitude(question: string): Magnitude | null {
  const q = " " + question.toLowerCase() + " ";
  const unitOf = (u: string | undefined): MagnitudeUnit => {
    if (!u) return "number";
    if (/^%|^percent/.test(u)) return "percent";
    if (/^day/.test(u)) return "days";
    if (/^month|^mo$/.test(u)) return "months";
    if (/^(k|m|cr|crore|lakh|rs|inr)/.test(u)) return "currency";
    return "number";
  };
  const unitGroup = "(days?|months?|mo|%|percent|k|m|cr|crore|lakh|rs|inr)?";
  let m = q.match(new RegExp("\\b(?:to|at|of)\\s+(\\d+(?:\\.\\d+)?)\\s*" + unitGroup));
  if (m) return { mode: "to", value: Number(m[1]), unit: unitOf(m[2]) };
  m = q.match(new RegExp("\\bby\\s+(\\d+(?:\\.\\d+)?)\\s*" + unitGroup));
  if (m) return { mode: "by", value: Number(m[1]), unit: unitOf(m[2]) };
  m = q.match(/(\d+(?:\.\d+)?)\s*(%|percent)\b/);
  if (m) return { mode: "by", value: Number(m[1]), unit: "percent" };
  m = q.match(/(\d+(?:\.\d+)?)\s*(days?|months?)\b/);
  if (m) {
    // Natural phrases such as "pay suppliers 10 days faster" describe a
    // delta, not an absolute ten-day DPO target.
    const relative = /\b(faster|sooner|quicker|slower|later|earlier|more|less|extra|additional)\b/.test(q);
    return { mode: relative ? "by" : "to", value: Number(m[1]), unit: unitOf(m[2]) };
  }
  return null;
}

/** Convert the LLM's lever suggestion into a deterministic, validated input.
 * Numeric intent comes from the local parser and current engine state; the LLM
 * is never trusted to calculate a target value. */
export function resolveScenarioChanges(changes: AssistantChange[], route: AssistantRoute, state: AssistantEngineState): AssistantChange[] {
  const available = new Map(state.available_levers.map((lever) => [lever.id, lever]));
  const directTopic = route.topics.find((topic) => topic === "dso" || topic === "dpo" || topic === "dio");
  const requested = directTopic && available.has(directTopic)
    ? [{ lever_id: directTopic, new_value: available.get(directTopic)!.value, reason: changes.find((change) => change.lever_id === directTopic)?.reason || "Selected from the requested scenario." }]
    : changes;
  return requested.flatMap((change) => {
    const lever = available.get(change.lever_id);
    if (!lever) return [];
    let value = change.new_value;
    const magnitude = route.slots.magnitude;
    if (magnitude && (magnitude.unit === "days" || magnitude.unit === "number") && directTopic === change.lever_id) {
      if (magnitude.mode === "to" || route.slots.direction === "target") value = magnitude.value;
      else if (route.slots.direction === "decrease") value = lever.value - magnitude.value;
      else if (route.slots.direction === "increase") value = lever.value + magnitude.value;
    } else if (magnitude?.unit === "percent" && magnitude.mode === "by" && directTopic === change.lever_id) {
      if (route.slots.direction === "decrease") value = lever.value * (1 - magnitude.value / 100);
      else if (route.slots.direction === "increase") value = lever.value * (1 + magnitude.value / 100);
    }
    const step = lever.step > 0 ? lever.step : 1;
    const digits = Math.max(0, Math.min(6, (String(step).split(".")[1] || "").length));
    const clamped = Math.max(lever.min, Math.min(lever.max, value));
    return [{ ...change, new_value: Number((Math.round(clamped / step) * step).toFixed(digits)) }];
  });
}

export function routeQuestion(question: string): AssistantRoute {
  const hay = padded(question);
  const matched: string[] = [];

  const topics: AssistantTopic[] = [];
  (Object.keys(TOPIC_PHRASES) as AssistantTopic[]).forEach((topic) => {
    const phrase = TOPIC_PHRASES[topic].find((candidate) => matchStem(hay, candidate));
    if (phrase) { topics.push(topic); matched.push(`topic:${topic}=${phrase}`); }
  });

  const requestedOutputs: Array<keyof AssistantOutputs> = [];
  let metric: keyof AssistantOutputs | null = null;
  METRIC_PHRASES.forEach(([output, phrases]) => {
    const phrase = phrases.find((candidate) => matchStem(hay, candidate));
    if (!phrase) return;
    if (!metric) metric = output;
    if (!requestedOutputs.includes(output)) requestedOutputs.push(output);
    matched.push(`metric:${output}=${phrase}`);
  });

  const scenarioWord = SCENARIO_WORDS.find((word) => matchStem(hay, word));
  const scenario = Boolean(scenarioWord);
  if (scenarioWord) matched.push(`scenario:${scenarioWord}`);

  const dayTopic = topics.some((topic) => topic === "dso" || topic === "dpo" || topic === "dio");
  let direction: Direction | null = null;
  if (/\b(target|get (us )?to|reach|hit|aim for|achieve|so (that )?we have|in order to)\b/i.test(question)) direction = "target";
  else if (dayTopic && /\b(faster|sooner|quicker|speed up|accelerate|bring forward|pull forward|earlier)\b/i.test(question)) direction = "decrease";
  else if (dayTopic && /\b(slower|later|delay|defer|push back|stretch|postpone|hold off)\b/i.test(question)) direction = "increase";
  else if (/\b(increase|raise|grow|higher|more|boost|expand|ramp|scale up|bump|extend|lengthen)\b/i.test(question)) direction = "increase";
  else if (/\b(decrease|reduce|lower|cut|less|shrink|drop|trim|slash|tighten|scale back|shorten|minimi[sz]e)\b/i.test(question)) direction = "decrease";
  if (direction) matched.push(`direction:${direction}`);

  const magnitude = parseMagnitude(question);
  if (magnitude) matched.push(`magnitude:${magnitude.mode}:${magnitude.value}${magnitude.unit}`);

  const broad = /\b(what should|which lever|which driver|what can i do|how (can|do) (i|we)|best way|ways? to|options? to)\b/i.test(question) || (scenario && !topics.length);

  const outOfScope = !topics.length && !metric && !scenario && /\b(legal advice|tax advice|who are you|tell me a joke|the weather|your name)\b/i.test(question);
  const slotsIntent: RouteSlots["intent"] = outOfScope ? "out_of_scope" : scenario ? "scenario" : "explain";

  const slots: RouteSlots = { intent: slotsIntent, topics: [...new Set(topics)], metric, direction, magnitude, entity: null };

  // Which slots still need a question before a scenario is well specified.
  // Broad "what should I do" scenarios only need a metric to measure; specific
  // ones ("reduce DSO") need a direction and a magnitude too.
  const missing: RouteGap[] = [];
  if (slotsIntent === "scenario") {
    if (!metric) missing.push("metric");
    if (!broad) {
      if (!topics.length) missing.push("topic");
      if (!direction && !magnitude) missing.push("direction");
      if (!magnitude && direction !== "target") missing.push("magnitude");
    }
  }

  let confidence = 0.25;
  if (topics.length) confidence += 0.3;
  if (metric) confidence += 0.2;
  if (direction) confidence += 0.12;
  if (magnitude) confidence += 0.13;
  if (slotsIntent === "out_of_scope") confidence = 0.9;
  confidence = Math.min(1, Number(confidence.toFixed(2)));

  return {
    intent: scenario ? "scenario" : "explain",
    topics: [...new Set(topics)],
    requested_outputs: [...new Set(requestedOutputs)],
    broad_lever_search: broad,
    slots, missing, confidence, matched,
  };
}

export function clarificationFor(route: AssistantRoute): AssistantClarification | null {
  if (route.slots.intent !== "scenario" || route.slots.metric) return null;
  return {
    question: "What result do you want to measure for this scenario?",
    options: [
      { label: "Runway", value: "runway_months" },
      { label: "Closing cash", value: "closing_cash" },
      { label: "Operating cash flow", value: "operating_cash_flow" },
      { label: "Cash conversion cycle", value: "cash_conversion_cycle_days" },
    ],
  };
}

export function addClarification(question: string, output: keyof AssistantOutputs) {
  const labels: Partial<Record<keyof AssistantOutputs,string>> = {
    runway_months: "runway", closing_cash: "closing cash", operating_cash_flow: "operating cash flow",
    cash_conversion_cycle_days: "cash conversion cycle", net_cash_movement: "net cash movement",
  };
  return `${question}\nMeasure the scenario's impact on ${labels[output] || output}.`;
}

const LINE_PATTERNS: Record<AssistantTopic, RegExp> = {
  dso: /dso|debtor|receiv|collection|customer|invoice/i,
  dpo: /dpo|creditor|payable|supplier|vendor|payments? made/i,
  dio: /dio|inventory|stock/i,
  cash: /cash|collection|supplier payment|payroll|tax|capex|interest|principal|funding/i,
  runway: /ending cash|closing cash|net cash|cash movement|burn/i,
  ccc: /dso|dpo|dio|receiv|payable|inventory/i,
  debt: /debt|loan|borrow|interest|principal|revolver/i,
  capex: /capex|capital expenditure|acquisition/i,
  people: /hiring|headcount|payroll|salary|bonus|people/i,
  revenue: /revenue|sales|subscription|price|volume|retention|churn|collection/i,
};

function relevantLevers(state: AssistantEngineState, route: AssistantRoute) {
  if (route.broad_lever_search || !route.topics.length) return state.available_levers.slice(0, 16);
  const direct = new Set(route.topics.filter((topic) => ["dso","dpo","dio"].includes(topic)));
  return state.available_levers.filter((lever) => {
    if (direct.has(lever.id as AssistantTopic)) return true;
    const text = `${lever.id} ${lever.name} ${lever.business_effect}`;
    return route.topics.some((topic) => LINE_PATTERNS[topic].test(text));
  }).slice(0, 12);
}

export function compactModelState(state: AssistantEngineState, route: AssistantRoute) {
  const patterns = route.topics.map((topic) => LINE_PATTERNS[topic]);
  const relevantRows = state.computed_model_lines
    .filter((row) => !patterns.length || patterns.some((pattern) => pattern.test(`${row.label} ${row.section}`)))
    .slice(0, 12)
    .map((row) => {
      const values = row.values.filter(Number.isFinite), total = values.reduce((sum, value) => sum + value, 0);
      return { label: row.label.slice(0,140), section: row.section.slice(0,140), latest: values.at(-1) ?? null, period_total: total, period_average: values.length ? total / values.length : null };
    });
  const driverKeys = route.topics.includes("ccc") || route.broad_lever_search || !route.topics.length
    ? ["dso","dpo","dio"] : route.topics.filter((topic) => ["dso","dpo","dio"].includes(topic));
  return {
    route: {
      intent: route.intent,
      topics: route.topics,
      requested_outputs: route.requested_outputs,
      broad_lever_search: route.broad_lever_search,
      direction: route.slots.direction,
      magnitude: route.slots.magnitude,
      metric: route.slots.metric,
    },
    model: state.model,
    period: state.period,
    current_drivers: Object.fromEntries(driverKeys.map((key) => [key,state.inputs.built_in_drivers[key]])),
    computed_outputs: state.computed_outputs,
    relevant_levers: relevantLevers(state,route).map((lever) => ({...lever,name:lever.name.slice(0,120),unit:lever.unit.slice(0,40),business_effect:lever.business_effect.slice(0,180)})),
    cash_bridge: (route.topics.some((topic) => topic === "cash" || topic === "runway") || route.broad_lever_search || !route.topics.length) ? state.cash_bridge_ranked.slice(0, 6).map((item)=>({...item,component:item.component.slice(0,120)})) : [],
    relevant_model_lines: relevantRows,
  };
}

const SYSTEM_PROMPT = `You are the cash-and-runway assistant embedded inside Niche Numbers Treasury, a liquidity scenario tool used by an early-stage startup founder.

You receive a small, relevant snapshot selected by the app's deterministic router. Always ground your answer in that snapshot. Never invent, estimate, extrapolate, or calculate a financial result yourself.

The route describes the user's intent, topics and requested outputs. The exact levers you may use are supplied in current_state.relevant_levers. You may only use lever IDs present there. Prefer mapped levers. If the requested business factor has no relevant lever, say that it must be added or mapped.

For an understanding question, answer briefly from current_state. Whenever you need to show a number, use a placeholder whose name exactly matches a numeric field in current_state.computed_outputs or current_state.current_drivers, for example {{runway_months}}, {{closing_cash}}, {{dso}}, {{dpo}}, or {{dio}}. Do not type numeric results directly.

For a scenario question, act only as a scenario translator: propose one concrete set of lever changes. Return exact new lever values, not deltas. Do not predict the resulting cash, runway, OCF, or CCC. The Niche Numbers scenario tool will apply the changes once and recompute once. Explain why the selected levers fit the request and give realistic business actions, but use no numeric digits in narrative fields. When current_state.route.magnitude gives an explicit target or change and current_state.route.direction gives a direction, honour them exactly when choosing the new lever value.

If the requested business factor does not have an available lever, do not substitute an unrelated lever. If the question is outside the model, such as legal or tax advice, say so briefly.

Return only one JSON object with this exact shape:
{"mode":"explain|scenario|out_of_scope","answer":"short plain-language answer","changes":[{"lever_id":"exact available id","new_value":0,"reason":"plain-language reason with no numeric digits"}],"business_actions":["short action with no numeric digits"]}

For explain or out_of_scope, changes must be empty. Never wrap the JSON in markdown.`;

export function parseGroqReply(raw: string, available: Set<string>): AssistantReply {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("The AI returned an unreadable response. Try asking the question again."); }
  if (!value || typeof value !== "object") throw new Error("The AI returned an invalid response.");
  const object = value as Record<string, unknown>;
  const mode = object.mode;
  if (mode !== "explain" && mode !== "scenario" && mode !== "out_of_scope") throw new Error("The AI returned an unsupported response type.");
  const answer = typeof object.answer === "string" ? object.answer.trim() : "";
  const businessActions = Array.isArray(object.business_actions) ? object.business_actions.filter((item): item is string => typeof item === "string").slice(0, 4) : [];
  const rawChanges = Array.isArray(object.changes) ? object.changes : [];
  const changes = rawChanges.map((item) => {
    if (!item || typeof item !== "object") throw new Error("The AI returned an invalid lever change.");
    const change = item as Record<string, unknown>, leverId = String(change.lever_id || ""), newValue = Number(change.new_value);
    if (!available.has(leverId)) throw new Error(`The AI tried to use an unavailable lever: ${leverId || "unknown"}.`);
    if (!Number.isFinite(newValue)) throw new Error(`The AI returned an invalid value for ${leverId}.`);
    return { lever_id: leverId, new_value: newValue, reason: typeof change.reason === "string" ? change.reason.trim() : "" };
  }).slice(0, 8);
  if (mode !== "scenario" && changes.length) throw new Error("The AI attempted to change levers for a non-scenario answer.");
  if (mode === "scenario" && !changes.length) return { mode: "explain", answer: answer || "That scenario needs a lever that is not available in the model yet.", changes: [], business_actions: businessActions };
  const hasUnsafeNumber = (text: string) => /\d/.test(text.replace(/\{\{[a-z_]+\}\}/g, ""));
  const safeAnswer = hasUnsafeNumber(answer) ? "I used only the model facts and levers shown in the engine result." : answer;
  const safeChanges = changes.map((change) => ({...change,reason:hasUnsafeNumber(change.reason)?"Selected to match the requested scenario.":change.reason}));
  const safeActions = businessActions.filter((action) => !hasUnsafeNumber(action));
  return { mode, answer: safeAnswer, changes: safeChanges, business_actions: safeActions };
}

export function buildGroqRequest(question: string, state: AssistantEngineState, conversation: Array<{ role: "user" | "assistant"; content: string }> = [], route = routeQuestion(question)) {
  const compactState = compactModelState(state,route);
  return {
    model: GROQ_MODEL,
    temperature: 0.1,
    max_tokens: 500,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `CURRENT_MODEL_SNAPSHOT\n${JSON.stringify(compactState)}\n\nRECENT_CONTEXT\n${JSON.stringify(conversation.slice(-2).map((message) => ({...message,content:message.content.slice(0,600)})))}\n\nQUESTION\n${question.slice(0,1200)}` },
    ],
  };
}

export async function askGroq(apiKey: string, question: string, state: AssistantEngineState, conversation: Array<{ role: "user" | "assistant"; content: string }> = [], route = routeQuestion(question)) {
  if (!apiKey.trim()) throw new Error("Paste your Groq API key first.");
  const request = buildGroqRequest(question,state,conversation,route);
  const response = await fetch(GROQ_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey.trim()}` },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("Groq rejected the API key. Check the key and try again.");
    if (response.status === 413) throw new Error("The model summary was still too large. Shorten the selected period and try again.");
    if (response.status === 429) throw new Error("Groq's free limit has been reached. Wait a little and try again.");
    throw new Error(`Groq returned an error (${response.status}).`);
  }
  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("Groq returned an empty response.");
  return parseGroqReply(content, new Set(compactModelState(state,route).relevant_levers.map((lever) => lever.id)));
}

export function groundedText(text: string, state: AssistantEngineState) {
  const metrics: Record<string, number | null> = {
    ...state.computed_outputs,
    ...state.inputs.built_in_drivers,
    opening_cash: state.inputs.opening_cash,
  };
  return text.replace(/\{\{([a-z_]+)\}\}/g, (_, key: string) => {
    const value = metrics[key];
    if (value === null || value === undefined) return "not available in the model";
    if (key.includes("runway")) return value >= 99 ? "cash-generative" : `${value.toFixed(1)} months`;
    if (key.includes("days") || key === "dso" || key === "dpo" || key === "dio") return `${value.toFixed(1)} days`;
    return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  });
}
