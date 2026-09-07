"use client";

import { useMemo, useState } from "react";
import { CashRole, CollectionRecord, CustomCashLine, PaymentRecord, ScanResult, ScanRow, buildCashBridge, directDaysScheduleImpact, findRow, moduleLabels, paymentsForScan, roundDays, workingCapitalScheduleImpact } from "@/lib/treasury-model";

type CashBridgeOpts = { roles?: Record<string, CashRole>; openingId?: string; closingId?: string; customLines?: CustomCashLine[] };
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScanSearch } from "lucide-react";

const fmt = (n: number) => `${n < 0 ? "(" : ""}${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 1 })}${n < 0 ? ")" : ""}`;
const total = (a: number[], start: number, end: number) => a.slice(start, end + 1).reduce((s, x) => s + (x || 0), 0);
const monthIndex = (periods: string[], month: string) => periods.findIndex((period) => period === month);
const sourceRows = (scan: ScanResult, module: keyof ScanResult["sourceAssignments"], entity?: string) => {
  const sheet = scan.sourceAssignments[module];
  return scan.rows.filter((row) => row.sheet === sheet && (!entity || row.entity === entity));
};
const sourceEntities = (scan: ScanResult, module: keyof ScanResult["sourceAssignments"]) => [...new Set(sourceRows(scan,module).map((row)=>row.entity).filter(Boolean))];
const displayValue = (row: ScanRow, index: number) => {
  const raw=String(row.display[index]??"").trim(),value=row.values[index]??0;
  if (!raw || raw==="-" || raw==="—") return fmt(value);
  if (raw.includes("%")) return `${(value*100).toLocaleString("en-US",{maximumFractionDigits:1})}%`;
  if (/^[\s$€£₹+\-(),.\d]+$/.test(raw)) return fmt(value);
  return raw;
};

const accountKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const recordsToSeries = (records: (CollectionRecord | PaymentRecord)[], periods: string[]) => {
  const values = Array(periods.length).fill(0) as number[];
  records.forEach((record) => {
    const index = monthIndex(periods, record.expectedMonth || record.dueMonth);
    if (index >= 0) values[index] += Math.abs(record.amount) * (record.probability ?? 1);
  });
  return values;
};
const accountModelSeries = (scan: ScanResult, sheet: string, account: string, pattern: RegExp) => {
  const key = accountKey(account);
  return scan.rows.find((row) => row.sheet === sheet && accountKey(row.label) === key && pattern.test(`${row.section} ${row.label}`))?.values.map((value) => Math.abs(value));
};
const scoped = (values: number[], start: number, end: number) => values.map((value, index) => index >= start && index <= end ? value : 0);

export function Coverage({ scan, onScan, busy }: { scan: ScanResult | null; onScan: () => void; busy: boolean }) {
  return <section className="coverage"><div><span className="coverage-title">Model depth</span>{scan ? <><strong>{scan.modules.length} treasury modules detected</strong><small>{scan.sheets.length} tabs · {scan.periods.length} periods · {scan.rows.length} usable model lines</small></> : <><strong>Automatic model scan not run</strong><small>Scan the workbook to activate only the modules it contains.</small></>}</div><div className="module-chips">{(Object.keys(moduleLabels) as (keyof typeof moduleLabels)[]).map((id) => <span key={id} className={scan?.modules.includes(id) ? "found" : "missing"}>{moduleLabels[id]}<i>{scan?.modules.includes(id) ? "Found" : "Optional"}</i></span>)}</div><Button onClick={onScan} disabled={busy}><ScanSearch size={15}/>{busy ? "Scanning…" : scan ? "Scan again" : "Scan model"}</Button></section>;
}

function EntityPicker({ entities, value, onChange }: { entities: string[]; value: string; onChange: (v: string) => void }) {
  if (!entities.length) return null;
  return <Select value={entities.includes(value) ? value : entities[0]} onValueChange={onChange}><SelectTrigger className="entity-select"><SelectValue/></SelectTrigger><SelectContent>{entities.map((e) => <SelectItem value={e} key={e}>{e}</SelectItem>)}</SelectContent></Select>;
}

function FlowWaterfall({ rows, start, end, opts }: { rows: ScanRow[]; start: number; end: number; opts?: CashBridgeOpts }) {
  const all = buildCashBridge(rows,start,end,opts), opening=all[0]?.value??0;
  const bars=all.map((x,i)=>{if(i===0||x.total)return{...x,from:0,to:x.value};const from=opening+all.slice(1,i).filter((step)=>!step.total).reduce((sum,step)=>sum+step.value,0);return{...x,from,to:from+x.value}});const vals=bars.flatMap((b)=>[b.from,b.to,0]),lo=Math.min(...vals),hi=Math.max(...vals),span=hi-lo||1,W=Math.max(900,bars.length*92),bw=66,pad=30,gap=(W-pad*2-bw*bars.length)/Math.max(1,bars.length-1),y=(v:number)=>220-((v-lo)/span)*175;
  return <div className="waterfall-wrap"><svg viewBox={`0 0 ${W} 310`} role="img" aria-label="Granular cash waterfall from connected model"><line x1="20" y1={y(0)} x2={W-20} y2={y(0)} className="zero-line"/>{bars.map((b,i)=>{const x=pad+i*(bw+gap),yt=y(Math.max(b.from,b.to)),yb=y(Math.min(b.from,b.to));return <g key={`${b.name}-${i}`}><rect x={x} y={yt} width={bw} height={Math.max(3,yb-yt)} rx="5" className={b.total?"total":b.value>=0?"positive":"negative"}/><text x={x+bw/2} y={Math.max(18,yt-8)} textAnchor="middle" className="bar-value">{fmt(b.value)}</text><text x={x+bw/2} y="258" textAnchor="middle" className="bar-label"><tspan x={x+bw/2}>{b.name.split(" ").slice(0,2).join(" ")}</tspan>{b.name.split(" ").length>2&&<tspan x={x+bw/2} dy="12">{b.name.split(" ").slice(2).join(" ")}</tspan>}</text><title>{b.rows?.length?`${b.name}: ${b.rows.join(", ")}`:b.name}</title></g>})}</svg><div className="waterfall-note">Each cash-flow row is counted once. Debt drawdowns, repayments, interest, capex and operating cash are shown separately; any remaining difference is clearly labelled as reconciliation.</div></div>;
}

export function CashFlowModule({ scan, entity, setEntity, start, end, cashRows, bridgeOpts }: { scan: ScanResult; entity: string; setEntity: (v:string)=>void; start:number; end:number; cashRows?: ScanRow[]; bridgeOpts?: CashBridgeOpts }) {
  const entities=sourceEntities(scan,"cashFlow"),active=entities.includes(entity)?entity:entities[0]||"Group",autoRows=sourceRows(scan,"cashFlow",active);
  // When the user has curated the cash-flow lines, build the waterfall from that
  // curated set (which can span the whole workbook, e.g. a P&L); otherwise use the auto-detected cash tab.
  const curated=!!(bridgeOpts&&bridgeOpts.roles),rows=curated&&cashRows&&cashRows.length?cashRows:autoRows,unit=rows[0]?.unit||rows[0]?.currency||"Model units";
  const bridge=buildCashBridge(rows,start,end,curated?bridgeOpts:undefined),opening=bridge[0]?.value??0,closing=bridge[bridge.length-1]?.value??0,change=closing-opening;
  return <div className="module-stack"><section className="panel chart-panel"><div className="panel-head"><div><p className="eyebrow">Direct-method cash flow</p><h2>{active} · {unit}</h2></div>{!curated&&<EntityPicker entities={entities} value={active} onChange={setEntity}/>}</div><div className="module-kpis"><div><span>Opening cash</span><strong>{fmt(opening)}</strong></div><div><span>Net movement</span><strong className={change>=0?"good":"bad"}>{fmt(change)}</strong></div><div><span>Closing cash</span><strong>{fmt(closing)}</strong></div></div><FlowWaterfall rows={rows} start={start} end={end} opts={curated?bridgeOpts:undefined}/></section></div>;
}

function addMonths(label: string, months: number) {
  const month = label.match(/jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i)?.[0] || "Jan";
  const yearText = label.match(/\d{2,4}/)?.[0] || "26";
  const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
  const date = new Date(Date.UTC(year, ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(month.toLowerCase().slice(0,3)), 1));
  if (Number.isNaN(date.getTime())) return label;
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
}

function collectionImpact(records: CollectionRecord[], periods: string[], delayMonths: number, discountPct: number, annualRate: number) {
  const base = Array(periods.length).fill(0) as number[], scenario = Array(periods.length).fill(0) as number[];
  let amount = 0, movedEarlier = 0, movedLater = 0, discountCost = 0, financingBenefit = 0;
  records.forEach((record) => {
    const weighted = record.amount * (record.probability ?? 1), baseMonth = record.expectedMonth || record.dueMonth, newMonth = addMonths(baseMonth, delayMonths);
    const baseIndex = monthIndex(periods, baseMonth), scenarioIndex = monthIndex(periods, newMonth);
    amount += weighted;
    if (baseIndex >= 0) base[baseIndex] += weighted;
    if (scenarioIndex >= 0) scenario[scenarioIndex] += weighted * (1 - discountPct);
    discountCost += weighted * discountPct;
    const daysMoved = -delayMonths * 30.4;
    if (daysMoved > 0) { movedEarlier += weighted; financingBenefit += weighted * annualRate * daysMoved / 365; }
    if (daysMoved < 0) movedLater += weighted;
  });
  return { amount, movedEarlier, movedLater, discountCost, financingBenefit, netBenefit: financingBenefit - discountCost, impact: scenario.map((v, i) => v - base[i]) };
}

function CollectionsChart({ periods, values, label="Cash impact" }: { periods: string[]; values: number[]; label?: string }) {
  const visible = periods.map((period, index) => ({ period, value: Number.isFinite(values[index]) ? values[index] : 0 }));
  if (!visible.some((x) => Math.abs(x.value) > .01)) return <div className="empty-module compact"><h2>No monthly shift yet</h2><p>Change collection timing or discount to see the cash impact.</p></div>;
  const H=260,pad=32,barW=48,W=Math.max(760,pad*2+visible.length*(barW+14)),gap=(W-pad*2-barW*visible.length)/Math.max(1,visible.length-1),max=Math.max(...visible.map((x)=>Math.abs(x.value)),1),y0=H/2;
  return <div className="collection-chart"><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} by month`}><line x1={pad} y1={y0} x2={W-pad} y2={y0} className="zero-line"/>{visible.map((item,index)=>{const h=Math.max(4,Math.abs(item.value)/max*(H/2-42)),x=pad+index*(barW+gap),y=item.value>=0?y0-h:y0;return <g key={`${item.period}-${index}`}><rect x={x} y={y} width={barW} height={h} rx="5" className={item.value>=0?"positive":"negative"}/><text x={x+barW/2} y={item.value>=0?y-8:y+h+16} textAnchor="middle" className="bar-value">{fmt(item.value)}</text><text x={x+barW/2} y={H-14} textAnchor="middle" className="bar-label">{item.period}</text></g>})}</svg></div>;
}

export function CustomerCollectionsModule({ scan, start, end, onWriteDriver }: { scan: ScanResult; start: number; end: number; onWriteDriver?: (range:string,value:number)=>void }) {
  const records = scan.collections, customers = useMemo(() => [...new Set(scan.collections.map((record) => record.customer))], [scan.collections]);
  const [customer,setCustomer]=useState(customers[0]||"");
  const [delay,setDelay]=useState(0), [discount,setDiscount]=useState(0);
  const [customerDso,setCustomerDso]=useState<Record<string,number>>({});
  const active = customers.includes(customer) ? customer : customers[0] || "";
  const selected = active ? records.filter((record) => record.customer === active) : records;
  const accountSchedule = selected.some((record) => record.sourceKind === "account_schedule");
  const baseDsoExact = selected.find((record) => record.driverValue !== undefined)?.driverValue || 0;
  const baseDso = roundDays(baseDsoExact);
  const scenarioDso = roundDays(customerDso[active] ?? baseDso);
  const effectiveDelay = delay;
  // A discount is an early-payment incentive. Do not silently charge it when
  // the scenario leaves timing unchanged or delays a receipt.
  const discountEligible = accountSchedule ? scenarioDso < baseDso : effectiveDelay < 0;
  const appliedDiscount = discountEligible ? discount / 100 : 0;
  const periodRecords = selected.filter((record) => { const i=monthIndex(scan.periods,record.expectedMonth||record.dueMonth); return i < 0 || (i >= start && i <= end); });
  const baseSeries = recordsToSeries(selected, scan.periods);
  const activitySeries = accountSchedule
    ? accountModelSeries(scan, selected[0]?.sheet || "", active, /billings|sales|revenue|invoices? raised|credit sales/i) || baseSeries
    : baseSeries;
  const rollForward = accountSchedule ? directDaysScheduleImpact({
    baseCash: baseSeries,
    activity: activitySeries,
    baseDays: baseDsoExact,
    scenarioDays: scenarioDso,
    discountPct: appliedDiscount,
  }) : null;
  const invoiceImpact = collectionImpact(periodRecords, scan.periods, effectiveDelay, appliedDiscount, 0);
  const endCashImpact = rollForward ? total(rollForward.grossSettlement.map((value,index)=>value-rollForward.baseCash[index]),start,end) : total(invoiceImpact.impact,start,end)+invoiceImpact.discountCost;
  const discountCost = rollForward ? total(rollForward.grossSettlement, start, end) - total(rollForward.scenarioCash, start, end) : invoiceImpact.discountCost;
  const impact = rollForward ? {
    amount: total(baseSeries, start, end),
    movedEarlier: Math.max(0, endCashImpact),
    movedLater: Math.max(0, -endCashImpact),
    discountCost,
    financingBenefit: 0,
    netBenefit: endCashImpact - discountCost,
    impact: scoped(rollForward.cashImpact, start, end),
  } : {...invoiceImpact,netBenefit:endCashImpact-discountCost};
  const topCustomers = customers.map((name) => ({ name, amount: records.filter((record) => record.customer === name).reduce((s, record) => s + record.amount * (record.probability ?? 1), 0) })).sort((a,b)=>b.amount-a.amount).slice(0,8);
  if (!records.length) return <section className="panel empty-module"><h2>Customer collections are optional</h2><p>If your model has customer, invoice, due date, expected collection date and amount columns, this tab will activate automatically. If not, treasury still works from cash flow, AR/AP or DSO.</p></section>;
  const driverCell=selected.find((record)=>record.driverCell)?.driverCell;
  return <section className="panel collections-panel">
    <div className="panel-head"><div><p className="eyebrow">Account-level collections</p><h2>Change one customer without changing everyone else</h2><p>{accountSchedule?"Account-by-month schedule detected. Each month is recalculated directly from the customer DSO and compared with its base value.":"Invoice-level data detected. Model timing and early-payment discounts by customer."}</p></div><Select value={active} onValueChange={setCustomer}><SelectTrigger className="entity-select"><SelectValue/></SelectTrigger><SelectContent>{customers.map((name)=><SelectItem value={name} key={name}>{name}</SelectItem>)}</SelectContent></Select></div>
    <div className="collections-grid"><aside className="collection-controls">
      {accountSchedule?<div><Label>Customer DSO</Label><strong>{scenarioDso} days · base {baseDso}</strong><Slider min={0} max={180} step={1} value={[scenarioDso]} onValueChange={([value])=>setCustomerDso((current)=>({...current,[active]:value}))}/>{driverCell&&onWriteDriver&&<Button size="sm" onClick={()=>onWriteDriver(driverCell,scenarioDso)} disabled={scenarioDso===baseDso}>Write customer DSO</Button>}</div>:<div><Label>Collection timing</Label><strong>{delay>0?`${delay} month delay`:delay<0?`${Math.abs(delay)} month earlier`:"No timing change"}</strong><Slider min={-3} max={6} step={1} value={[delay]} onValueChange={([v])=>setDelay(v)}/></div>}
      <div><Label>Early payment discount</Label><div className="inline-input"><Input type="number" min="0" max="50" step=".25" value={discount} onChange={(e)=>setDiscount(Number(e.target.value)||0)}/><span>%</span></div>{discount>0&&!discountEligible&&<small>Applied only when collection timing is brought forward.</small>}</div>
      <div className="collection-kpis"><div><span>Total period impact</span><strong className={endCashImpact>=0?"good":"bad"}>{fmt(endCashImpact)}</strong></div><div><span>Discount cost</span><strong className="bad">{fmt(impact.discountCost)}</strong></div><div><span>Net benefit</span><strong className={impact.netBenefit>=0?"good":"bad"}>{fmt(impact.netBenefit)}</strong></div></div>
    </aside><div><CollectionsChart periods={scan.periods.slice(start,end+1)} values={impact.impact.slice(start,end+1)} label="Monthly collection cash impact versus base"/><div className="collection-summary"><span>{accountSchedule?`${fmt(endCashImpact)} cumulative cash impact at ${scan.periods[end]}`:`${fmt(impact.movedEarlier)} accelerated`}</span><span>{accountSchedule?"No cash is dropped at the forecast boundary":`${fmt(impact.movedLater)} delayed`}</span><span>{periodRecords.length} records in the selected period</span></div></div></div>
    <div className="table-scroll model-table"><Table><TableHeader><TableRow><TableHead className="sticky-col">{accountSchedule?"Month":"Customer / invoice"}</TableHead><TableHead>{accountSchedule?"Base collection":"Expected"}</TableHead><TableHead>{accountSchedule?"Scenario collection":"Scenario"}</TableHead><TableHead className="number">{accountSchedule?"Cash impact":"Amount"}</TableHead><TableHead className="number">{accountSchedule?"Cumulative":"Probability"}</TableHead><TableHead>Write-back cell</TableHead></TableRow></TableHeader><TableBody>{accountSchedule&&rollForward?scan.periods.slice(start,end+1).map((period,offset)=>{const index=start+offset;return <TableRow key={period}><TableCell className="sticky-col"><b>{period}</b><small>{active}</small></TableCell><TableCell>{fmt(rollForward.baseCash[index])}</TableCell><TableCell>{fmt(rollForward.scenarioCash[index])}</TableCell><TableCell className="number">{fmt(rollForward.cashImpact[index])}</TableCell><TableCell className="number">{fmt(rollForward.cumulativeImpact[index])}</TableCell><TableCell><small>{driverCell||"Preview only"}</small></TableCell></TableRow>}):periodRecords.slice(0,40).map((record)=><TableRow key={record.id}><TableCell className="sticky-col"><b>{record.customer}</b><small>{record.invoice||record.sheet}</small></TableCell><TableCell>{record.expectedMonth||record.dueMonth}</TableCell><TableCell>{addMonths(record.expectedMonth||record.dueMonth,effectiveDelay)}</TableCell><TableCell className="number">{fmt(record.amount)}</TableCell><TableCell className="number">{record.probability===undefined?"Optional":`${(record.probability*100).toFixed(0)}%`}</TableCell><TableCell><small>{record.driverCell||record.dateCell||"Preview only"}{record.discountCell?` · ${record.discountCell}`:""}</small></TableCell></TableRow>)}</TableBody></Table></div>
    <div className="top-customers"><strong>Largest detected customers</strong>{topCustomers.map((item)=><button key={item.name} onClick={()=>setCustomer(item.name)} className={item.name===active?"on":""}><span>{item.name}</span><b>{fmt(item.amount)}</b></button>)}</div>
  </section>;
}

function paymentImpact(records: PaymentRecord[], periods: string[], delayMonths: number, discountPct: number, annualRate: number) {
  const base = Array(periods.length).fill(0) as number[], scenario = Array(periods.length).fill(0) as number[];
  let amount = 0, movedEarlier = 0, movedLater = 0, discountBenefit = 0, financingCost = 0;
  records.forEach((record) => {
    const weighted = record.amount * (record.probability ?? 1), baseMonth = record.expectedMonth || record.dueMonth, newMonth = addMonths(baseMonth, delayMonths);
    const baseIndex = monthIndex(periods, baseMonth), scenarioIndex = monthIndex(periods, newMonth);
    amount += weighted;
    if (baseIndex >= 0) base[baseIndex] -= weighted;
    if (scenarioIndex >= 0) scenario[scenarioIndex] -= weighted * (1 - discountPct);
    discountBenefit += weighted * discountPct;
    const daysMoved = -delayMonths * 30.4;
    if (daysMoved > 0) { movedEarlier += weighted; financingCost += weighted * annualRate * daysMoved / 365; }
    if (daysMoved < 0) movedLater += weighted;
  });
  return { amount, movedEarlier, movedLater, discountBenefit, financingCost, netBenefit: discountBenefit - financingCost, impact: scenario.map((value, index) => value - base[index]) };
}

export function SupplierPaymentsModule({ scan, start, end, onWriteDriver }: { scan: ScanResult; start: number; end: number; onWriteDriver?: (range:string,value:number)=>void }) {
  const records = paymentsForScan(scan), suppliers = [...new Set(records.map((record) => record.supplier))];
  const [supplier,setSupplier]=useState(suppliers[0]||"");
  const [delay,setDelay]=useState(0), [discount,setDiscount]=useState(0), [annualRate,setAnnualRate]=useState(14);
  const [supplierDpo,setSupplierDpo]=useState<Record<string,number>>({});
  const active=suppliers.includes(supplier)?supplier:suppliers[0]||"", selected=active?records.filter((record)=>record.supplier===active):records;
  const accountSchedule=selected.some((record)=>record.sourceKind==="account_schedule"), baseDpo=roundDays(selected.find((record)=>record.driverValue!==undefined)?.driverValue||0);
  const scenarioDpo=roundDays(supplierDpo[active]??baseDpo), effectiveDelay=delay;
  // Supplier discounts only apply when the business actually pays earlier.
  const discountEligible=accountSchedule?scenarioDpo<baseDpo:effectiveDelay<0;
  const appliedDiscount=discountEligible?discount/100:0;
  const periodRecords=selected.filter((record)=>{const i=monthIndex(scan.periods,record.expectedMonth||record.dueMonth);return i<0||(i>=start&&i<=end)});
  const baseSeries=recordsToSeries(selected,scan.periods);
  const activitySeries=accountSchedule
    ? accountModelSeries(scan,selected[0]?.sheet||"",active,/purchases|procurement|cost of goods|cogs|supplier invoices?|materials/i)||baseSeries
    : baseSeries;
  const baseClosingSeries=accountSchedule
    ? accountModelSeries(scan,selected[0]?.sheet||"",active,/closing payables?|closing ap|accounts payable/i)
    : undefined;
  const rollForward=accountSchedule?workingCapitalScheduleImpact({baseCash:baseSeries,activity:activitySeries,baseClosing:baseClosingSeries,baseDays:baseDpo,scenarioDays:scenarioDpo,kind:"payments",discountPct:appliedDiscount}):null;
  const invoiceImpact=paymentImpact(periodRecords,scan.periods,effectiveDelay,appliedDiscount,annualRate/100);
  const endCashImpact=rollForward?.cumulativeImpact[end]??0;
  const selectedActivity=total(activitySeries,start,end);
  const discountBenefit=rollForward?total(rollForward.grossSettlement,start,end)-total(rollForward.scenarioCash,start,end):invoiceImpact.discountBenefit;
  const financingCost=rollForward?selectedActivity*(annualRate/100)*(baseDpo-scenarioDpo)/365:invoiceImpact.financingCost;
  const impact=rollForward?{amount:total(baseSeries,start,end),movedEarlier:Math.max(0,-endCashImpact),movedLater:Math.max(0,endCashImpact),discountBenefit,financingCost,netBenefit:discountBenefit-financingCost,impact:scoped(rollForward.cashImpact,start,end)}:invoiceImpact;
  const topSuppliers=suppliers.map((name)=>({name,amount:records.filter((record)=>record.supplier===name).reduce((sum,record)=>sum+record.amount*(record.probability??1),0)})).sort((a,b)=>b.amount-a.amount).slice(0,8);
  if(!records.length)return <section className="panel empty-module"><h2>Supplier-level payments are optional</h2><p>Map a creditor or payables tab to activate invoice-level or supplier-by-month analysis. The rest of treasury continues to work without it.</p></section>;
  const driverCell=selected.find((record)=>record.driverCell)?.driverCell;
  return <section className="panel collections-panel">
    <div className="panel-head"><div><p className="eyebrow">Supplier-level payments</p><h2>Change one creditor without changing everyone else</h2><p>{accountSchedule?"Supplier-by-month schedule detected. DPO changes use an AP roll-forward, with no whole-month rounding.":"Invoice-level payable data detected. Model settlement timing and early-payment discounts by supplier."}</p></div><Select value={active} onValueChange={setSupplier}><SelectTrigger className="entity-select"><SelectValue/></SelectTrigger><SelectContent>{suppliers.map((name)=><SelectItem value={name} key={name}>{name}</SelectItem>)}</SelectContent></Select></div>
    <div className="collections-grid"><aside className="collection-controls">
      {accountSchedule?<div><Label>Supplier DPO</Label><strong>{scenarioDpo} days · base {baseDpo}</strong><Slider min={0} max={180} step={1} value={[scenarioDpo]} onValueChange={([value])=>setSupplierDpo((current)=>({...current,[active]:value}))}/>{driverCell&&onWriteDriver&&<Button size="sm" onClick={()=>onWriteDriver(driverCell,scenarioDpo)} disabled={scenarioDpo===baseDpo}>Write supplier DPO</Button>}</div>:<div><Label>Payment timing</Label><strong>{delay>0?`${delay} month delay`:delay<0?`${Math.abs(delay)} month earlier`:"No timing change"}</strong><Slider min={-3} max={6} step={1} value={[delay]} onValueChange={([value])=>setDelay(value)}/></div>}
      <div><Label>Early payment discount</Label><div className="inline-input"><Input type="number" min="0" max="50" step=".25" value={discount} onChange={(e)=>setDiscount(Number(e.target.value)||0)}/><span>%</span></div>{discount>0&&!discountEligible&&<small>Applied only when supplier payment timing is brought forward.</small>}</div>
      <div><Label>Cost of lending / borrowing</Label><div className="inline-input"><Input type="number" min="0" max="60" step=".25" value={annualRate} onChange={(e)=>setAnnualRate(Number(e.target.value)||0)}/><span>% p.a.</span></div></div>
      <div className="collection-kpis"><div><span>{accountSchedule?"End-period cash impact":"Selected payments"}</span><strong className={endCashImpact>=0?"good":"bad"}>{fmt(accountSchedule?endCashImpact:impact.amount)}</strong></div><div><span>Discount benefit</span><strong className="good">{fmt(impact.discountBenefit)}</strong></div><div><span>{impact.financingCost<0?"Funding benefit":"Funding cost"}</span><strong className={impact.financingCost<=0?"good":"bad"}>{fmt(Math.abs(impact.financingCost))}</strong></div><div><span>Net benefit</span><strong className={impact.netBenefit>=0?"good":"bad"}>{fmt(impact.netBenefit)}</strong></div></div>
    </aside><div><CollectionsChart periods={scan.periods.slice(start,end+1)} values={impact.impact.slice(start,end+1)} label="Monthly supplier-payment cash impact versus base"/><div className="collection-summary"><span>{accountSchedule?`${fmt(endCashImpact)} cumulative cash impact at ${scan.periods[end]}`:`${fmt(impact.movedEarlier)} paid earlier`}</span><span>{accountSchedule?"No cash is dropped at the forecast boundary":`${fmt(impact.movedLater)} delayed`}</span><span>{periodRecords.length} records in the selected period</span></div></div></div>
    <div className="table-scroll model-table"><Table><TableHeader><TableRow><TableHead className="sticky-col">{accountSchedule?"Month":"Supplier / invoice"}</TableHead><TableHead>{accountSchedule?"Base payment":"Expected"}</TableHead><TableHead>{accountSchedule?"Scenario payment":"Scenario"}</TableHead><TableHead className="number">{accountSchedule?"Cash impact":"Amount"}</TableHead><TableHead className="number">{accountSchedule?"Cumulative":"Probability"}</TableHead><TableHead>Write-back cell</TableHead></TableRow></TableHeader><TableBody>{accountSchedule&&rollForward?scan.periods.slice(start,end+1).map((period,offset)=>{const index=start+offset;return <TableRow key={period}><TableCell className="sticky-col"><b>{period}</b><small>{active}</small></TableCell><TableCell>{fmt(rollForward.baseCash[index])}</TableCell><TableCell>{fmt(rollForward.scenarioCash[index])}</TableCell><TableCell className="number">{fmt(rollForward.cashImpact[index])}</TableCell><TableCell className="number">{fmt(rollForward.cumulativeImpact[index])}</TableCell><TableCell><small>{driverCell||"Preview only"}</small></TableCell></TableRow>}):periodRecords.slice(0,40).map((record)=><TableRow key={record.id}><TableCell className="sticky-col"><b>{record.supplier}</b><small>{record.invoice||record.sheet}</small></TableCell><TableCell>{record.expectedMonth||record.dueMonth}</TableCell><TableCell>{addMonths(record.expectedMonth||record.dueMonth,effectiveDelay)}</TableCell><TableCell className="number">{fmt(record.amount)}</TableCell><TableCell className="number">{record.probability===undefined?"Optional":`${(record.probability*100).toFixed(0)}%`}</TableCell><TableCell><small>{record.driverCell||record.dateCell||"Preview only"}{record.discountCell?` · ${record.discountCell}`:""}</small></TableCell></TableRow>)}</TableBody></Table></div>
    <div className="top-customers"><strong>Largest detected suppliers</strong>{topSuppliers.map((item)=><button key={item.name} onClick={()=>setSupplier(item.name)} className={item.name===active?"on":""}><span>{item.name}</span><b>{fmt(item.amount)}</b></button>)}</div>
  </section>;
}

export function WorkingCapitalModule({ scan, entity, setEntity, end }: { scan: ScanResult; entity:string; setEntity:(v:string)=>void; end:number }) {
  const relevant=scan.rows.filter((row)=>/(dso|dpo|dio|debtor days|creditor days|inventory days|receivable|payable|working capital|collections|supplier payments)/i.test(`${row.label} ${row.section} ${row.sheet}`));
  const entities=[...new Set(relevant.map((row)=>row.entity).filter(Boolean))],active=entities.includes(entity)?entity:entities[0]||"Group";
  const rows=relevant.filter((row)=>row.entity===active||entities.length===1);
  const selected=rows.filter((r)=>/(dso|dpo|dio|closing ar|closing ap|closing inventory|collections|supplier payments|deferred revenue|prepaid|bonus paid)/i.test(r.label));
  return <section className="panel table-panel"><div className="panel-head"><div><p className="eyebrow">Working-capital book</p><h2>{active} · detected receivables, payables and timing items</h2></div><EntityPicker entities={entities} value={active} onChange={setEntity}/></div><div className="metric-cards">{[["DSO",findRow(rows,["dso"])],["DPO",findRow(rows,["dpo"])],["DIO",findRow(rows,["dio"])],["Closing AR",findRow(rows,["closing ar"])],["Closing AP",findRow(rows,["closing ap"])]].map(([name,row])=><div key={String(name)}><span>{String(name)}</span><strong>{row&&typeof row!=="string"?fmt(row.values[end]??0):"Not found"}</strong></div>)}</div><ModuleTable rows={selected} periods={scan.periods} /></section>;
}

export function DetectedScheduleModule({ scan }: { scan: ScanResult }) {
  const rows=scan.rows.filter((row)=>row.values.length&&row.display.some((value)=>value!==""&&value!=="-"&&value!=="—")).slice(0,80);
  return <section className="panel table-panel"><div className="panel-head"><div><p className="eyebrow">Connected model schedule</p><h2>Detected lines from the selected source sheets</h2><p>Values below come directly from the workbook. Demo calculations are not mixed into a connected model.</p></div></div><ModuleTable rows={rows} periods={scan.periods}/></section>;
}

export function DebtModule({ scan, start, end }: { scan: ScanResult; start:number; end:number }) {
  const rows=sourceRows(scan,"debt"),instrumentPattern=/①|②|③|④|⑤|⑥|term loan|revolver|revolving facility|overdraft|credit facility|lease|bond|note|debenture/i;
  let sections=[...new Set(rows.map((r)=>r.section).filter((section)=>instrumentPattern.test(section)))];
  if(!sections.length&&rows.length)sections=[...new Set(rows.filter((row)=>/closing balance|closing drawn|outstanding/i.test(row.label)).map((row)=>row.section).filter(Boolean))];
  const instrumentRows=sections.flatMap((section)=>rows.filter((row)=>row.section===section)),usedRows=instrumentRows.length?instrumentRows:rows;
  const matches=(pattern:RegExp)=>usedRows.filter((row)=>pattern.test(row.label));
  const balances=matches(/closing balance|closing drawn|closing debt|debt outstanding|outstanding principal/i),draws=matches(/drawdown|facility draw|new borrowing|loan proceeds|debt proceeds/i),repayments=matches(/principal repayment|loan repayment|debt repayment|^repayment$|amorti[sz]ation/i),interest=matches(/^(?!.*rate).*interest|cash interest|interest paid|interest expense|commitment fee/i);
  // The direct cash-flow statement is the authoritative source for cash
  // interest when available. This also protects the dashboard from a debt
  // schedule row that is accidentally linked to principal instead of interest.
  const directInterest=sourceRows(scan,"cashFlow").filter((row)=>/interest(?!.*rate)|commitment fee/i.test(row.label)&&!/subtotal|total debt service/i.test(row.label));
  const effectiveInterest=directInterest.length?directInterest:interest;
  const interestForSection=(section:string,block:ScanRow[])=>{
    const instrument=/revolver|revolving|facility/i.test(section)?/revolver|revolving|facility/i:/term loan|loan/i;
    const direct=directInterest.filter((row)=>instrument.test(`${row.label} ${row.section}`));
    return direct.length?direct:block.filter((row)=>/^(?!.*rate).*interest|cash interest|interest paid|interest expense|commitment fee/i.test(row.label));
  };
  const periodAmount=(matched:ScanRow[])=>matched.reduce((sum,row)=>sum+Math.abs(total(row.values,start,end)),0),at=(matched:ScanRow[],index:number)=>matched.reduce((sum,row)=>sum+Math.abs(row.values[index]||0),0);
  const summary=[["Closing debt",at(balances,end),"Balance at period end"],["Drawdowns",periodAmount(draws),"New funding in selected period"],["Principal repaid",periodAmount(repayments),"Debt reduction in selected period"],["Interest & fees",periodAmount(effectiveInterest),"Cash cost in selected period"]] as [string,number,string][];
  const timelineRows=[{label:"Drawdowns",rows:draws,className:"good"},{label:"Principal repayments",rows:repayments,className:"bad"},{label:"Interest & fees",rows:effectiveInterest,className:"bad"},{label:"Closing debt",rows:balances,className:""}];
  return <section className="panel table-panel debt-panel">
    <div className="panel-head"><div><p className="eyebrow">Debt portfolio</p><h2>{sections.length||1} {(sections.length||1)===1?"instrument":"instruments"} · complete selected-period view</h2><p>Drawdowns are separated from repayments and interest so the cash impact is easy to trace.</p></div></div>
    <div className="debt-summary">{summary.map(([label,value,help])=><div key={label}><span>{label}</span><strong>{fmt(value)}</strong><small>{help}</small></div>)}</div>
    <div className="debt-grid">{(sections.length?sections:["Debt schedule"]).map((section)=>{
      const block=sections.length?rows.filter((r)=>r.section===section):rows;
      const balance=findRow(block,["closing balance"])||findRow(block,["closing drawn"])||findRow(block,["outstanding"]);
      const sectionInterest=interestForSection(section,block);
      const principal=block.filter((r)=>/principal repayment|loan repayment|debt repayment|^repayment$|amorti[sz]ation/i.test(r.label));
      const draw=block.filter((r)=>/drawdown|facility draw|new borrowing|loan proceeds/i.test(r.label));
      return <article key={section}><span>{section.replace(/^[①②③④⑤⑥]\s*/,"")}</span><strong>{balance?fmt(balance.values[end]??0):"—"}</strong><small>Closing balance · {block[0]?.currency||"model currency"}</small><dl><dt>Drawdowns</dt><dd className="good">{fmt(periodAmount(draw))}</dd><dt>Principal</dt><dd>{fmt(periodAmount(principal))}</dd><dt>Interest & fees</dt><dd>{fmt(periodAmount(sectionInterest))}</dd></dl></article>;
    })}</div>
    <div className="debt-timeline"><h3>Monthly debt schedule</h3><div className="table-scroll model-table"><Table><TableHeader><TableRow><TableHead className="sticky-col">Movement</TableHead>{scan.periods.slice(start,end+1).map((period)=><TableHead className="number" key={period}>{period}</TableHead>)}</TableRow></TableHeader><TableBody>{timelineRows.map((item)=><TableRow key={item.label}><TableCell className="sticky-col"><b>{item.label}</b></TableCell>{scan.periods.slice(start,end+1).map((period,offset)=><TableCell className={`number ${item.className}`} key={period}>{fmt(at(item.rows,start+offset))}</TableCell>)}</TableRow>)}</TableBody></Table></div></div>
  </section>;
}

export function LiquidityModule({ scan, end }: { scan: ScanResult; end:number }) {
  const entities=sourceEntities(scan,"liquidity");
  return <section className="panel table-panel"><div className="panel-head"><div><p className="eyebrow">Liquidity by entity</p><h2>Available cash, restrictions and minimum-balance headroom</h2></div></div><div className="liquidity-grid">{entities.map((entity)=>{const rows=sourceRows(scan,"liquidity",entity),available=findRow(rows,["available"]),restricted=findRow(rows,["restricted"]),headroom=findRow(rows,["headroom"]),status=findRow(rows,["status"]),h=headroom?.values[end]??0,rawStatus=status?.display[end]|| (h<0?"BREACH":"OK");return <article key={entity} className={h<0?"breach":"ok"}><div><strong>{entity}</strong><span>{rows[0]?.currency} 000s</span></div><dl><dt>Available cash</dt><dd>{available?fmt(available.values[end]??0):"—"}</dd><dt>Restricted</dt><dd>{restricted?fmt(restricted.values[end]??0):"—"}</dd><dt>Headroom</dt><dd>{fmt(h)}</dd></dl><b>{rawStatus}</b></article>})}</div></section>;
}

export function CovenantsModule({ scan, end }: { scan: ScanResult; end:number }) {
  const rows=sourceRows(scan,"covenants"),metrics=rows.filter((r)=>/^(leverage:|interest cover:|dscr:)/i.test(r.label));
  return <section className="panel table-panel"><div className="panel-head"><div><p className="eyebrow">Covenant monitoring</p><h2>Live tests from the connected debt model</h2></div></div><div className="covenant-grid">{metrics.map((metric)=>{const i=rows.indexOf(metric),limit=rows.slice(i+1,i+3).find((r)=>/covenant/i.test(r.label)),test=rows.slice(i+1,i+4).find((r)=>/test/i.test(r.label)),status=test?.display[end]||"—";return <article key={metric.id}><span>{metric.label.split(":")[0]}</span><strong>{metric.display[end]||fmt(metric.values[end]??0)}</strong><small>Limit {limit?.display[end]||"—"}</small><b className={/breach/i.test(status)?"bad":"good"}>{status}</b></article>})}</div></section>;
}

function ModuleTable({ rows, periods }: { rows: ScanRow[]; periods: string[] }) {
  return <div className="table-scroll model-table"><Table><TableHeader><TableRow><TableHead className="sticky-col">Line</TableHead>{periods.map((m)=><TableHead className="number" key={m}>{m}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((r)=><TableRow key={r.id}><TableCell className="sticky-col"><b>{r.label}</b><small>{r.sheet}</small></TableCell>{periods.map((m,i)=><TableCell className="number" title={String(r.display[i]??"")} key={m}>{displayValue(r,i)}</TableCell>)}</TableRow>)}</TableBody></Table></div>;
}
