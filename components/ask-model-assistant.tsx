"use client";

import { useState } from "react";
import { Bot, KeyRound, RotateCcw, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addClarification, askGroq, clarificationFor, groundedText, resolveScenarioChanges, routeQuestion } from "@/lib/groq-assistant";
import type { AssistantChange, AssistantClarification, AssistantEngineState, AssistantOutputs } from "@/lib/groq-assistant";

export type EngineComparison = {
  before: AssistantOutputs;
  after: AssistantOutputs;
  applied: Array<{ id: string; name: string; from: number; to: number; reason: string }>;
};

type Message = { role: "user" | "assistant"; content: string };
type PendingClarification = { original: string; prompt: AssistantClarification };

const examples = [
  "What are the biggest drivers of my cash?",
  "What should I change to extend runway?",
  "What is my cash conversion cycle telling me?",
];

function outputText(key: keyof AssistantOutputs, value: number | null) {
  if (value === null) return "Not available";
  if (key === "runway_months") return value >= 99 ? "Cash-generative" : `${value.toFixed(1)} mo`;
  if (key === "cash_conversion_cycle_days") return `${value.toFixed(1)} days`;
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function AskModelAssistant({ state, onApply, onWriteBack, onReset, canReset }: {
  state: AssistantEngineState;
  onApply: (changes: AssistantChange[]) => EngineComparison;
  onWriteBack?: () => Promise<AssistantOutputs | null>;
  onReset: () => void;
  canReset: boolean;
}) {
  const [apiKey,setApiKey]=useState(""), [question,setQuestion]=useState(""), [messages,setMessages]=useState<Message[]>([]);
  const [comparison,setComparison]=useState<EngineComparison|null>(null), [error,setError]=useState(""), [busy,setBusy]=useState(false), [pending,setPending]=useState<PendingClarification|null>(null);
  const [writeBackPending,setWriteBackPending]=useState(false);

  async function submit(prompt = question, selectedOutput?: keyof AssistantOutputs) {
    const clean = prompt.trim();
    if (!clean || busy) return;
    setError(""); setQuestion("");
    const nextUser = { role: "user" as const, content: clean }, history = [...messages,nextUser];
    setMessages(history);
    let routedQuestion = clean, route = routeQuestion(clean);
    if (pending) {
      const matched = selectedOutput || pending.prompt.options.find((option)=>option.label.toLowerCase()===clean.toLowerCase())?.value;
      routedQuestion = matched ? addClarification(pending.original,matched) : `${pending.original}\nThe user clarified: ${clean}`;
      route = routeQuestion(routedQuestion);
    }
    const clarification = clarificationFor(route);
    if (clarification) {
      setPending({original:pending?.original||clean,prompt:clarification});
      setMessages((current)=>[...current,{role:"assistant",content:clarification.question}]);
      return;
    }
    setPending(null); setBusy(true);
    try {
      const reply = await askGroq(apiKey,routedQuestion,state,history.slice(-2),route);
      if (reply.mode === "scenario" && reply.changes.length) {
        const resolved=resolveScenarioChanges(reply.changes,route,state);
        if(!resolved.length)throw new Error("The requested scenario does not have an available model lever.");
        const result=onApply(resolved);
        const applied=result.applied.map((lever)=>`${lever.name}: ${lever.from.toLocaleString()} → ${lever.to.toLocaleString()}`).join(" · ");
        const connected=state.model.mode==="connected_workbook";
        setComparison(connected?{...result,after:{...result.after,closing_cash:null,runway_months:null,operating_cash_flow:null}}:result);
        setWriteBackPending(connected);
        const content=connected
          ? `Prepared the model change: ${applied}. I have not estimated the resulting cash balance. Confirm write-back below and I will report only the value recalculated by Google Sheets.`
          : `Applied by the scenario engine: ${applied}. Runway: ${outputText("runway_months",result.before.runway_months)} → ${outputText("runway_months",result.after.runway_months)}. Closing cash: ${outputText("closing_cash",result.before.closing_cash)} → ${outputText("closing_cash",result.after.closing_cash)}.`;
        setMessages((current)=>[...current,{role:"assistant",content}]);
      } else {
        const grounded = groundedText(reply.answer,state);
        const actions = reply.business_actions.length ? `\n\nPractical actions:\n${reply.business_actions.map((action)=>`• ${action}`).join("\n")}` : "";
        setMessages((current)=>[...current,{role:"assistant",content:`${grounded}${actions}`}]);
      }
    } catch (cause) {
      const text = cause instanceof TypeError ? "The browser could not reach Groq. The request may be blocked by the browser or network." : cause instanceof Error ? cause.message : "The AI call failed.";
      setError(text);
    } finally { setBusy(false); }
  }

  async function confirmWriteBack(){
    if(!onWriteBack||busy)return;
    setBusy(true);setError("");
    try{
      const verified=await onWriteBack();
      if(!verified)throw new Error("Google Sheets did not return a verified result.");
      setComparison((current)=>current?{...current,after:verified}:current);setWriteBackPending(false);
      setMessages((current)=>[...current,{role:"assistant",content:`Google Sheets recalculated and the model was refreshed. Verified closing cash: ${outputText("closing_cash",verified.closing_cash)}. Verified runway: ${outputText("runway_months",verified.runway_months)}.`}]);
    }catch(cause){setError(cause instanceof Error?cause.message:"Write-back failed.")}finally{setBusy(false)}
  }

  function reset() {
    onReset(); setComparison(null); setError("");
    setMessages((current)=>[...current,{role:"assistant",content:"The levers are back at the values from before the first AI scenario."}]);
  }

  const metrics: Array<[keyof AssistantOutputs,string]> = [
    ["runway_months","Runway"], ["closing_cash","Closing cash"],
    ["operating_cash_flow","Operating cash flow"], ["cash_conversion_cycle_days","Cash conversion cycle"],
  ];

  return <section className="assistant-shell">
    <div className="assistant-main panel">
      <div className="assistant-head"><div className="assistant-icon"><Bot size={20}/></div><div><p className="eyebrow">Ask the model</p><h2>Your cash-and-runway assistant</h2><p>Answers use the current model state. Scenarios move real levers once, then Niche Numbers computes the result.</p></div></div>
      <div className="api-key-box"><div><Label htmlFor="groq-key"><KeyRound size={14}/> Groq API key</Label><small>Held only in this browser tab. It is not saved.</small></div><Input id="groq-key" type="password" autoComplete="off" value={apiKey} onChange={(event)=>setApiKey(event.target.value)} placeholder="gsk_…"/></div>
      <div className="prompt-chips">{examples.map((example)=><button key={example} onClick={()=>submit(example)} disabled={busy}>{example}</button>)}</div>
      <div className="chat-window" aria-live="polite">{messages.length?messages.map((message,index)=><div key={`${message.role}-${index}`} className={`chat-message ${message.role}`}><b>{message.role==="user"?"You":"Ask the model"}</b><p>{message.content}</p></div>):<div className="assistant-empty"><Sparkles size={18}/><strong>Ask about cash, runway, working capital or a scenario.</strong><span>The app selects only the relevant model facts before asking Groq.</span></div>}</div>
      {pending&&<div className="clarification-options"><span>No AI attempt used yet</span>{pending.prompt.options.map((option)=><button key={option.value} onClick={()=>submit(option.label,option.value)} disabled={busy}>{option.label}</button>)}</div>}
      {writeBackPending&&<div className="clarification-options"><span>This will change the mapped Google Sheets assumptions</span><button onClick={confirmWriteBack} disabled={busy||!onWriteBack}>{busy?"Writing and refreshing…":"Confirm write-back"}</button></div>}
      {error&&<div className="assistant-error" role="alert">{error}</div>}
      <div className="assistant-compose"><Textarea value={question} onChange={(event)=>setQuestion(event.target.value)} onKeyDown={(event)=>{if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();submit()}}} placeholder="Ask a question about the current model…" aria-label="Ask the model"/><Button onClick={()=>submit()} disabled={busy||!question.trim()}><Send size={15}/>{busy?"Thinking…":"Ask"}</Button></div>
    </div>
    <aside className="assistant-results panel">
      <div className="panel-head"><div><p className="eyebrow">Engine result</p><h2>{comparison?"Scenario applied":"Current model"}</h2><p>These figures come from Niche Numbers, not the AI.</p></div>{canReset&&<Button variant="outline" size="sm" onClick={reset}><RotateCcw size={14}/> Reset AI scenario</Button>}</div>
      <div className="assistant-output-grid">{metrics.map(([key,label])=>{const before=comparison?.before[key]??state.computed_outputs[key],after=comparison?.after[key]??state.computed_outputs[key];return <article key={key}><span>{label}</span><div><strong>{outputText(key,before)}</strong>{comparison&&<><i>→</i><strong className={after!==before?(Number(after??0)>=Number(before??0)?"good":"bad"):""}>{outputText(key,after)}</strong></>}</div></article>})}</div>
      {comparison?<div className="applied-levers"><strong>Levers changed</strong>{comparison.applied.map((lever)=><div key={lever.id}><span>{lever.name}<small>{lever.reason}</small></span><b>{lever.from.toLocaleString()} → {lever.to.toLocaleString()}</b></div>)}</div>:<div className="assistant-state-note"><strong>{state.available_levers.length} levers available</strong><span>{state.model.name} · {state.period.from} to {state.period.to}</span></div>}
    </aside>
  </section>;
}
