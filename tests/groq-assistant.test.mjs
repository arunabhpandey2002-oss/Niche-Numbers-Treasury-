import assert from "node:assert/strict";
import test from "node:test";

import { GROQ_MODEL, addClarification, buildGroqRequest, clarificationFor, compactModelState, groundedText, parseGroqReply, routeQuestion } from "../lib/groq-assistant.ts";

const fullState = {
  model: { name: "Test model", mode: "connected_workbook", entity: "Group", unit: "INR" },
  period: { from: "Apr 26", to: "Mar 27" },
  inputs: { opening_cash: 100, built_in_drivers: { dso: 45, dpo: 30, dio: 20 }, source_series: { revenue: Array(120).fill(100) } },
  available_levers: [
    { id: "dso", name: "DSO", kind: "working_capital", value: 45, base: 45, min: 0, max: 180, step: 1, unit: "days", mapped: true, business_effect: "Lower values collect customer cash sooner." },
    { id: "capex_extra", name: "Additional capex", kind: "custom", value: 0, base: 0, min: 0, max: 10, step: .1, unit: "cash", mapped: true, business_effect: "Higher values use cash." },
  ],
  computed_outputs: { closing_cash: 80, runway_months: 8, monthly_burn_rate: 10, operating_cash_flow: 5, net_cash_movement: -2, cash_conversion_cycle_days: 35, working_capital_cash_impact: 0, custom_lever_cash_impact: 0, total_cash_impact: 0 },
  cash_bridge_components: Object.fromEntries(Array.from({length:100},(_,index)=>[`line_${index}`,index])),
  cash_bridge_ranked: Array.from({length:100},(_,index)=>({component:`line_${index}`,amount:index,direction:"inflow"})),
  computed_model_lines: Array.from({length:5000},(_,index)=>({label:index%2?`Revenue ${index}`:`Receivables ${index}`,section:"Schedule",values:Array(120).fill(index)})),
};

test("keeps the Groq model in one exported constant", () => {
  assert.equal(GROQ_MODEL, "openai/gpt-oss-120b");
});

test("accepts only available lever IDs", () => {
  const reply = parseGroqReply(JSON.stringify({ mode: "scenario", answer: "Test faster collections.", changes: [{ lever_id: "dso", new_value: 35, reason: "Collect customer cash sooner." }], business_actions: ["Tighten follow-up before invoices fall due."] }), new Set(["dso"]));
  assert.deepEqual(reply.changes.map((change) => change.lever_id), ["dso"]);
  assert.throws(() => parseGroqReply(JSON.stringify({ mode: "scenario", answer: "Test hiring.", changes: [{ lever_id: "hiring", new_value: 10, reason: "Change hiring." }], business_actions: [] }), new Set(["dso"])), /unavailable lever/);
});

test("removes unverified numbers from AI narrative without spending a retry", () => {
  const reply = parseGroqReply(JSON.stringify({ mode: "explain", answer: "Runway is 12 months.", changes: [], business_actions: [] }), new Set(["dso"]));
  assert.ok(!/\d/.test(reply.answer));
});

test("renders financial numbers only from engine state placeholders", () => {
  const state = { computed_outputs: { runway_months: 8.25 }, inputs: { built_in_drivers: {}, opening_cash: 4 } };
  assert.equal(groundedText("Runway is {{runway_months}}.", state), "Runway is 8.3 months.");
});

test("routes customer payment-time questions to DSO without clarification", () => {
  const route = routeQuestion("How much time on average are my customers taking before paying me?");
  assert.equal(route.intent,"explain");
  assert.ok(route.topics.includes("dso"));
  assert.equal(clarificationFor(route),null);
  const compact = compactModelState(fullState,route);
  assert.deepEqual(compact.current_drivers,{dso:45});
  assert.deepEqual(compact.relevant_levers.map((lever)=>lever.id),["dso"]);
});

test("asks a free local clarification before an ambiguous scenario", () => {
  const route = routeQuestion("What happens if customers pay later?");
  assert.equal(route.intent,"scenario");
  assert.equal(route.requested_outputs.length,0);
  assert.ok(clarificationFor(route));
  const completed = routeQuestion(addClarification("What happens if customers pay later?","runway_months"));
  assert.deepEqual(completed.requested_outputs,["runway_months"]);
});

test("keeps Groq requests compact even when the workbook is very large", () => {
  const request = buildGroqRequest("What are the biggest drivers of my cash?",fullState,Array(20).fill({role:"user",content:"x".repeat(5000)}));
  const json = JSON.stringify(request);
  assert.ok(Buffer.byteLength(json,"utf8") < 50000);
  assert.ok(!json.includes("source_series"));
  assert.ok(!json.includes("computed_model_lines"));
});
