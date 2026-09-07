"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Columns3, Landmark, Link2, Plus, RefreshCw, Settings2, SlidersHorizontal, Trash2, UploadCloud, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CashFlowModule, CovenantsModule, Coverage, CustomerCollectionsModule, DebtModule, DetectedScheduleModule, LiquidityModule, SupplierPaymentsModule, WorkingCapitalModule } from "@/components/treasury-module-views";
import { SCAN_SCHEMA_VERSION, ScanResult, allEntities, cashBalanceCandidateRows, cashCandidateRows, defaultCashRoles, driverRows, parseWorkbook, paymentsForScan, selectCashBalanceRow, workingCapitalScheduleImpact, type CashRole, type CollectionRecord, type CustomCashLine, type PaymentRecord, type ScanRow } from "@/lib/treasury-model";
import { ModelMappingWorkbench } from "@/components/model-mapping-workbench";
import { MappingFallback } from "@/components/mapping-fallback";
import { CashFlowEditor } from "@/components/cash-flow-editor";
import { ScenarioLab } from "@/components/scenario-lab";
import type { ScenarioLever } from "@/components/scenario-lab";
import { emptySourceAssignments } from "@/lib/model-mapping";
import type { MappingSuggestion, SourceAssignments, SourceModuleId } from "@/lib/model-mapping";
import { AskModelAssistant } from "@/components/ask-model-assistant";
import type { EngineComparison } from "@/components/ask-model-assistant";
import type { AssistantChange, AssistantEngineState, AssistantOutputs } from "@/lib/groq-assistant";

type LineKey = "revenue" | "cogs" | "opex" | "ebitda" | "tax" | "capex" | "debt" | "financing" | "cash";
type DriverKey = "dso" | "dpo" | "dio";
type Series = Record<LineKey, number[]>;
type Mapping = Record<LineKey, string>;
type DriverMapping = Record<DriverKey, string>;
type Config = { url: string; token: string; sheetInput: string; ssid: string; treasuryTabs: string[]; availableSheets: string[]; sourceAssignments: SourceAssignments; scale: number; startMonth: string; months: number; mappings: Mapping; driverMappings: DriverMapping; cashRoles: Record<string, CashRole>; cashOpeningId: string; cashClosingId: string; customCashLines: CustomCashLine[] };
type ModelSnapshot = { cash: number | null; runway: number | null; movement: number | null };
type CashLever = { id: string; label: string; hint: string; value: number; base: number; min: number; max: number; step: number; unit: string; range: string; impact: number; builtIn?: DriverKey };

const lineMeta: { key: LineKey; label: string; required?: boolean; hint: string }[] = [
  { key: "revenue", label: "Revenue", hint: "Optional fallback for models without cash collections" },
  { key: "cogs", label: "COGS / direct costs", hint: "Optional fallback for models without supplier payments" },
  { key: "opex", label: "Operating expenses", hint: "Used if EBITDA is not mapped" },
  { key: "ebitda", label: "EBITDA", hint: "Preferred operating-profit row" },
  { key: "tax", label: "Cash tax paid", hint: "Leave blank to assume zero" },
  { key: "capex", label: "Capital expenditure", hint: "Leave blank to assume zero" },
  { key: "debt", label: "Debt service", hint: "Principal and interest cash outflow" },
  { key: "financing", label: "Financing inflows", hint: "Debt drawdown or equity raise" },
  { key: "cash", label: "Closing cash", hint: "Optional; used for reconciliation" },
];
const emptyMappings = Object.fromEntries(lineMeta.map((x) => [x.key, ""])) as Mapping;
const emptyDriverMappings: DriverMapping = { dso: "", dpo: "", dio: "" };
const defaultLevers: CashLever[] = [
  { id: "interest", label: "Interest payments", hint: "Higher interest reduces cash", value: 0.08, base: 0.08, min: 0, max: 5, step: 0.01, unit: "cash", range: "", impact: -1 },
  { id: "capex_extra", label: "Additional capex", hint: "Extra capex reduces cash", value: 0, base: 0, min: 0, max: 10, step: 0.1, unit: "cash", range: "", impact: -1 },
  { id: "financing_extra", label: "Financing inflow", hint: "New debt or equity increases cash", value: 0, base: 0, min: 0, max: 25, step: 0.1, unit: "cash", range: "", impact: 1 },
];
const emptySeries = Object.fromEntries(lineMeta.map((x) => [x.key, []])) as unknown as Series;
const demo: Series = {
  revenue: [7.8,8.1,8.5,8.9,9.4,9.8,10.2,10.7,11.1,11.6,12.1,12.7], cogs: [3.2,3.3,3.45,3.6,3.75,3.9,4.05,4.2,4.35,4.5,4.65,4.85],
  opex: [4.1,4.15,4.2,4.25,4.3,4.35,4.4,4.45,4.5,4.55,4.6,4.65], ebitda: [0.5,0.65,0.85,1.05,1.35,1.55,1.75,2.05,2.25,2.55,2.85,3.2],
  tax: [0,0,0,0.1,0,0,0.15,0,0,0.2,0,0], capex: [0.25,0.2,0.15,0.25,0.1,0.15,0.35,0.15,0.1,0.3,0.15,0.1], debt: Array(12).fill(0.08), financing: Array(12).fill(0), cash: [],
};
const defaultConfig: Config = { url: "", token: "", sheetInput: "", ssid: "", treasuryTabs: [], availableSheets: [], sourceAssignments: emptySourceAssignments, scale: 1, startMonth: "2026-01", months: 12, mappings: emptyMappings, driverMappings: emptyDriverMappings, cashRoles: {}, cashOpeningId: "", cashClosingId: "", customCashLines: [] };

function numberValue(v: unknown, scale = 1) { if (typeof v === "number") return v * scale; const n = Number(String(v ?? "").replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n * scale : 0; }
function extractSsid(input: string) { const s=String(input||"").trim(),match=s.match(/\/d\/([a-zA-Z0-9-_]+)/);if(match)return match[1];return /^[a-zA-Z0-9-_]{20,}$/.test(s)?s:""; }
function validScriptUrl(input: string) { try { const u=new URL(input.trim());return u.protocol==="https:"&&u.hostname==="script.google.com"&&/\/macros\/s\/[^/]+\/exec\/?$/.test(u.pathname) } catch { return false } }
function sheetQuery(config: Config, action: "list"|"read", ranges?: string) { const q=new URLSearchParams({action,token:config.token,ssid:config.ssid});if(ranges!==undefined)q.set("ranges",ranges);return `${config.url}${config.url.includes("?")?"&":"?"}${q.toString()}`; }
function sheetNames(body: {sheets?:unknown[]}) { return (body.sheets||[]).map((s)=>typeof s==="string"?s:(s as {name?:string}).name).filter(Boolean) as string[] }
function sheetDetails(body: {sheets?:unknown[]}) { return (body.sheets||[]).map((s)=>typeof s==="string"?{name:s,rows:500,cols:80}:{name:String((s as {name?:string}).name||""),rows:Number((s as {rows?:number}).rows)||500,cols:Number((s as {cols?:number}).cols)||80}).filter((s)=>s.name) }
function columnName(index: number) { let n=Math.max(1,index),out="";while(n){const r=(n-1)%26;out=String.fromCharCode(65+r)+out;n=Math.floor((n-1)/26)}return out }
function protectedRange(range: string, tabs: string[]) { const bang=range.lastIndexOf("!");if(bang<0){if(tabs.length!==1)return "";return `'${tabs[0].replace(/'/g,"''")}'!${range}`}const rawTab=range.slice(0,bang).trim().replace(/^'|'$/g,"").replace(/''/g,"'"),tab=tabs.find((name)=>name.toLowerCase()===rawTab.toLowerCase());return tab?`'${tab.replace(/'/g,"''")}'!${range.slice(bang+1)}`:"" }
async function sheetJson(url: string, init?: RequestInit) { try { const response=await fetch(url,{redirect:"follow",...init}),text=await response.text();let body:Record<string,unknown>;try{body=JSON.parse(text)}catch{throw new Error(response.url.includes("accounts.google.com")||/<html/i.test(text)?"Apps Script is asking for sign-in. Redeploy the web app with access set to Anyone.":"The Apps Script URL did not return JSON. Confirm that you pasted the deployed /exec URL.")}if(!response.ok)throw new Error(`Apps Script returned HTTP ${response.status}.`);return body } catch(error) { if(error instanceof TypeError)throw new Error("The browser could not reach Apps Script. Confirm the /exec URL and that deployment access is set to Anyone.");throw error } }
function flattenRange(raw: unknown): unknown[] { if (!Array.isArray(raw)) return []; if (raw.length === 1 && Array.isArray(raw[0])) return raw[0] as unknown[]; if (raw.every(Array.isArray)) return (raw as unknown[][]).map((r) => r[0]); return raw; }
function periods(start: string, count: number) { const [year, month] = start.split("-").map(Number); return Array.from({ length: count }, (_, i) => new Date(Date.UTC(year, month - 1 + i, 1)).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" })); }
function money(v: number) { const abs = Math.abs(v); const val = abs >= 1000 ? `${(abs / 1000).toFixed(1)}k` : abs.toFixed(abs >= 100 ? 0 : 1); return `${v < 0 ? "(" : ""}${val}${v < 0 ? ")" : ""}`; }
function sum(a: number[], start: number, end: number) { return a.slice(start, end + 1).reduce((s, x) => s + (x || 0), 0); }
function scanMetric(scan: ScanResult | null, entity: string, index: number, pattern: RegExp) {
  if (!scan) return null;
  const candidates = scan.rows.filter((r) => pattern.test(r.label));
  const row = candidates.find((r) => r.entity === entity) || candidates.find((r) => r.entity === "Consolidated") || candidates.find((r) => r.entity === "Group") || candidates[0];
  const value = row?.values[index];
  return Number.isFinite(value) ? value : null;
}
function unitScale(unit: string) {
  if (/crore|\bcr\b/i.test(unit)) return 1e7;
  if (/lakh|lac/i.test(unit)) return 1e5;
  if (/million|\bmn\b/i.test(unit)) return 1e6;
  if (/000s|thousand/i.test(unit)) return 1e3;
  return 1;
}
function convertedSeries(row: ScanRow | undefined, targetUnit: string, length: number) {
  if (!row) return Array(length).fill(0) as number[];
  const factor=unitScale(row.unit)/unitScale(targetUnit);
  return Array.from({length},(_,index)=>(row.values[index]||0)*factor);
}
function preferredSeries(scan: ScanResult, entity: string, patterns: RegExp[]) {
  const candidates=scan.rows.filter((row)=>patterns.some((pattern)=>pattern.test(row.label)));
  return candidates.find((row)=>row.entity===entity)||candidates.find((row)=>row.entity==="Consolidated")||candidates.find((row)=>row.entity==="Group")||candidates[0];
}
function modelSnapshot(scan: ScanResult | null, entity: string, index: number): ModelSnapshot {
  const cashRows = scan ? scan.rows.filter((row) => {
    const source = scan.sourceAssignments.cashFlow;
    const rightSheet = !source || source === "__auto__" || source === "__skip__" || row.sheet === source;
    return rightSheet && (row.entity === entity || row.entity === "Consolidated" || row.entity === "Group");
  }) : [];
  // Use the same scored cash-row selector as the direct-method waterfall. A
  // loose first regex match can pick a pre-financing checkpoint instead.
  const cashRow = selectCashBalanceRow(cashRows,"closing") || selectCashBalanceRow(scan?.rows || [],"closing");
  const cashValue = cashRow?.values[index];
  const cash = Number.isFinite(cashValue) ? Number(cashValue) : null;
  const movement = scanMetric(scan,entity,index,/net change|net cash movement|change in cash/i);
  const recent = scan ? Array.from({length:3},(_,offset)=>scanMetric(scan,entity,Math.max(0,index-offset),/net change|net cash movement|change in cash/i)).filter((v):v is number=>v!==null&&v<0) : [];
  const burn = recent.length ? Math.abs(recent.reduce((a,b)=>a+b,0)/recent.length) : 0;
  return { cash, movement, runway: cash!==null&&burn>0?Math.max(0,cash/burn):cash!==null?99:null };
}

function detectedDriverValue(scan: ScanResult, key: DriverKey, index: number, fallback: number) {
  const exact = new RegExp(`(^|[^a-z])${key}([^a-z]|$)`, "i");
  const timelineRows = scan.rows.filter((row) => row.values.length && exact.test(row.label));
  const preferredSheet = scan.sourceAssignments.workingCapital;
  const row = timelineRows.find((candidate) => candidate.sheet === preferredSheet) || timelineRows[0];
  const timelineValue = row?.values[index];
  if (Number.isFinite(timelineValue) && timelineValue !== 0) return Number(timelineValue);
  const records = key === "dso" ? (scan.collections || []) : key === "dpo" ? (scan.payments || []) : [];
  const unique = new Map<string, number>();
  records.forEach((record) => { if (record.driverCell && record.driverValue !== undefined) unique.set(record.driverCell, record.driverValue); });
  if (unique.size) return [...unique.values()].reduce((sum, value) => sum + value, 0) / unique.size;
  return fallback;
}

function portfolioDriverWrites(scan: ScanResult | null, key: DriverKey, delta: number) {
  if (!scan || !delta || key === "dio") return [] as {range:string;values:number[][]}[];
  const records = key === "dso" ? (scan.collections || []) : (scan.payments || []);
  const unique = new Map<string, number>();
  records.forEach((record) => { if (record.driverCell && record.driverValue !== undefined) unique.set(record.driverCell, record.driverValue); });
  return [...unique.entries()].map(([range, value]) => ({ range, values: [[Math.max(0, value + delta)]] }));
}

function portfolioScheduleImpact(scan: ScanResult, key: "dso"|"dpo", delta: number, index: number, targetUnit: string) {
  const records: Array<CollectionRecord|PaymentRecord> = key === "dso" ? scan.collections : paymentsForScan(scan);
  const accountName = (record: CollectionRecord|PaymentRecord) => key === "dso" ? "customer" in record ? record.customer : "" : "supplier" in record ? record.supplier : "";
  const groups = new Map<string, Array<CollectionRecord|PaymentRecord>>();
  records.filter((record)=>record.sourceKind==="account_schedule").forEach((record)=>{
    const name=accountName(record),groupKey=`${record.sheet}\u0000${name}`;
    const group=groups.get(groupKey)||[];group.push(record);groups.set(groupKey,group);
  });
  if(!groups.size)return null;
  const normalized=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]/g,"");
  let impact=0,used=0;
  groups.forEach((group)=>{
    const first=group[0],name=accountName(first),baseDays=first.driverValue;
    if(!name||!Number.isFinite(baseDays))return;
    const baseCash=Array(scan.periods.length).fill(0) as number[];
    group.forEach((record)=>{const period=record.expectedMonth||record.dueMonth,i=scan.periods.indexOf(period);if(i>=0)baseCash[i]+=Math.abs(record.amount)*(record.probability??1)});
    const rows=scan.rows.filter((row)=>row.sheet===first.sheet&&normalized(row.label)===normalized(name));
    const activityPattern=key==="dso"?/billings|sales|revenue|invoices? raised|credit sales/i:/purchases|procurement|cost of goods|cogs|supplier invoices?|materials/i;
    const closingPattern=key==="dso"?/closing receivables?|closing ar|accounts receivable/i:/closing payables?|closing ap|accounts payable/i;
    const activity=rows.find((row)=>activityPattern.test(`${row.section} ${row.label}`))?.values.map(Math.abs)||baseCash;
    const baseClosing=rows.find((row)=>closingPattern.test(`${row.section} ${row.label}`))?.values.map(Math.abs);
    const result=workingCapitalScheduleImpact({baseCash,activity,baseClosing,baseDays:Number(baseDays),scenarioDays:Math.max(0,Number(baseDays)+delta),kind:key==="dso"?"collections":"payments"});
    const factor=unitScale(first.unit)/unitScale(targetUnit);
    impact+=(result.cumulativeImpact[index]||0)*factor;used++;
  });
  return used?impact:null;
}

function normalizedRange(range: string) { return range.replace(/^'|'(?=!)/g, "").replace(/''/g, "'").toLowerCase(); }
function leverInputPattern(lever: CashLever) {
  if (lever.id === "interest") return /interest rate|borrowing rate|interest assumption|cash interest assumption/i;
  if (lever.id === "capex_extra") return /capex assumption|capital expenditure assumption|additional capex|capex plan/i;
  if (lever.id === "financing_extra") return /financing inflow|drawdown assumption|new borrowing|equity funding|capital raise/i;
  const terms=lever.label.toLowerCase().split(/[^a-z0-9]+/).filter((term)=>term.length>2&&!["cash","lever","custom","extra","additional"].includes(term));
  return terms.length?new RegExp(terms.map((term)=>term.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|"),"i"):/a^/;
}
function syncCashLevers(scan: ScanResult, levers: CashLever[]) {
  const inputs=scan.rows.filter((row)=>row.inputCell&&Number.isFinite(row.inputValue));
  return levers.map((lever)=>{
    const mapped=lever.range?inputs.find((row)=>normalizedRange(row.inputCell||"")===normalizedRange(lever.range)):undefined;
    const candidate=mapped||inputs.find((row)=>leverInputPattern(lever).test(`${row.label} ${row.section}`));
    if(!candidate?.inputCell||candidate.inputValue===undefined)return lever;
    const untouched=lever.value===lever.base;
    return {...lever,range:candidate.inputCell,base:candidate.inputValue,value:untouched?candidate.inputValue:lever.value};
  });
}

function calculate(source: Series, driver: Record<DriverKey, number>, openingCash: number) {
  const n = Math.max(1, ...Object.values(source).map((x) => x.length));
  const fill = (key: LineKey, fallback: (i: number) => number) => Array.from({ length: n }, (_, i) => source[key]?.[i] ?? fallback(i));
  const revenue = fill("revenue", () => 0), cogs = fill("cogs", (i) => revenue[i] * .4), opex = fill("opex", () => 0);
  const ebitda = fill("ebitda", (i) => revenue[i] - cogs[i] - opex[i]);
  const tax = fill("tax", () => 0), capex = fill("capex", () => 0), debt = fill("debt", () => 0), financing = fill("financing", () => 0);
  const receivables = revenue.map((x) => x * driver.dso / 30.4), payables = cogs.map((x) => x * driver.dpo / 30.4), inventory = cogs.map((x) => x * driver.dio / 30.4);
  const nwc = receivables.map((x, i) => x + inventory[i] - payables[i]), deltaNwc = nwc.map((x, i) => i ? x - nwc[i - 1] : 0);
  const ocf = ebitda.map((x, i) => x - deltaNwc[i] - tax[i]), net = ocf.map((x, i) => x - capex[i] - debt[i] + financing[i]);
  const calculatedCash: number[] = []; let running = openingCash; net.forEach((x, i) => { running += x; calculatedCash[i] = running; });
  const cash = source.cash?.length ? fill("cash", () => 0) : calculatedCash;
  const runway = cash.map((x, i) => { const burns = net.slice(Math.max(0, i - 2), i + 1).filter((v) => v < 0); const burn = burns.length ? Math.abs(burns.reduce((s, v) => s + v, 0) / burns.length) : 0; return burn ? Math.max(0, x / burn) : 99; });
  return { revenue, cogs, opex, ebitda, tax, capex, debt, financing, receivables, payables, inventory, nwc, deltaNwc, ocf, net, cash, calculatedCash, runway };
}

function Waterfall({ calc, start, end }: { calc: ReturnType<typeof calculate>; start: number; end: number }) {
  const opening = start === 0 ? calc.cash[0] - calc.net[0] : calc.cash[start - 1];
  const core = [{ name: "EBITDA", value: sum(calc.ebitda,start,end) }, { name: "Working capital", value: -sum(calc.deltaNwc,start,end) }, { name: "Tax", value: -sum(calc.tax,start,end) }, { name: "Capex", value: -sum(calc.capex,start,end) }, { name: "Debt", value: -sum(calc.debt,start,end) }, { name: "Financing", value: sum(calc.financing,start,end) }];
  const expected = opening + core.reduce((s,x) => s + x.value,0), reconciliation = calc.cash[end] - expected;
  const steps: { name: string; value: number; total?: boolean }[] = [{ name: "Opening", value: opening, total: true }, ...core, ...(Math.abs(reconciliation) > .01 ? [{ name: "Reconcile", value: reconciliation }] : []), { name: "Closing", value: calc.cash[end], total: true }];
  let running = opening; const bars = steps.map((step,i) => { if (i === 0 || step.total) return { ...step, from: 0, to: step.value }; const from = running; running += step.value; return { ...step, from, to: running }; });
  const vals = bars.flatMap((b) => [b.from,b.to,0]), lo = Math.min(...vals), hi = Math.max(...vals), span = hi-lo || 1, W=820, top=36, bottom=225, pad=28, bw=64, gap=(W-pad*2-bw*bars.length)/Math.max(1,bars.length-1), y=(v:number)=>bottom-((v-lo)/span)*(bottom-top);
  return <div className="waterfall-wrap"><svg viewBox={`0 0 ${W} 300`} role="img" aria-label="Cash flow waterfall"><line x1="20" y1={y(0)} x2={W-20} y2={y(0)} className="zero-line" />{bars.map((b,i)=>{const x=pad+i*(bw+gap),yt=y(Math.max(b.from,b.to)),yb=y(Math.min(b.from,b.to)),cls=b.total?"total":b.value>=0?"positive":"negative";return <g key={`${b.name}-${i}`}><rect x={x} y={yt} width={bw} height={Math.max(3,yb-yt)} rx="5" className={cls}/><text x={x+bw/2} y={Math.max(18,yt-8)} textAnchor="middle" className="bar-value">{money(b.value)}</text><text x={x+bw/2} y="260" textAnchor="middle" className="bar-label">{b.name}</text></g>})}</svg></div>;
}

export default function Home() {
  const scanMigration = useRef(false);
  const [config,setConfig]=useState<Config>(defaultConfig), [data,setData]=useState<Series>(demo), [connectedName,setConnectedName]=useState("");
  const [drivers,setDrivers]=useState<Record<DriverKey,number>>({dso:45,dpo:30,dio:15}), [baselineDrivers,setBaselineDrivers]=useState<Record<DriverKey,number>>({dso:45,dpo:30,dio:15});
  const [cashLevers,setCashLevers]=useState<CashLever[]>(defaultLevers);
  const [assistantOriginal,setAssistantOriginal]=useState<{drivers:Record<DriverKey,number>;cashLevers:CashLever[];baseline:string}|null>(null);
  const [openingCash,setOpeningCash]=useState(12), [start,setStart]=useState(0), [end,setEnd]=useState(11), [connectOpen,setConnectOpen]=useState(false), [writeOpen,setWriteOpen]=useState(false), [busy,setBusy]=useState(false), [scanBusy,setScanBusy]=useState(false), [message,setMessage]=useState(""), [connectionFeedback,setConnectionFeedback]=useState(""), [targetRunway,setTargetRunway]=useState("12"), [scan,setScan]=useState<ScanResult|null>(null), [selectedEntity,setSelectedEntity]=useState("Group"), [lastImpact,setLastImpact]=useState<{before:ModelSnapshot;after:ModelSnapshot}|null>(null), [hydrated,setHydrated]=useState(false);
  const labels=useMemo(()=>scan?.periods.length?scan.periods:periods(config.startMonth,config.months),[scan,config.startMonth,config.months]), calc=useMemo(()=>calculate(data,drivers,openingCash),[data,drivers,openingCash]), baseCalc=useMemo(()=>calculate(data,baselineDrivers,openingCash),[data,baselineDrivers,openingCash]), last=Math.min(end,labels.length-1), legacyLast=Math.min(last,calc.cash.length-1);

  // Hydrate the last workbook profile after client storage becomes available.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{try{const connector=JSON.parse(localStorage.getItem("nn_treasury_connector")||"{}");const ssid=String(connector.ssid||"");const profile=ssid?JSON.parse(localStorage.getItem(`nn_treasury_profile_${ssid}`)||"null"):null;const storedConfig=profile?.config||{};setConfig({...defaultConfig,...storedConfig,...connector,availableSheets:storedConfig.availableSheets||[],sourceAssignments:{...emptySourceAssignments,...storedConfig.sourceAssignments},mappings:{...emptyMappings,...storedConfig.mappings},driverMappings:{...emptyDriverMappings,...storedConfig.driverMappings},cashRoles:{...storedConfig.cashRoles},cashOpeningId:storedConfig.cashOpeningId||"",cashClosingId:storedConfig.cashClosingId||"",customCashLines:Array.isArray(storedConfig.customCashLines)?storedConfig.customCashLines:[]});if(profile?.state){const state=profile.state;if(state.data)setData(state.data);if(state.drivers){setDrivers(state.drivers);setBaselineDrivers(state.drivers)}if(Array.isArray(state.cashLevers))setCashLevers(state.cashLevers);if(Number.isFinite(state.openingCash))setOpeningCash(state.openingCash);if(state.connectedName)setConnectedName(state.connectedName)}if(profile?.scan){setScan(profile.scan);scanMigration.current=profile.scan.schemaVersion!==SCAN_SCHEMA_VERSION}}catch{}finally{setHydrated(true)}},[]);
  useEffect(()=>{if(!hydrated)return;try{localStorage.setItem("nn_treasury_connector",JSON.stringify({url:config.url,token:config.token,sheetInput:config.sheetInput,ssid:config.ssid}));if(config.ssid)localStorage.setItem(`nn_treasury_profile_${config.ssid}`,JSON.stringify({config:{...config,url:"",token:""},state:{data,drivers,cashLevers,openingCash,connectedName},scan}))}catch{}},[hydrated,config,data,drivers,cashLevers,openingCash,connectedName,scan]);

  // Existing users may have a saved scan from before supplier schedules were extracted.
  // Rebuild that profile once; current scans never trigger this effect again.
  useEffect(()=>{if(!hydrated||!scanMigration.current||!config.ssid||!config.url||!config.token)return;scanMigration.current=false;void scanModel()},[hydrated,config.ssid,config.url,config.token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep scenario levers tied to real editable input cells discovered in the current workbook.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{if(scan)setCashLevers((levers)=>syncCashLevers(scan,levers))},[scan]);

  function selectWorkbook(sheetInput:string){const ssid=extractSsid(sheetInput);if(ssid===config.ssid){setConfig((current)=>({...current,sheetInput}));return}const connector={url:config.url,token:config.token,sheetInput,ssid};let profile:null|{config?:Partial<Config>;state?:Record<string,unknown>;scan?:ScanResult}=null;try{profile=ssid?JSON.parse(localStorage.getItem(`nn_treasury_profile_${ssid}`)||"null"):null}catch{}const stored=profile?.config||{};setConfig({...defaultConfig,...stored,...connector,availableSheets:stored.availableSheets||[],sourceAssignments:{...emptySourceAssignments,...stored.sourceAssignments},mappings:{...emptyMappings,...stored.mappings},driverMappings:{...emptyDriverMappings,...stored.driverMappings},cashRoles:{...stored.cashRoles},cashOpeningId:stored.cashOpeningId||"",cashClosingId:stored.cashClosingId||"",customCashLines:Array.isArray(stored.customCashLines)?stored.customCashLines:[]});setScan(profile?.scan||null);scanMigration.current=!!profile?.scan&&profile.scan.schemaVersion!==SCAN_SCHEMA_VERSION;setConnectedName(String(profile?.state?.connectedName||""));setData((profile?.state?.data as Series)||demo);const savedDrivers=(profile?.state?.drivers as Record<DriverKey,number>)||{dso:45,dpo:30,dio:15};setDrivers(savedDrivers);setBaselineDrivers(savedDrivers);setCashLevers((profile?.state?.cashLevers as CashLever[])||defaultLevers);setOpeningCash(Number.isFinite(profile?.state?.openingCash)?Number(profile?.state?.openingCash):12);setSelectedEntity("Group");setLastImpact(null);setAssistantOriginal(null);setConnectionFeedback("");setMessage(ssid?"New workbook selected. Its mappings are isolated from every other model.":"")}
  function changeSource(module:SourceModuleId,sheet:string){setConfig((current)=>({...current,sourceAssignments:{...current.sourceAssignments,[module]:sheet}}));setScan(null);setLastImpact(null);setMessage("Source selection changed. Scan the workbook to rebuild its mapping.")}
  function changeMapping(id:string,patch:Partial<MappingSuggestion>){setScan((current)=>current?{...current,mappings:current.mappings.map((mapping)=>mapping.id===id?{...mapping,...patch}:mapping)}:current)}

  async function testConnection(){if(!config.ssid||!config.token){setConnectionFeedback("Add a valid Sheet URL and token first.");return}if(!validScriptUrl(config.url)){setConnectionFeedback("Paste the deployed Apps Script web app URL ending in /exec.");return}setBusy(true);setConnectionFeedback("Checking workbook access…");try{const body=await sheetJson(sheetQuery(config,"list"));if(body.ok!==true)throw new Error(String(body.error||"The token or workbook was rejected."));const names=sheetNames(body as {sheets?:unknown[]});if(!names.length)throw new Error("The workbook connected, but no sheets were returned.");setConfig((c)=>({...c,availableSheets:names}));setConnectedName(String(body.spreadsheet||"Connected model"));setConnectionFeedback(`Connected to “${String(body.spreadsheet||"your workbook")}” · ${names.length} sheets available for modular mapping.`)}catch(error){setConnectionFeedback(error instanceof Error?error.message:"Could not connect")}finally{setBusy(false)}}
  async function scanModel(closeWhenDone=false, scenarioBefore?:ModelSnapshot){if(!config.url||!config.token||!config.ssid){setMessage("Add the target Sheet URL, Apps Script URL and token before scanning.");setConnectOpen(true);return}if(!validScriptUrl(config.url)){setConnectionFeedback("Paste the deployed Apps Script web app URL ending in /exec.");setConnectOpen(true);return}setScanBusy(true);setMessage(scenarioBefore?"Google Sheets is recalculating. Reading the scenario results…":"Reading workbook structure and matching treasury lines…");try{const list=await sheetJson(sheetQuery(config,"list"));if(list.ok!==true)throw new Error(String(list.error||"Could not list model tabs"));const details=sheetDetails(list as {sheets?:unknown[]}),allNames=details.map((sheet)=>sheet.name);if(!allNames.length)throw new Error("No sheets were returned by the workbook.");const explicit=new Set(Object.values(config.sourceAssignments).filter((sheet)=>sheet!=="__auto__"&&sheet!=="__skip__"));const hasAutomatic=Object.values(config.sourceAssignments).some((sheet)=>sheet==="__auto__");const targets=hasAutomatic?allNames:allNames.filter((name)=>explicit.has(name));if(!targets.length)throw new Error("Every module is marked unavailable. Enable at least one module before scanning.");const tabs:{name:string;values:unknown[][]}[]=[];for(const target of targets){const detail=details.find((sheet)=>sheet.name===target),lastColumn=columnName(Math.min(Math.max(detail?.cols||40,20),160)),lastRow=Math.min(Math.max(detail?.rows||120,80),1000),range=`'${target.replace(/'/g,"''")}'!A1:${lastColumn}${lastRow}`,body=await sheetJson(sheetQuery(config,"read",range));if(body.ok===true){const values=(body.values as Record<string,unknown[][]>|undefined)?.[range]||Object.values((body.values as Record<string,unknown[][]>|undefined)||{})[0]||[];tabs.push({name:target,values})}}if(!tabs.length)throw new Error("The workbook sheets were found but could not be read.");const result=parseWorkbook(String(list.spreadsheet||connectedName||"Connected model"),tabs,config.sourceAssignments);setScan(result);setConnectedName(result.workbook);const resultLast=Math.max(0,result.periods.length-1);setEnd(resultLast);if(scenarioBefore)setLastImpact({before:scenarioBefore,after:modelSnapshot(result,selectedEntity,resultLast)});const discovered=driverRows(result),nextMap={...config.driverMappings},nextDrivers={...drivers};(["dso","dpo","dio"] as DriverKey[]).forEach((key)=>{const row=discovered.find((candidate)=>candidate.label.toLowerCase().includes(key));const portfolioMapping=result.mappings.find((mapping)=>mapping.accepted&&mapping.writable&&mapping.metric===(key==="dso"?"customer_dso":key==="dpo"?"supplier_dpo":"dio"));if(row?.inputCell)nextMap[key]=row.inputCell;else if(portfolioMapping)nextMap[key]=portfolioMapping.range;nextDrivers[key]=detectedDriverValue(result,key,resultLast,row?.inputValue??nextDrivers[key])});const cashAssumptions=result.sourceAssignments.assumptions;const seededCashRoles=Object.keys(config.cashRoles||{}).length?config.cashRoles:defaultCashRoles(result.rows,cashAssumptions);const seededOpening=config.cashOpeningId||result.rows.find((r)=>/beginning cash|opening cash|opening balance|cash at (?:the )?start|cash brought forward/i.test(r.label))?.id||"";const seededClosing=config.cashClosingId||result.rows.find((r)=>/ending cash|closing cash|closing balance|cash at (?:the )?end|cash carried forward/i.test(r.label))?.id||"";setConfig((c)=>({...c,availableSheets:allNames,treasuryTabs:result.sheets,driverMappings:nextMap,cashRoles:seededCashRoles,cashOpeningId:seededOpening,cashClosingId:seededClosing}));setDrivers(nextDrivers);setBaselineDrivers(nextDrivers);setConnectionFeedback(`Connected to “${result.workbook}” · ${result.sheets.length} selected source sheets mapped.`);const review=result.mappings.filter((mapping)=>mapping.confidence<75).length;setMessage(scenarioBefore?"Scenario applied. The refreshed figures below are calculated by Google Sheets.":`Scan complete: ${result.mappings.length} mappings found${review?` · ${review} need review`:" · all high-confidence mappings accepted"}.`);if(closeWhenDone)setConnectOpen(false)}catch(error){const text=error instanceof Error?error.message:"Model scan failed";setMessage(text);setConnectionFeedback(text);setConnectOpen(true)}finally{setScanBusy(false)}}
  async function refreshModel(){const mapped=[...lineMeta.map((x)=>config.mappings[x.key]),...Object.values(config.driverMappings)].filter(Boolean);if(!config.url||!config.token||!config.ssid||!mapped.length){setMessage("Connect the target sheet and map at least one line first.");setConnectOpen(true);return}setBusy(true);setMessage("Reading mapped cells only from detected treasury schedules…");try{const protectedMapped=mapped.map((range)=>protectedRange(range,config.treasuryTabs)).filter(Boolean);if(!protectedMapped.length)throw new Error(`Mappings must identify one of the detected tabs: ${config.treasuryTabs.join(", ")}.`);const unique=[...new Set(protectedMapped)],body=await sheetJson(sheetQuery(config,"read",unique.join("|")));if(body.ok!==true)throw new Error(String(body.error||"Read failed"));const values=(body.values as Record<string,unknown>|undefined)||{};const next={...emptySeries} as Series;lineMeta.forEach(({key})=>{const original=config.mappings[key],range=original?protectedRange(original,config.treasuryTabs):"";next[key]=range?flattenRange(values[range]).slice(0,config.months).map((x)=>numberValue(x,config.scale)):[]});const nextDrivers={...drivers};(Object.keys(config.driverMappings) as DriverKey[]).forEach((key)=>{const original=config.driverMappings[key],range=original?protectedRange(original,config.treasuryTabs):"";if(range){const value=flattenRange(values[range])[0];if(value!==undefined&&value!=="")nextDrivers[key]=numberValue(value,1)}});setData(next);setDrivers(nextDrivers);setBaselineDrivers(nextDrivers);setConnectedName(String(body.spreadsheet||connectedName||"Connected model"));setMessage("Treasury schedules refreshed successfully.")}catch(error){setMessage(error instanceof Error?error.message:"Could not refresh model")}finally{setBusy(false)}}
  async function writeDriversWithValues(driverValues=drivers,leverValues=cashLevers){
    const builtInWrites=(Object.keys(config.driverMappings) as DriverKey[]).filter((key)=>config.driverMappings[key]&&driverValues[key]!==baselineDrivers[key]).flatMap((key)=>{
      const portfolio=portfolioDriverWrites(scan,key,driverValues[key]-baselineDrivers[key]);
      if(portfolio.length)return portfolio.map((write)=>({...write,range:protectedRange(write.range,config.treasuryTabs)})).filter((write)=>write.range);
      const range=protectedRange(config.driverMappings[key],config.treasuryTabs);
      return range?[{range,values:[[driverValues[key]]]}]:[];
    });
    const customWrites=leverValues.filter((lever)=>lever.range&&lever.value!==lever.base).map((lever)=>({range:protectedRange(lever.range,config.treasuryTabs),values:[[lever.value]]})).filter((write)=>write.range);
    const writes=[...builtInWrites,...customWrites];
    if(!writes.length){setMessage("No changed lever has a valid writable cell in this workbook. Connect a model input first.");setWriteOpen(false);return false}
    const before=modelSnapshot(scan,selectedEntity,last);setBusy(true);
    try{
      const body=await sheetJson(config.url,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({token:config.token,action:"write",ssid:config.ssid,writes})});
      if(body.ok!==true)throw new Error(String(body.error||"Write failed"));
      setDrivers(driverValues);setBaselineDrivers(driverValues);setCashLevers(leverValues.map((lever)=>({...lever,base:lever.value})));setWriteOpen(false);setMessage("Assumptions written. Waiting for Google Sheets to recalculate…");await new Promise((resolve)=>setTimeout(resolve,800));await scanModel(false,before);return true;
    }catch(error){setMessage(error instanceof Error?error.message:"Could not write to the model");return false}finally{setBusy(false)}
  }
  async function writeDrivers(){return writeDriversWithValues(drivers,cashLevers)}
  async function writeAccountDriver(range:string,value:number){const safeRange=protectedRange(range,config.treasuryTabs);if(!safeRange){setMessage("This account driver is outside the selected source sheets. Review Model mapping first.");return}setBusy(true);setMessage("Writing the account assumption and refreshing the workbook…");try{const body=await sheetJson(config.url,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({token:config.token,action:"write",ssid:config.ssid,writes:[{range:safeRange,values:[[value]]}]})});if(body.ok!==true)throw new Error(String(body.error||"Write failed"));await new Promise((resolve)=>setTimeout(resolve,800));await scanModel();setMessage("Account assumption written and the workbook has been refreshed.")}catch(error){setMessage(error instanceof Error?error.message:"Could not write the account assumption")}finally{setBusy(false)}}
  function solveDso(){const target=Number(targetRunway);if(!Number.isFinite(target)||target<0)return;if(scan){const snap=modelSnapshot(scan,selectedEntity,last),revenue=scanMetric(scan,selectedEntity,last,/^revenue$|net revenue|sales revenue/i);const recentBurn=snap.cash!==null&&snap.runway!==null&&snap.runway>0&&snap.runway<99?snap.cash/snap.runway:0;if(snap.cash===null||!revenue||recentBurn<=0){setMessage("Target solving needs closing cash, revenue and recent net cash movement in the connected model.");return}const customImpact=cashLevers.reduce((s,l)=>s+(l.value-l.base)*l.impact,0),desiredCash=target*recentBurn,otherImpact=(drivers.dpo-baselineDrivers.dpo)*(scanMetric(scan,selectedEntity,last,/cogs|cost of goods|direct costs/i)||0)/30.4-(drivers.dio-baselineDrivers.dio)*(scanMetric(scan,selectedEntity,last,/cogs|cost of goods|direct costs/i)||0)/30.4+customImpact;const solved=Math.max(0,Math.min(180,baselineDrivers.dso+(snap.cash+otherImpact-desiredCash)*30.4/revenue));setDrivers((d)=>({...d,dso:Math.round(solved)}));setMessage(`DSO adjusted to ${Math.round(solved)} days as the closest estimated route to ${target} months. Review and write back for the exact Sheets result.`);return}let best=drivers.dso,bestGap=Infinity;for(let dso=0;dso<=180;dso+=.5){const candidate=calculate(data,{...drivers,dso},openingCash).runway[last],gap=Math.abs(candidate-target);if(gap<bestGap){bestGap=gap;best=dso}}setDrivers((d)=>({...d,dso:best}));setMessage(`DSO adjusted to ${best} days for the closest available runway.`)}

  function addCashLever(){setCashLevers((levers)=>[...levers,{id:`lever_${Date.now()}`,label:"Custom cash lever",hint:"Map this to any model assumption cell",value:0,base:0,min:-10,max:10,step:.1,unit:"cash",range:"",impact:1}])}
  function updateCashLever(id:string,patch:Partial<CashLever>){setCashLevers((levers)=>levers.map((lever)=>lever.id===id?{...lever,...patch}:lever))}
  function removeCashLever(id:string){setCashLevers((levers)=>levers.filter((lever)=>lever.id!==id))}
  function setCashRole(id:string,role:CashRole){setConfig((c)=>({...c,cashOpeningId:selectedOpeningId,cashClosingId:selectedClosingId,cashRoles:{...effectiveCashRoles,[id]:role}}))}
  function resetCashDefaults(){if(!scan)return;setConfig((c)=>({...c,cashOpeningId:selectedOpeningId,cashClosingId:selectedClosingId,cashRoles:defaultCashRoles(cashScopeRows,scan.sourceAssignments.assumptions)}))}
  function addCustomCashLine(){setConfig((c)=>({...c,customCashLines:[...c.customCashLines,{id:`cash_${Date.now()}`,name:"",role:"in" as CashRole,monthly:0}]}))}
  function updateCustomCashLine(id:string,patch:Partial<CustomCashLine>){setConfig((c)=>({...c,customCashLines:c.customCashLines.map((line)=>line.id===id?{...line,...patch}:line)}))}
  function removeCustomCashLine(id:string){setConfig((c)=>({...c,customCashLines:c.customCashLines.filter((line)=>line.id!==id)}))}
  function mapCashLever(id:string,range:string){
    if(range==="__none__"){updateCashLever(id,{range:""});return}
    const row=scan?.rows.find((candidate)=>candidate.inputCell===range);
    updateCashLever(id,{range,base:row?.inputValue??0,value:row?.inputValue??0});
    setLastImpact(null);
  }

  const driverChanges=(Object.keys(drivers) as DriverKey[]).filter((k)=>drivers[k]!==baselineDrivers[k]),cashLeverChanges=cashLevers.filter((lever)=>lever.value!==lever.base),cashDelta=calc.cash[legacyLast]-baseCalc.cash[legacyLast],customCashDelta=cashLevers.reduce((s,lever)=>s+(lever.value-lever.base)*lever.impact,0),runwayNow=calc.runway[legacyLast]??0,selectedName=`${labels[start]??"Start"} – ${labels[last]??"End"}`;
  const scanBase=modelSnapshot(scan,selectedEntity,last),scanRevenue=scanMetric(scan,selectedEntity,last,/^revenue$|net revenue|sales revenue/i)||0,scanCosts=scanMetric(scan,selectedEntity,last,/cogs|cost of goods|direct costs/i)||0;
  const estimatedCashDelta=-(drivers.dso-baselineDrivers.dso)*scanRevenue/30.4+(drivers.dpo-baselineDrivers.dpo)*scanCosts/30.4-(drivers.dio-baselineDrivers.dio)*scanCosts/30.4+customCashDelta;
  const estimatedCash=scanBase.cash===null?null:scanBase.cash+estimatedCashDelta,estimatedBurn=scanBase.cash!==null&&scanBase.runway!==null&&scanBase.runway>0&&scanBase.runway<99?scanBase.cash/scanBase.runway:0,estimatedRunway=estimatedCash!==null&&estimatedBurn>0?Math.max(0,estimatedCash/estimatedBurn):null;
  const verifiedCashDelta=lastImpact&&lastImpact.before.cash!==null&&lastImpact.after.cash!==null?lastImpact.after.cash-lastImpact.before.cash:null;
  const entityOptions=allEntities(scan).length?allEntities(scan):["Group"];
  const availableInputs=(scan?.rows||[]).filter((row)=>row.inputCell&&Number.isFinite(row.inputValue)).filter((row,index,array)=>array.findIndex((candidate)=>candidate.inputCell===row.inputCell)===index);
  const cashAssumptionsSheet=scan?.sourceAssignments?.assumptions;
  // Scope the cash-flow lines to a single tab/unit. If the model has a real cash-flow
  // statement, use only that tab (so a ₹-crore cash tab is never mixed with a raw-₹ P&L);
  // otherwise fall back to every timelined tab (e.g. a P&L-only model with no cash statement).
  const cashSheet=scan?.sourceAssignments?.cashFlow;
  const cashSheetRows:ScanRow[]=scan&&cashSheet&&cashSheet!=="__auto__"&&cashSheet!=="__skip__"?scan.rows.filter((row)=>row.sheet===cashSheet):[];
  const useCashTab=cashCandidateRows(cashSheetRows,cashAssumptionsSheet).length>=3;
  const cashScopeRows:ScanRow[]=scan?(useCashTab?cashSheetRows:scan.rows):[];
  const cashRows:ScanRow[]=cashCandidateRows(cashScopeRows,cashAssumptionsSheet);
  const cashBalanceRows:ScanRow[]=cashBalanceCandidateRows(cashScopeRows,cashAssumptionsSheet);
  const selectedOpeningId=cashBalanceRows.some((row)=>row.id===config.cashOpeningId)?config.cashOpeningId:selectCashBalanceRow(cashBalanceRows,"opening")?.id||"";
  const selectedClosingId=cashBalanceRows.some((row)=>row.id===config.cashClosingId&&!/revolver|facility|term loan|debt/i.test(row.label))?config.cashClosingId:selectCashBalanceRow(cashBalanceRows,"closing")?.id||"";
  const suggestedCashRoles=defaultCashRoles(cashScopeRows,cashAssumptionsSheet);
  const retainedCashRoles=selectedOpeningId===config.cashOpeningId&&selectedClosingId===config.cashClosingId?Object.fromEntries(Object.entries(config.cashRoles).filter(([id])=>cashRows.some((row)=>row.id===id))):{};
  const effectiveCashRoles={...suggestedCashRoles,...retainedCashRoles};
  // The waterfall needs the designated opening/closing balance rows for its endpoints,
  // even though those balances are (correctly) excluded from the movement candidates.
  const cashBridgeRows:ScanRow[]=(()=>{const set=[...cashRows];[selectedOpeningId,selectedClosingId].forEach((id)=>{if(!id)return;const row=cashBalanceRows.find((r)=>r.id===id);if(row&&!set.some((r)=>r.id===row.id))set.push(row)});return set})();
  const bridgeOpts={roles:effectiveCashRoles,openingId:selectedOpeningId,closingId:selectedClosingId,customLines:config.customCashLines};
  const cashSource=scan?.sourceAssignments?.cashFlow,consolidatedRows=scan?.rows.filter((r)=>r.sheet===cashSource)||[],groupCashRow=selectCashBalanceRow(consolidatedRows,"closing"),groupMoveRow=consolidatedRows.find((r)=>/net change|net cash movement|change in cash|net cash flow before (?:financing|revolver)/i.test(r.label)),groupCash=groupCashRow?.values[last],groupMove=groupMoveRow?.values[last],groupUnit=groupCashRow?.unit||"model units";
  const schedule=[["Revenue",calc.revenue],["COGS",calc.cogs],["EBITDA",calc.ebitda],["Receivables",calc.receivables],["Inventory",calc.inventory],["Payables",calc.payables],["Change in working capital",calc.deltaNwc],["Operating cash flow",calc.ocf],["Capex",calc.capex],["Debt service",calc.debt],["Financing",calc.financing],["Net cash movement",calc.net],["Closing cash",calc.cash]] as [string,number[]][];

  function assistantOutputsFor(nextDrivers:Record<DriverKey,number>,nextLevers:CashLever[]):AssistantOutputs {
    const customImpact=nextLevers.reduce((total,lever)=>total+(lever.value-lever.base)*lever.impact,0);
    const ccc=nextDrivers.dso+nextDrivers.dio-nextDrivers.dpo;
    if(scan){
      const base=modelSnapshot(scan,selectedEntity,last),targetUnit=groupCashRow?.unit||"model units";
      const revenue=convertedSeries(preferredSeries(scan,selectedEntity,[/^total billings$/i,/gross sales invoiced/i,/^revenue$|net revenue|sales revenue/i]),targetUnit,scan.periods.length)[last]||0;
      const costs=convertedSeries(preferredSeries(scan,selectedEntity,[/^total purchases$/i,/gross procurement invoiced/i,/^cogs$|cost of goods|direct costs/i]),targetUnit,scan.periods.length)[last]||0;
      const dsoDelta=nextDrivers.dso-baselineDrivers.dso,dpoDelta=nextDrivers.dpo-baselineDrivers.dpo;
      const dsoImpact=dsoDelta?portfolioScheduleImpact(scan,"dso",dsoDelta,last,targetUnit):0;
      const dpoImpact=dpoDelta?portfolioScheduleImpact(scan,"dpo",dpoDelta,last,targetUnit):0;
      const workingCapitalImpact=(dsoImpact??-dsoDelta*revenue/30.4)+(dpoImpact??dpoDelta*costs/30.4)-(nextDrivers.dio-baselineDrivers.dio)*costs/30.4;
      const totalImpact=workingCapitalImpact+customImpact,unconstrainedCash=base.cash===null?null:base.cash+totalImpact;
      const hasLiquidityPlug=scan.rows.some((row)=>/revolver.*drawdown.*plug|automatic.*revolver|financing plug/i.test(`${row.label} ${row.section}`));
      const minimumCash=convertedSeries(preferredSeries(scan,selectedEntity,[/^minimum cash(?: buffer)?$/i,/minimum liquidity/i]),targetUnit,scan.periods.length)[last]||0;
      const revolverBalance=convertedSeries(preferredSeries(scan,selectedEntity,[/revolver.*closing balance|closing.*revolver|revolving facility.*closing/i]),targetUnit,scan.periods.length)[last]||0;
      const closingCash=unconstrainedCash===null?null:hasLiquidityPlug?(totalImpact<0?Math.max(minimumCash,unconstrainedCash):base.cash!+Math.max(0,totalImpact-revolverBalance)):unconstrainedCash;
      const burn=base.cash!==null&&base.runway!==null&&base.runway>0&&base.runway<99?base.cash/base.runway:0;
      const runway=closingCash!==null?(burn>0?Math.max(0,closingCash/burn):base.runway):null;
      const baseOcf=scanMetric(scan,selectedEntity,last,/operating cash flow|net cash from operating|cash from operations/i);
      return {closing_cash:closingCash,runway_months:runway,monthly_burn_rate:burn||null,operating_cash_flow:baseOcf===null?null:baseOcf+workingCapitalImpact,net_cash_movement:base.movement,cash_conversion_cycle_days:ccc,working_capital_cash_impact:workingCapitalImpact,custom_lever_cash_impact:customImpact,total_cash_impact:totalImpact};
    }
    const scenario=calculate(data,nextDrivers,openingCash),base=calculate(data,baselineDrivers,openingCash),index=Math.min(last,scenario.cash.length-1);
    const workingCapitalImpact=(scenario.cash[index]??0)-(base.cash[index]??0),closingCash=(scenario.cash[index]??0)+customImpact;
    const recentBurn=scenario.net.slice(Math.max(0,index-2),index+1).filter((value)=>value<0),burn=recentBurn.length?Math.abs(recentBurn.reduce((total,value)=>total+value,0)/recentBurn.length):0;
    return {closing_cash:closingCash,runway_months:burn?Math.max(0,closingCash/burn):99,monthly_burn_rate:burn||null,operating_cash_flow:sum(scenario.ocf,start,index),net_cash_movement:sum(scenario.net,start,index)+customImpact,cash_conversion_cycle_days:ccc,working_capital_cash_impact:workingCapitalImpact,custom_lever_cash_impact:customImpact,total_cash_impact:workingCapitalImpact+customImpact};
  }

  function applyAssistantChanges(changes:AssistantChange[]):EngineComparison {
    const before=assistantOutputsFor(drivers,cashLevers),nextDrivers={...drivers},nextLevers=cashLevers.map((lever)=>({...lever})),applied:EngineComparison["applied"]=[];
    if(!assistantOriginal)setAssistantOriginal({drivers:{...drivers},cashLevers:cashLevers.map((lever)=>({...lever})),baseline:JSON.stringify({drivers:baselineDrivers,levers:cashLevers.map((lever)=>[lever.id,lever.base])})});
    changes.forEach((change)=>{
      if((["dso","dpo","dio"] as string[]).includes(change.lever_id)){
        const key=change.lever_id as DriverKey,from=nextDrivers[key],to=Math.max(0,Math.min(180,Math.round(change.new_value)));
        nextDrivers[key]=to;applied.push({id:key,name:key.toUpperCase(),from,to,reason:change.reason});return;
      }
      const lever=nextLevers.find((candidate)=>candidate.id===change.lever_id);if(!lever)return;
      const from=lever.value,clamped=Math.max(lever.min,Math.min(lever.max,change.new_value)),precision=Math.max(0,(String(lever.step).split(".")[1]||"").length),to=Number((Math.round(clamped/lever.step)*lever.step).toFixed(precision));
      lever.value=to;applied.push({id:lever.id,name:lever.label,from,to,reason:change.reason});
    });
    setDrivers(nextDrivers);setCashLevers(nextLevers);setLastImpact(null);
    return {before,after:assistantOutputsFor(nextDrivers,nextLevers),applied};
  }

  function resetAssistantScenario(){if(!assistantOriginal)return;const baseline=JSON.stringify({drivers:baselineDrivers,levers:cashLevers.map((lever)=>[lever.id,lever.base])});if(assistantOriginal.baseline===baseline){setDrivers({...assistantOriginal.drivers});setCashLevers(assistantOriginal.cashLevers.map((lever)=>({...lever})));setLastImpact(null)}setAssistantOriginal(null)}

  async function readVerifiedScenario(driverValues:Record<DriverKey,number>):Promise<{out:AssistantOutputs;series:number[]}|null>{
    if(!groupCashRow)return null;
    const cashRange=protectedRange(groupCashRow.range,config.treasuryTabs),movementRange=groupMoveRow?protectedRange(groupMoveRow.range,config.treasuryTabs):"";
    if(!cashRange)return null;
    const ranges=[cashRange,movementRange].filter(Boolean),body=await sheetJson(sheetQuery(config,"read",ranges.join("|")));
    if(body.ok!==true)throw new Error(String(body.error||"Could not read the recalculated result"));
    const values=(body.values as Record<string,unknown>|undefined)||{},cashValues=flattenRange(values[cashRange]).map((value)=>numberValue(value,1));
    const movementValues=movementRange?flattenRange(values[movementRange]).map((value)=>numberValue(value,1)):[];
    const resultIndex=Math.min(last,cashValues.length-1),closingCash=resultIndex>=0?cashValues[resultIndex]:null;
    const recentBurns=movementValues.slice(Math.max(0,resultIndex-2),resultIndex+1).filter((value)=>value<0),burn=recentBurns.length?Math.abs(recentBurns.reduce((sum,value)=>sum+value,0)/recentBurns.length):0;
    const out={closing_cash:closingCash,runway_months:closingCash!==null?(burn?Math.max(0,closingCash/burn):99):null,monthly_burn_rate:burn||null,operating_cash_flow:null,net_cash_movement:movementValues[resultIndex]??null,cash_conversion_cycle_days:driverValues.dso+driverValues.dio-driverValues.dpo,working_capital_cash_impact:0,custom_lever_cash_impact:0,total_cash_impact:0};
    return {out,series:cashValues.slice(start,last+1)};
  }

  async function confirmAssistantWriteBack():Promise<AssistantOutputs|null>{
    const written=await writeDrivers();if(!written)return null;
    return (await readVerifiedScenario(drivers))?.out||null;
  }

  async function verifyComparisonScenario(vals:Record<string,number>){
    const scenarioDrivers={dso:vals.dso??baselineDrivers.dso,dpo:vals.dpo??baselineDrivers.dpo,dio:vals.dio??baselineDrivers.dio};
    const scenarioLevers=cashLevers.map((lever)=>({...lever,value:vals[lever.id]??lever.base}));
    const written=await writeDriversWithValues(scenarioDrivers,scenarioLevers);if(!written)return null;
    return readVerifiedScenario(scenarioDrivers);
  }

  const assistantBridge:Record<string,number>=scan?Object.fromEntries(([['customer_cash',/collections|billings|management fee income|interest received/i],['supplier_cash',/supplier payments|discount captured/i],['people',/payroll|bonus paid/i],['operating',/cash operating|insurance premium|management fee to/i],['tax',/income tax/i],['debt',/interest|principal|lease payment|commitment fee|revolver draw/i],['capex',/capex|acquisition/i],['funding',/equity cure|intercompany funding/i]] as [string,RegExp][]).map(([name,pattern])=>[name,consolidatedRows.filter((row)=>pattern.test(row.label)&&!/beginning cash|ending cash|net change|memo|non-cash/i.test(row.label)).reduce((total,row)=>total+sum(row.values,start,last),0)])):{ebitda:sum(calc.ebitda,start,legacyLast),working_capital:-sum(calc.deltaNwc,start,legacyLast),tax:-sum(calc.tax,start,legacyLast),capex:-sum(calc.capex,start,legacyLast),debt:-sum(calc.debt,start,legacyLast),financing:sum(calc.financing,start,legacyLast)};
  const assistantState:AssistantEngineState={
    model:{name:connectedName||"Niche Numbers demo model",mode:scan?"connected_workbook":"demo",entity:selectedEntity,unit:groupUnit},
    period:{from:labels[start]||"Start",to:labels[last]||"End"},
    inputs:{opening_cash:openingCash,built_in_drivers:{dso:drivers.dso,dpo:drivers.dpo,dio:drivers.dio},source_series:Object.fromEntries(Object.entries(data).map(([key,values])=>[key,values.slice(start,last+1)]))},
    available_levers:[
      {id:"dso",name:"DSO",kind:"working_capital",value:drivers.dso,base:baselineDrivers.dso,min:0,max:180,step:1,unit:"days",mapped:!scan||!!config.driverMappings.dso,business_effect:"Lower values collect customer cash sooner."},
      {id:"dpo",name:"DPO",kind:"working_capital",value:drivers.dpo,base:baselineDrivers.dpo,min:0,max:180,step:1,unit:"days",mapped:!scan||!!config.driverMappings.dpo,business_effect:"Higher values pay suppliers later."},
      {id:"dio",name:"DIO",kind:"working_capital",value:drivers.dio,base:baselineDrivers.dio,min:0,max:180,step:1,unit:"days",mapped:!scan||!!config.driverMappings.dio,business_effect:"Lower values reduce cash tied up in inventory."},
      ...cashLevers.map((lever)=>({id:lever.id,name:lever.label,kind:"custom" as const,value:lever.value,base:lever.base,min:lever.min,max:lever.max,step:lever.step,unit:lever.unit,mapped:!scan||!!lever.range,business_effect:lever.hint})),
    ],
    computed_outputs:assistantOutputsFor(drivers,cashLevers),cash_bridge_components:assistantBridge,cash_bridge_ranked:Object.entries(assistantBridge).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])).map(([component,amount])=>({component,amount,direction:amount>=0?"inflow" as const:"outflow" as const})),
    computed_model_lines:(scan?scan.rows.filter((row)=>row.values.length&&(row.entity===selectedEntity||row.entity==="Consolidated"||row.entity==="Group")):schedule.map(([label,values])=>({label,section:"Treasury schedule",values}))).map((row)=>({label:row.label,section:row.section,values:row.values.slice(start,last+1)})),
  };

  const scenarioLevers: ScenarioLever[] = [
    { id: "dso", name: "DSO", unit: "days", min: 0, max: 180, step: 1, base: baselineDrivers.dso, kind: "driver" },
    { id: "dpo", name: "DPO", unit: "days", min: 0, max: 180, step: 1, base: baselineDrivers.dpo, kind: "driver" },
    { id: "dio", name: "DIO", unit: "days", min: 0, max: 180, step: 1, base: baselineDrivers.dio, kind: "driver" },
    ...cashLevers.map((lever) => ({ id: lever.id, name: lever.label, unit: lever.unit, min: lever.min, max: lever.max, step: lever.step, base: lever.base, kind: "lever" as const })),
  ];
  function scenarioCompute(vals: Record<string, number>) {
    const dr = { dso: vals.dso ?? baselineDrivers.dso, dpo: vals.dpo ?? baselineDrivers.dpo, dio: vals.dio ?? baselineDrivers.dio };
    const nextLevers = cashLevers.map((lever) => ({ ...lever, value: vals[lever.id] ?? lever.base }));
    const out = assistantOutputsFor(dr, nextLevers);
    let series:number[];
    if(scan){
      const length=scan.periods.length,targetUnit=groupCashRow?.unit||"model units";
      const baseCash=convertedSeries(groupCashRow,targetUnit,length);
      const billings=convertedSeries(preferredSeries(scan,selectedEntity,[/^total billings$/i,/gross sales invoiced/i,/^revenue$|net revenue|sales revenue/i]),targetUnit,length);
      const purchases=convertedSeries(preferredSeries(scan,selectedEntity,[/^total purchases$/i,/gross procurement invoiced/i,/^cogs$|cost of goods|direct costs/i]),targetUnit,length);
      const minimumCash=convertedSeries(preferredSeries(scan,selectedEntity,[/^minimum cash(?: buffer)?$/i,/minimum liquidity/i]),targetUnit,length);
      const revolverBalance=convertedSeries(preferredSeries(scan,selectedEntity,[/revolver.*closing balance|closing.*revolver|revolving facility.*closing/i]),targetUnit,length);
      const hasLiquidityPlug=scan.rows.some((row)=>/revolver.*drawdown.*plug|automatic.*revolver|financing plug/i.test(`${row.label} ${row.section}`));
      const customImpact=nextLevers.reduce((total,lever)=>total+(lever.value-lever.base)*lever.impact,0);
      const dsoDelta=dr.dso-baselineDrivers.dso,dpoDelta=dr.dpo-baselineDrivers.dpo,dioDelta=dr.dio-baselineDrivers.dio;
      series=baseCash.map((base,index)=>{
        const dsoImpact=dsoDelta?portfolioScheduleImpact(scan,"dso",dsoDelta,index,targetUnit):0;
        const dpoImpact=dpoDelta?portfolioScheduleImpact(scan,"dpo",dpoDelta,index,targetUnit):0;
        const impact=(dsoImpact??-dsoDelta*(billings[index]||0)/30.4)+(dpoImpact??dpoDelta*(purchases[index]||0)/30.4)-dioDelta*(purchases[index]||0)/30.4+customImpact;
        const unconstrained=base+impact;
        if(!hasLiquidityPlug)return unconstrained;
        if(impact<0)return Math.max(minimumCash[index]??-Infinity,unconstrained);
        return base+Math.max(0,impact-Math.max(0,revolverBalance[index]||0));
      }).slice(start,last+1);
    }else series=calculate(data,dr,openingCash).cash.slice(start,last+1);
    const hasUnverifiedWorkbookChange=!!scan&&((Object.keys(dr) as DriverKey[]).some((key)=>dr[key]!==baselineDrivers[key])||nextLevers.some((lever)=>lever.value!==lever.base));
    if(hasUnverifiedWorkbookChange){
      return {out:{...out,closing_cash:null,runway_months:null,monthly_burn_rate:null,operating_cash_flow:null,net_cash_movement:null},series:series.map(()=>Number.NaN)};
    }
    return { out, series };
  }

  return <main className="app-shell"><header className="topbar"><div className="brand"><div className="brand-mark"><Landmark size={18}/></div><div><strong>Niche Numbers Treasury</strong><span>Cash · Runway · Scenario levers</span></div></div><div className="top-actions"><div className={`connection-pill ${connectedName?"live":""}`}><span/>{connectedName||"Demo data"}</div><Button variant="outline" onClick={()=>setConnectOpen(true)}><Link2 size={15}/> Connect sheet</Button><Button onClick={()=>scanModel()} disabled={busy||scanBusy}><RefreshCw size={15} className={busy||scanBusy?"spin":""}/> Refresh</Button></div></header>
  <section className="workspace"><div className="page-head"><div><p className="eyebrow">Liquidity command centre</p><h1>See where cash is going, then change the outcome.</h1><p>Translate the connected forecast into working capital, cash flow and runway. Test changes before touching the underlying model.</p></div><div className="period-controls"><div><Label>From</Label><Select value={String(start)} onValueChange={(v)=>{const n=Number(v);setStart(n);if(n>end)setEnd(n)}}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{labels.map((m,i)=><SelectItem key={m} value={String(i)}>{m}</SelectItem>)}</SelectContent></Select></div><div><Label>To</Label><Select value={String(last)} onValueChange={(v)=>{const n=Number(v);setEnd(n);if(n<start)setStart(n)}}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{labels.map((m,i)=><SelectItem key={m} value={String(i)}>{m}</SelectItem>)}</SelectContent></Select></div></div></div>
  {message&&<div className="status-banner" role="status">{message}<button onClick={()=>setMessage("")}>×</button></div>}
  <Coverage scan={scan} onScan={scanModel} busy={scanBusy}/>
  <div className="kpi-grid"><article><span>Closing cash</span><strong>{money(scan?(groupCash??0):(calc.cash[legacyLast]??0))}</strong><small>{scan?`${groupUnit} from connected model`:`${cashDelta>=0?"+":""}${money(cashDelta)} vs base`}</small></article><article><span>Runway</span><strong>{scan?(scanBase.runway===null?"Not available":scanBase.runway>=99?"Cash-generative":`${scanBase.runway.toFixed(1)} months`):runwayNow>=99?"Cash-generative":`${runwayNow.toFixed(1)} months`}</strong><small>Using recent negative cash movement at {labels[last]}</small></article><article><span>{scan?"Latest net cash movement":"Operating cash flow"}</span><strong>{money(scan?(groupMove??0):sum(calc.ocf,start,legacyLast))}</strong><small>{scan?labels[last]:selectedName}</small></article><article><span>Cash conversion cycle</span><strong>{(drivers.dso+drivers.dio-drivers.dpo).toFixed(0)} days</strong><small>{drivers.dso} DSO + {drivers.dio} DIO − {drivers.dpo} DPO</small></article></div>
  <Tabs defaultValue="overview" className="main-tabs"><TabsList><TabsTrigger value="overview"><WalletCards size={15}/> Summary</TabsTrigger><TabsTrigger value="collections" disabled={!!scan&&!scan.modules.includes("collections")}>Customer collections</TabsTrigger><TabsTrigger value="payments" disabled={!!scan&&!scan.modules.includes("payables")}>Supplier payments</TabsTrigger><TabsTrigger value="scenario"><SlidersHorizontal size={15}/> Scenario levers</TabsTrigger><TabsTrigger value="scenarios"><Columns3 size={15}/> Compare scenarios</TabsTrigger><TabsTrigger value="working" disabled={!!scan&&!scan.modules.some((m)=>["receivables","payables","workingCapital"].includes(m))}>Working capital</TabsTrigger><TabsTrigger value="debt" disabled={!!scan&&!scan.modules.includes("debt")}>Debt</TabsTrigger><TabsTrigger value="liquidity" disabled={!!scan&&!scan.modules.includes("liquidity")}>Liquidity</TabsTrigger><TabsTrigger value="covenants" disabled={!!scan&&!scan.modules.includes("covenants")}>Covenants</TabsTrigger><TabsTrigger value="schedule">Schedule</TabsTrigger><TabsTrigger value="mapping"><Settings2 size={15}/> Model mapping</TabsTrigger></TabsList>
  <TabsContent value="overview"><div className="summary-stack"><AskModelAssistant state={assistantState} onApply={applyAssistantChanges} onWriteBack={confirmAssistantWriteBack} onReset={resetAssistantScenario} canReset={!!assistantOriginal&&assistantOriginal.baseline===JSON.stringify({drivers:baselineDrivers,levers:cashLevers.map((lever)=>[lever.id,lever.base])})}/>{scan&&scan.modules.includes("cash")?<CashFlowModule scan={scan} entity={selectedEntity} setEntity={setSelectedEntity} start={start} end={last} cashRows={cashBridgeRows} bridgeOpts={bridgeOpts}/>:<div className="content-grid"><section className="panel chart-panel"><div className="panel-head"><div><p className="eyebrow">Cash bridge</p><h2>{selectedName}</h2></div><span className="legend"><i className="inflow"/> Inflow <i className="outflow"/> Outflow</span></div><Waterfall calc={calc} start={start} end={legacyLast}/></section><aside className="panel health-panel"><div className="panel-head"><div><p className="eyebrow">Liquidity health</p><h2>What is driving cash</h2></div></div><div className="health-row"><span>EBITDA contribution</span><strong className="good">+{money(sum(calc.ebitda,start,legacyLast))}</strong></div><div className="health-row"><span>Working-capital drag</span><strong className={-sum(calc.deltaNwc,start,legacyLast)>=0?"good":"bad"}>{money(-sum(calc.deltaNwc,start,legacyLast))}</strong></div><div className="health-row"><span>Capex and debt</span><strong className="bad">{money(-sum(calc.capex,start,legacyLast)-sum(calc.debt,start,legacyLast))}</strong></div></aside></div>}</div></TabsContent>
  <TabsContent value="collections">{scan?<CustomerCollectionsModule scan={scan} start={start} end={last} onWriteDriver={writeAccountDriver}/>:<section className="panel empty-module"><h2>Connect and scan a model</h2><p>Customer collections support invoice-level records and account-by-month debtor schedules.</p></section>}</TabsContent>
  <TabsContent value="payments">{scan?<SupplierPaymentsModule scan={scan} start={start} end={last} onWriteDriver={writeAccountDriver}/>:<section className="panel empty-module"><h2>Connect and scan a model</h2><p>Supplier payments support invoice-level records and supplier-by-month creditor schedules.</p></section>}</TabsContent>
  <TabsContent value="working">{scan?<WorkingCapitalModule scan={scan} entity={selectedEntity} setEntity={setSelectedEntity} end={last}/>:<section className="panel empty-module"><h2>Connect and scan a model</h2><p>Receivables, payables and inventory will activate automatically when found.</p></section>}</TabsContent>
  <TabsContent value="debt">{scan?<DebtModule scan={scan} start={start} end={last}/>:<section className="panel empty-module"><h2>Debt is optional</h2><p>If a debt schedule is found, instruments, interest, principal and availability appear here.</p></section>}</TabsContent>
  <TabsContent value="liquidity">{scan?<LiquidityModule scan={scan} end={last}/>:<section className="panel empty-module"><h2>Liquidity is optional</h2><p>Restricted cash, overdrafts and minimum-balance headroom activate when present.</p></section>}</TabsContent>
  <TabsContent value="covenants">{scan?<CovenantsModule scan={scan} end={last}/>:<section className="panel empty-module"><h2>Covenants are optional</h2><p>Leverage, interest cover and DSCR tests activate when a covenant schedule is found.</p></section>}</TabsContent>
  <TabsContent value="scenario"><div className="scenario-grid"><section className="panel drivers-panel">
    <div className="panel-head"><div><p className="eyebrow">Scenario levers</p><h2>Change a model input, then let Google Sheets calculate the result</h2><p><b>Model value</b> is what is currently in the sheet. <b>Scenario value</b> is your proposed change. Nothing is written until you review and confirm.</p></div><div className="scenario-actions">{scan&&<Select value={entityOptions.includes(selectedEntity)?selectedEntity:entityOptions[0]} onValueChange={setSelectedEntity}><SelectTrigger className="entity-select"><SelectValue/></SelectTrigger><SelectContent>{entityOptions.map((e)=><SelectItem value={e} key={e}>{e}</SelectItem>)}</SelectContent></Select>}<Button variant="outline" size="sm" onClick={()=>{setDrivers({...baselineDrivers});setCashLevers((levers)=>levers.map((lever)=>({...lever,value:lever.base})));setLastImpact(null)}}>Reset scenario</Button><Button size="sm" onClick={addCashLever}><Plus size={14}/> Add lever</Button></div></div>
    <div className="driver-list">{([["dso","DSO","Customer collection days",0,180],["dpo","DPO","Supplier payment days",0,180],["dio","DIO","Inventory holding days",0,180]] as [DriverKey,string,string,number,number][]).map(([key,name,hint,min,max])=><div className="driver" key={key}><div className="driver-heading"><span><b>{name}</b> · {hint}<small className={config.driverMappings[key]?"mapping-ok":"mapping-missing"}>{config.driverMappings[key]?`Connected · ${config.driverMappings[key]}`:"Not connected — choose its cell in Model mapping"}</small></span><div className="value-compare"><span><small>Model value</small><b>{baselineDrivers[key]} days</b></span><span><small>Scenario value</small><strong>{drivers[key]} days</strong></span></div></div><Slider min={min} max={max} step={1} value={[drivers[key]]} onValueChange={([v])=>{setDrivers((d)=>({...d,[key]:v}));setLastImpact(null)}}/></div>)}</div>
    <div className="custom-levers">{cashLevers.map((lever)=><div className={`cash-lever ${lever.range?"connected":"needs-map"}`} key={lever.id}><div className="lever-top"><div><Input aria-label="Lever name" value={lever.label} onChange={(e)=>updateCashLever(lever.id,{label:e.target.value})}/><small>{lever.hint}</small></div><Button variant="outline" size="sm" onClick={()=>removeCashLever(lever.id)} aria-label={`Remove ${lever.label}`}><Trash2 size={14}/></Button></div><div className="lever-simple-grid"><div className="model-value"><Label>Model value</Label><strong>{lever.base.toLocaleString("en-US",{maximumFractionDigits:2})}</strong><small>Read from the connected cell</small></div><div><Label>Scenario value</Label><Input type="number" step={lever.step} value={lever.value} onChange={(e)=>{updateCashLever(lever.id,{value:Number(e.target.value)||0});setLastImpact(null)}}/></div><div><Label>Connect to model input</Label><Select value={lever.range||"__none__"} onValueChange={(value)=>mapCashLever(lever.id,value)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="__none__">Not connected</SelectItem>{availableInputs.map((row)=><SelectItem value={row.inputCell||row.id} key={row.inputCell||row.id}>{row.label} · {row.inputCell}</SelectItem>)}</SelectContent></Select><small className={lever.range?"mapping-ok":"mapping-missing"}>{lever.range?`Will write to ${lever.range}`:"Preview only until an input is connected"}</small></div></div><Slider min={lever.min} max={lever.max} step={lever.step} value={[lever.value]} onValueChange={([value])=>{updateCashLever(lever.id,{value});setLastImpact(null)}}/><details className="lever-advanced"><summary>Advanced settings</summary><div><Label>Manual cell</Label><Input value={lever.range} placeholder="e.g. 'Assumptions'!B21" onChange={(e)=>updateCashLever(lever.id,{range:e.target.value})}/><Label>Directional preview</Label><Select value={String(lever.impact)} onValueChange={(v)=>updateCashLever(lever.id,{impact:Number(v)})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="1">Higher improves cash</SelectItem><SelectItem value="-1">Higher uses cash</SelectItem><SelectItem value="0">No local preview</SelectItem></SelectContent></Select></div></details></div>)}</div>
    <div className="write-strip"><div><strong>{driverChanges.length+cashLeverChanges.length?`${driverChanges.length+cashLeverChanges.length} assumption${driverChanges.length+cashLeverChanges.length>1?"s":""} changed`:"No scenario changes"}</strong><span>{scan?"Connected changes are written once, then the workbook is refreshed to show the exact result.":"Connect a workbook before writing changes."}</span></div><Button onClick={()=>setWriteOpen(true)} disabled={!(driverChanges.length+cashLeverChanges.length)||busy||scanBusy}><UploadCloud size={15}/> Review & write to Google Sheets</Button></div>
  </section><aside className="panel solve-panel"><p className="eyebrow">Runway planner</p><h2>{scan?"How can I extend runway?":"Target a runway"}</h2><p>{scan?"Use the directional preview to choose a lever. The verified result appears only after Google Sheets recalculates.":"Choose the runway you want. The tool finds the closest DSO needed to reach it."}</p><Label htmlFor="target">Target runway at {labels[last]}</Label><div className="solve-input"><Input id="target" type="number" min="0" step=".5" value={targetRunway} onChange={(e)=>setTargetRunway(e.target.value)}/><span>months</span></div><Button onClick={solveDso} disabled={!!scan&&(!config.driverMappings.dso||scanBase.cash===null||!scanRevenue)}>Solve using DSO</Button><div className="lever-impact-grid"><div><span>Working-capital preview</span><strong>{money(estimatedCashDelta-customCashDelta)}</strong></div><div><span>Custom-lever preview</span><strong>{money(customCashDelta)}</strong></div><div><span>Directional cash preview</span><strong className={estimatedCashDelta>=0?"good":"bad"}>{estimatedCashDelta>=0?"+":""}{money(estimatedCashDelta)}</strong></div><div><span>Preview runway</span><strong>{estimatedRunway!==null?`${estimatedRunway.toFixed(1)} mo`:scan?"Write back":"Demo"}</strong></div></div><div className="impact-box"><span>{verifiedCashDelta!==null?"Verified closing-cash impact":"Calculation owner"}</span><strong>{verifiedCashDelta!==null?`${verifiedCashDelta>=0?"+":""}${money(verifiedCashDelta)}`:"Google Sheets"}</strong><small>{verifiedCashDelta!==null?`${money(lastImpact?.before.cash??0)} to ${money(lastImpact?.after.cash??0)} after recalculation`:"Preview values are directional; exact values come back from the workbook"}</small></div></aside></div></TabsContent>
  <TabsContent value="scenarios"><ScenarioLab periods={labels.slice(start,last+1)} levers={scenarioLevers} connected={!!scan} compute={scenarioCompute} onVerify={verifyComparisonScenario} money={money}/></TabsContent>
  <TabsContent value="schedule">{scan?<DetectedScheduleModule scan={scan}/>:<section className="panel table-panel"><div className="panel-head"><div><p className="eyebrow">Treasury schedule</p><h2>Monthly cash and working capital</h2><p>Demo data is shown only until a workbook is connected.</p></div></div><div className="table-scroll"><Table><TableHeader><TableRow><TableHead className="sticky-col">Line</TableHead>{labels.map((m)=><TableHead key={m} className="number">{m}</TableHead>)}</TableRow></TableHeader><TableBody>{schedule.map(([name,row])=><TableRow key={name}><TableCell className="sticky-col"><b>{name}</b></TableCell>{labels.map((m,i)=><TableCell key={m} className="number">{money(row[i]??0)}</TableCell>)}</TableRow>)}</TableBody></Table></div></section>}</TabsContent>
  <TabsContent value="mapping"><ModelMappingWorkbench sheets={config.availableSheets} assignments={config.sourceAssignments} scan={scan} busy={scanBusy} onAssignmentChange={changeSource} onMappingChange={changeMapping} onScan={()=>scanModel()}/>{scan&&<div className="panel cfe-panel"><CashFlowEditor rows={cashRows} balanceRows={cashBalanceRows} periods={labels} start={start} end={last} roles={config.cashRoles} openingId={config.cashOpeningId} closingId={config.cashClosingId} customLines={config.customCashLines} money={money} onSetRole={setCashRole} onSetOpening={(id)=>setConfig((c)=>({...c,cashOpeningId:id}))} onSetClosing={(id)=>setConfig((c)=>({...c,cashClosingId:id}))} onAddCustom={addCustomCashLine} onUpdateCustom={updateCustomCashLine} onRemoveCustom={removeCustomCashLine} onResetDefaults={resetCashDefaults}/></div>}<details className="panel manual-mapping advanced-fallback" open><summary>Manual mapping — map any row yourself</summary><MappingFallback rows={scan?.rows||[]} lineFields={lineMeta} lineMappings={config.mappings} driverMappings={config.driverMappings} startMonth={config.startMonth} months={config.months} openingCash={openingCash} busy={busy} onSetLine={(key,range)=>setConfig((c)=>({...c,mappings:{...c.mappings,[key as LineKey]:range}}))} onSetDriver={(key,cell)=>setConfig((c)=>({...c,driverMappings:{...c.driverMappings,[key as DriverKey]:cell}}))} onStartMonth={(value)=>setConfig((c)=>({...c,startMonth:value}))} onMonths={(value)=>setConfig((c)=>({...c,months:value}))} onOpeningCash={setOpeningCash} onRead={refreshModel}/></details></TabsContent></Tabs></section>
  <Dialog open={connectOpen} onOpenChange={setConnectOpen}><DialogContent className="connect-dialog"><DialogHeader className="connect-header"><div className="connect-icon"><Link2 size={18}/></div><div><DialogTitle>Connect a treasury model</DialogTitle><DialogDescription>Choose any workbook. Every workbook keeps its own source choices and mappings.</DialogDescription></div></DialogHeader><div className="connect-body"><section className="connection-step"><div className="step-title"><span>1</span><div><strong>Target workbook</strong><small>Changing this workbook clears the previous model from the active workspace.</small></div></div><div className="field-block"><Label htmlFor="sheetInput">Google Sheet URL or ID</Label><Input id="sheetInput" value={config.sheetInput} onChange={(e)=>selectWorkbook(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…/edit"/><small className={config.sheetInput&&!config.ssid?"field-error":"field-help"}>{config.sheetInput&&!config.ssid?"Paste a valid Google Sheets URL or spreadsheet ID.":config.ssid?`Workbook ID detected · ${config.ssid.slice(0,8)}…${config.ssid.slice(-5)} · mappings are isolated to this workbook`:"Paste the full URL from the Sheet you want to use."}</small></div></section><section className="connection-step"><div className="step-title"><span>2</span><div><strong>Secure connector</strong><small>Use the deployed web app URL ending in /exec, with access set to Anyone.</small></div></div><div className="field-block"><Label htmlFor="url">Apps Script web app URL</Label><Input id="url" value={config.url} onChange={(e)=>{setConfig((c)=>({...c,url:e.target.value.trim()}));setConnectionFeedback("")}} placeholder="https://script.google.com/macros/s/…/exec"/><small className={config.url&&!validScriptUrl(config.url)?"field-error":"field-help"}>{config.url&&!validScriptUrl(config.url)?"This must be the deployed /exec URL, not the editor or /dev URL.":"Deploy → Manage deployments → access: Anyone."}</small></div><div className="two-fields"><div className="field-block"><Label htmlFor="token">Secret token</Label><Input id="token" type="password" value={config.token} onChange={(e)=>{setConfig((c)=>({...c,token:e.target.value}));setConnectionFeedback("")}} placeholder="Enter token"/></div><div className="field-block"><Label htmlFor="scale">Fallback unit scale</Label><Select value={String(config.scale)} onValueChange={(v)=>setConfig((c)=>({...c,scale:Number(v)}))}><SelectTrigger id="scale"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="1">As stored · 1</SelectItem><SelectItem value="0.001">Thousands</SelectItem><SelectItem value="0.00001">Lakhs</SelectItem><SelectItem value="0.000001">Millions</SelectItem></SelectContent></Select></div></div></section>{connectionFeedback&&<div className={`connection-result ${connectionFeedback.startsWith("Connected")?"success":""}`}>{connectionFeedback}</div>}<div className="security-note"><strong>Workbook-specific profile</strong><span>Source sheets, detected lines, customer records and write-back cells are stored separately for each spreadsheet ID.</span></div></div><DialogFooter className="connect-footer"><Button variant="outline" onClick={testConnection} disabled={busy||!config.ssid||!config.url||!config.token}>{busy?"Checking…":"Test connection"}</Button><Button onClick={()=>scanModel(true)} disabled={scanBusy||!config.ssid||!validScriptUrl(config.url)||!config.token}>{scanBusy?"Scanning workbook…":"Save and scan workbook"}</Button></DialogFooter></DialogContent></Dialog>
  <Dialog open={writeOpen} onOpenChange={setWriteOpen}><DialogContent><DialogHeader><DialogTitle>Review write-back</DialogTitle><DialogDescription>Only mapped treasury assumptions that you changed will be written. Forecast and formula rows are never touched.</DialogDescription></DialogHeader><div className="write-review">{driverChanges.length+cashLeverChanges.length?null:<p>No changes to write.</p>}{driverChanges.map((key)=><div key={key}><span><b>{key.toUpperCase()}</b><small>{config.driverMappings[key]||"Not mapped"}</small></span><strong>{baselineDrivers[key]} to {drivers[key]} days</strong></div>)}{cashLeverChanges.map((lever)=><div key={lever.id}><span><b>{lever.label}</b><small>{lever.range||"Not mapped"}</small></span><strong>{lever.base} to {lever.value}</strong></div>)}{(driverChanges.some((key)=>!config.driverMappings[key])||cashLeverChanges.some((lever)=>!lever.range))&&<div className="warning">Unmapped assumptions will be skipped. Add their cells under Model mapping.</div>}</div><DialogFooter><Button variant="outline" onClick={()=>setWriteOpen(false)}>Cancel</Button><Button onClick={writeDrivers} disabled={busy||!(driverChanges.some((k)=>config.driverMappings[k])||cashLeverChanges.some((lever)=>lever.range))}>{busy?"Writing…":"Confirm write-back"}</Button></DialogFooter></DialogContent></Dialog></main>;
}
