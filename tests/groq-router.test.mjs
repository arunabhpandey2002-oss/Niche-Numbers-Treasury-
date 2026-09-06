import assert from "node:assert/strict";
import test from "node:test";

import { routeQuestion, clarificationFor, addClarification } from "../lib/groq-assistant.ts";

test("detects topics from varied plain-language phrasing", () => {
  assert.deepEqual(routeQuestion("can we get our customers to pay faster?").topics, ["dso"]);
  assert.deepEqual(routeQuestion("what if we stretch our suppliers?").topics, ["dpo"]);
  assert.ok(routeQuestion("how much stock are we holding?").topics.includes("dio"));
  assert.ok(routeQuestion("what's my runway?").topics.includes("runway"));
  assert.ok(routeQuestion("should we take on more debt?").topics.includes("debt"));
  assert.ok(routeQuestion("can we freeze hiring?").topics.includes("people"));
});

test("separates explain questions from scenario questions", () => {
  assert.equal(routeQuestion("what is my cash conversion cycle telling me?").intent, "explain");
  assert.equal(routeQuestion("what if I reduce DSO?").intent, "scenario");
  assert.equal(routeQuestion("should I cut headcount?").intent, "scenario");
});

test("captures the target metric the user wants to measure", () => {
  assert.equal(routeQuestion("what will this do to my runway?").slots.metric, "runway_months");
  assert.equal(routeQuestion("how much closing cash will I have?").slots.metric, "closing_cash");
  assert.equal(routeQuestion("what is my cash conversion cycle?").slots.metric, "cash_conversion_cycle_days");
});

test("resolves direction, including speed words for day-based drivers", () => {
  assert.equal(routeQuestion("get customers to pay faster").slots.direction, "decrease");
  assert.equal(routeQuestion("delay paying suppliers").slots.direction, "increase");
  assert.equal(routeQuestion("reduce our capex").slots.direction, "decrease");
  assert.equal(routeQuestion("increase prices").slots.direction, "increase");
  assert.equal(routeQuestion("get us to 12 months of runway").slots.direction, "target");
});

test("parses magnitude in to / by / percent forms", () => {
  assert.deepEqual(routeQuestion("reduce DSO to 30 days").slots.magnitude, { mode: "to", value: 30, unit: "days" });
  assert.deepEqual(routeQuestion("cut DSO by 10 days").slots.magnitude, { mode: "by", value: 10, unit: "days" });
  assert.deepEqual(routeQuestion("grow revenue by 20%").slots.magnitude, { mode: "by", value: 20, unit: "percent" });
  assert.deepEqual(routeQuestion("extend runway to 12 months").slots.magnitude, { mode: "to", value: 12, unit: "months" });
  assert.equal(routeQuestion("what is my runway?").slots.magnitude, null);
});

test("reports missing slots so the clarifying step knows what to ask", () => {
  // Fully specified: nothing missing.
  assert.deepEqual(routeQuestion("reduce DSO to 30 days, what happens to runway?").missing, []);
  // Specific scenario with no target metric and no number.
  const vague = routeQuestion("what if I reduce DSO?");
  assert.ok(vague.missing.includes("metric"));
  assert.ok(vague.missing.includes("magnitude"));
  // Broad "what should I do" only needs a metric, not topic/direction/magnitude.
  const broad = routeQuestion("what should I do to extend my runway?");
  assert.equal(broad.broad_lever_search, true);
  assert.deepEqual(broad.missing, []);
  // Explain questions never demand scenario slots.
  assert.deepEqual(routeQuestion("what is my runway?").missing, []);
});

test("clarification is asked only for scenarios missing a metric", () => {
  assert.ok(clarificationFor(routeQuestion("what if I reduce DSO?")));
  assert.equal(clarificationFor(routeQuestion("what if I reduce DSO to improve runway?")), null);
  assert.equal(clarificationFor(routeQuestion("what is my runway?")), null);
});

test("answering a clarification makes the metric resolvable on re-route", () => {
  const refined = addClarification("what if I reduce DSO?", "runway_months");
  const route = routeQuestion(refined);
  assert.equal(route.slots.metric, "runway_months");
  assert.equal(clarificationFor(route), null);
});

test("keeps backward-compatible fields for existing callers", () => {
  const route = routeQuestion("what if I reduce DSO to improve runway?");
  assert.equal(route.intent, "scenario");
  assert.ok(Array.isArray(route.topics));
  assert.ok(Array.isArray(route.requested_outputs));
  assert.equal(typeof route.broad_lever_search, "boolean");
});

test("flags obvious out-of-scope questions", () => {
  assert.equal(routeQuestion("can you give me legal advice?").slots.intent, "out_of_scope");
});
