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
export type AssistantRoute = {
  intent: "explain" | "scenario";
  topics: AssistantTopic[];
  requested_outputs: Array<keyof AssistantOutputs>;
  broad_lever_search: boolean;
};

export type AssistantClarification = {
  question: string;
  options: Array<{ label: string; value: keyof AssistantOutputs }>;
};

const TOPIC_RULES: Array<[AssistantTopic, RegExp]> = [
  ["dso", /\bdso\b|debtor|receiv|customer.{0,24}(pay|term)|collect|invoice/i],
  ["dpo", /\bdpo\b|creditor|payable|supplier|vendor|payment terms?/i],
  ["dio", /\bdio\b|inventory|stock days?|stock holding/i],
  ["ccc", /cash conversion cycle|\bccc\b|working capital cycle/i],
  ["runway", /runway|months? of cash|cash lasts?/i],
  ["debt", /debt|loan|borrow|interest|principal|revolver/i],
  ["capex", /capex|capital expenditure|equipment purchase/i],
  ["people", /hiring|hire|headcount|payroll|salary|salaries|people cost/i],
  ["revenue", /revenue|sales|subscription|price|volume|retention|churn/i],
  ["cash", /cash flow|cash position|cash balance|closing cash|liquidity|cash/i],
];

export function routeQuestion(question: string): AssistantRoute {
  const topics = TOPIC_RULES.filter(([, pattern]) => pattern.test(question)).map(([topic]) => topic);
  const scenario = /\bif\b|what happens|what should|scenario|increase|decrease|reduce|extend|improve|change|higher|lower|pull.{0,12}(forward|back)|delay|accelerate|offer.{0,16}discount/i.test(question);
  const requestedOutputs: Array<keyof AssistantOutputs> = [];
  if (/runway|months? of cash|cash lasts?/i.test(question)) requestedOutputs.push("runway_months");
  if (/closing cash|cash position|cash balance/i.test(question)) requestedOutputs.push("closing_cash");
  if (/operating cash flow|\bocf\b/i.test(question)) requestedOutputs.push("operating_cash_flow");
  else if (/cash flow|net cash|cash movement/i.test(question)) requestedOutputs.push("net_cash_movement");
  if (/cash conversion cycle|\bccc\b/i.test(question)) requestedOutputs.push("cash_conversion_cycle_days");
  return {
    intent: scenario ? "scenario" : "explain",
    topics: [...new Set(topics)],
    requested_outputs: [...new Set(requestedOutputs)],
    broad_lever_search: /what should|which lever|which driver|how (can|do) i|extend runway|improve (cash|runway)/i.test(question),
  };
}

export function clarificationFor(route: AssistantRoute): AssistantClarification | null {
  if (route.intent !== "scenario" || route.requested_outputs.length) return null;
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
    route,
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

For a scenario question, act only as a scenario translator: propose one concrete set of lever changes. Return exact new lever values, not deltas. Do not predict the resulting cash, runway, OCF, or CCC. The Niche Numbers scenario tool will apply the changes once and recompute once. Explain why the selected levers fit the request and give realistic business actions, but use no numeric digits in narrative fields.

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
