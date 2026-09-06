"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, MinusCircle, Plus, RotateCcw, Search, Trash2, Waves } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buildCashBridge, type CashRole, type CustomCashLine, type ScanRow } from "@/lib/treasury-model";

type Props = {
  rows: ScanRow[];          // candidate cash lines (assumptions/ratios already filtered out)
  balanceRows: ScanRow[];   // rows eligible to be opening/closing cash balances
  periods: string[];
  start: number;
  end: number;
  roles: Record<string, CashRole>;
  openingId: string;        // "" = none (start from zero)
  closingId: string;        // "" = derive from the movements
  customLines: CustomCashLine[];
  money: (n: number) => string;
  onSetRole: (id: string, role: CashRole) => void;
  onSetOpening: (id: string) => void;
  onSetClosing: (id: string) => void;
  onAddCustom: () => void;
  onUpdateCustom: (id: string, patch: Partial<CustomCashLine>) => void;
  onRemoveCustom: (id: string) => void;
  onResetDefaults: () => void;
};

const NONE = "__none__";

function rowTotal(row: ScanRow, start: number, end: number) {
  return row.values.slice(start, end + 1).reduce((sum, v) => sum + (v || 0), 0);
}

function RoleToggle({ role, onChange, id }: { role: CashRole; onChange: (role: CashRole) => void; id: string }) {
  const options: Array<{ key: CashRole; label: string; icon: ReactNode }> = [
    { key: "in", label: "Money in", icon: <ArrowUpRight size={14} /> },
    { key: "out", label: "Money out", icon: <ArrowDownRight size={14} /> },
    { key: "ignore", label: "Ignore", icon: <MinusCircle size={14} /> },
  ];
  return (
    <div className="cfe-toggle" role="group" aria-label={`Role for ${id}`}>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className={`cfe-toggle-btn ${option.key} ${role === option.key ? "active" : ""}`}
          aria-pressed={role === option.key}
          onClick={() => onChange(option.key)}
        >
          {option.icon}<span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

function MiniWaterfall({ steps, money }: { steps: { name: string; value: number; total?: boolean }[]; money: (n: number) => string }) {
  const opening = steps[0]?.value ?? 0;
  const bars = steps.map((step, index) => {
    if (index === 0 || step.total) return { ...step, from: 0, to: step.value };
    const from = opening + steps.slice(1, index).filter((s) => !s.total).reduce((sum, s) => sum + s.value, 0);
    return { ...step, from, to: from + step.value };
  });
  const vals = bars.flatMap((b) => [b.from, b.to, 0]);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const W = Math.max(560, bars.length * 78), bw = 54, pad = 26, gap = (W - pad * 2 - bw * bars.length) / Math.max(1, bars.length - 1);
  const y = (v: number) => 150 - ((v - lo) / span) * 120;
  return (
    <div className="cfe-preview-chart">
      <svg viewBox={`0 0 ${W} 210`} role="img" aria-label="Cash waterfall preview">
        <line x1="16" y1={y(0)} x2={W - 16} y2={y(0)} className="cfe-zero" />
        {bars.map((b, i) => {
          const x = pad + i * (bw + gap), yt = y(Math.max(b.from, b.to)), yb = y(Math.min(b.from, b.to));
          return (
            <g key={`${b.name}-${i}`}>
              <rect x={x} y={yt} width={bw} height={Math.max(3, yb - yt)} rx="4" className={b.total ? "total" : b.value >= 0 ? "pos" : "neg"} />
              <text x={x + bw / 2} y={Math.max(14, yt - 6)} textAnchor="middle" className="cfe-bar-value">{money(b.value)}</text>
              <text x={x + bw / 2} y="176" textAnchor="middle" className="cfe-bar-label">
                <tspan x={x + bw / 2}>{b.name.split(" ").slice(0, 2).join(" ")}</tspan>
                {b.name.split(" ").length > 2 && <tspan x={x + bw / 2} dy="11">{b.name.split(" ").slice(2).join(" ")}</tspan>}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function CashFlowEditor(props: Props) {
  const { rows, balanceRows, start, end, roles, openingId, closingId, customLines, money } = props;
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = rows.filter((row) => row.id !== openingId && row.id !== closingId);
    if (!q) return base;
    return base.filter((row) => `${row.label} ${row.sheet}`.toLowerCase().includes(q));
  }, [rows, query, openingId, closingId]);

  const grouped = useMemo(() => {
    const bySheet = new Map<string, ScanRow[]>();
    filtered.forEach((row) => { const list = bySheet.get(row.sheet) || []; list.push(row); bySheet.set(row.sheet, list); });
    return [...bySheet.entries()];
  }, [filtered]);

  const steps = useMemo(
    () => buildCashBridge([...rows, ...balanceRows], start, end, { roles, openingId, closingId, customLines }),
    [rows, balanceRows, start, end, roles, openingId, closingId, customLines],
  );

  const tagged = rows.filter((row) => roles[row.id] === "in" || roles[row.id] === "out").length;
  const reconStep = steps.find((s) => s.name.includes("reconcil"));
  const closing = steps[steps.length - 1]?.value ?? 0;

  return (
    <section className="cfe-root">
      <div className="cfe-intro">
        <p className="eyebrow"><Waves size={13} /> Cash-flow builder</p>
        <h3>Tell the waterfall which lines are cash in, cash out, or not cash</h3>
        <p>We&rsquo;ve made a first guess for every line below. Fix any that look wrong. The waterfall on the right updates instantly and always adds up — there&rsquo;s no leftover &ldquo;unmapped&rdquo; bar unless you point us at a closing-cash row that disagrees.</p>
      </div>

      <div className="cfe-balances">
        <div>
          <Label>Opening cash row <small>(optional)</small></Label>
          <Select value={openingId || NONE} onValueChange={(value) => props.onSetOpening(value === NONE ? "" : value)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None — start from zero</SelectItem>
              {balanceRows.map((row) => <SelectItem key={row.id} value={row.id}>{row.label} · {row.sheet}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Closing cash row <small>(optional)</small></Label>
          <Select value={closingId || NONE} onValueChange={(value) => props.onSetClosing(value === NONE ? "" : value)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None — calculate it for me</SelectItem>
              {balanceRows.map((row) => <SelectItem key={row.id} value={row.id}>{row.label} · {row.sheet}</SelectItem>)}
            </SelectContent>
          </Select>
          <small className="cfe-hint">{closingId ? "We’ll flag any gap between this row and the movements as reconciliation." : "Closing cash is the sum of every line you tag — always complete."}</small>
        </div>
      </div>

      <div className="cfe-body">
        <div className="cfe-lines">
          <div className="cfe-lines-head">
            <div className="cfe-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search lines…" aria-label="Search cash-flow lines" /></div>
            <span className="cfe-count">{tagged} of {rows.length} lines used</span>
            <Button type="button" variant="outline" size="sm" onClick={props.onResetDefaults}><RotateCcw size={14} /> Smart reset</Button>
          </div>

          {!rows.length && <div className="cfe-empty">Scan a connected model first — every cash-relevant line from your workbook will appear here to tag.</div>}

          {grouped.map(([sheet, sheetRows]) => (
            <div className="cfe-group" key={sheet}>
              <div className="cfe-group-title">{sheet}</div>
              {sheetRows.map((row) => {
                const sigma = rowTotal(row, start, end);
                return (
                  <div className={`cfe-line role-${roles[row.id] || "ignore"}`} key={row.id}>
                    <div className="cfe-line-name">
                      <b>{row.label || "(unlabelled)"}</b>
                      <small>Σ {money(sigma)} over {end - start + 1} mo</small>
                    </div>
                    <RoleToggle id={row.label} role={roles[row.id] || "ignore"} onChange={(role) => props.onSetRole(row.id, role)} />
                  </div>
                );
              })}
            </div>
          ))}

          <div className="cfe-custom">
            <div className="cfe-group-title">Manual lines <small>for cash the model doesn&rsquo;t show (e.g. a loan, owner funding, a one-off)</small></div>
            {customLines.map((line) => (
              <div className="cfe-custom-line" key={line.id}>
                <Input aria-label="Line name" value={line.name} placeholder="e.g. Owner funding" onChange={(event) => props.onUpdateCustom(line.id, { name: event.target.value })} />
                <Select value={line.role === "out" ? "out" : "in"} onValueChange={(value) => props.onUpdateCustom(line.id, { role: value as CashRole })}>
                  <SelectTrigger className="cfe-custom-role"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="in">Money in</SelectItem><SelectItem value="out">Money out</SelectItem></SelectContent>
                </Select>
                <Input aria-label="Amount per month" type="number" value={line.monthly} placeholder="per month" onChange={(event) => props.onUpdateCustom(line.id, { monthly: Number(event.target.value) || 0 })} />
                <Button type="button" variant="outline" size="sm" onClick={() => props.onRemoveCustom(line.id)} aria-label={`Remove ${line.name || "line"}`}><Trash2 size={14} /></Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={props.onAddCustom}><Plus size={14} /> Add a manual line</Button>
          </div>
        </div>

        <aside className="cfe-preview">
          <div className="cfe-preview-head">
            <span className="eyebrow">Live waterfall</span>
            <b className={closing >= 0 ? "good" : "bad"}>{money(closing)}</b>
          </div>
          <MiniWaterfall steps={steps} money={money} />
          <div className={`cfe-recon ${reconStep ? "warn" : "ok"}`}>
            {reconStep
              ? <>Gap of <b>{money(reconStep.value)}</b> between your closing-cash row and the tagged lines — check for a missing line or a wrong tag.</>
              : <>Balanced — every tagged line is counted once and the closing figure adds up exactly.</>}
          </div>
        </aside>
      </div>
    </section>
  );
}
