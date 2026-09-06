"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, GitCompare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AssistantOutputs } from "@/lib/groq-assistant";

export type ScenarioLever = { id: string; name: string; unit: string; min: number; max: number; step: number; base: number; kind: "driver" | "lever" };
type Scenario = { id: string; name: string; vals: Record<string, number> };

type Props = {
  periods: string[];
  levers: ScenarioLever[];
  connected: boolean;
  compute: (vals: Record<string, number>) => { out: AssistantOutputs; series: number[] };
  money: (n: number) => string;
};

const COLORS = ["#3a4bb0", "#2f9e5b", "#b4443b", "#a76510", "#7c5cbf"];

const KPIS: Array<{ key: keyof AssistantOutputs; label: string; better: "high" | "low"; fmt: (v: number | null, money: (n: number) => string) => string }> = [
  { key: "runway_months", label: "Runway", better: "high", fmt: (v) => v == null ? "—" : v >= 99 ? "Cash-generative" : `${v.toFixed(1)} mo` },
  { key: "closing_cash", label: "Closing cash", better: "high", fmt: (v, m) => v == null ? "—" : m(v) },
  { key: "operating_cash_flow", label: "Operating cash flow", better: "high", fmt: (v, m) => v == null ? "—" : m(v) },
  { key: "cash_conversion_cycle_days", label: "Cash conversion cycle", better: "low", fmt: (v) => v == null ? "—" : `${v.toFixed(0)} days` },
];

function effectiveVals(scenario: Scenario, levers: ScenarioLever[]) {
  const vals: Record<string, number> = {};
  levers.forEach((lever) => { vals[lever.id] = scenario.vals[lever.id] ?? lever.base; });
  return vals;
}

function CompareChart({ series, names, periods, money }: { series: number[][]; names: string[]; periods: string[]; money: (n: number) => string }) {
  const all = series.flat().filter(Number.isFinite);
  if (!all.length) return <div className="sc-chart-empty">Connect and scan a model to see the cash paths.</div>;
  const lo = Math.min(0, ...all), hi = Math.max(...all), span = hi - lo || 1;
  const W = 720, H = 240, padL = 8, padR = 8, top = 16, bottom = 210;
  const n = Math.max(1, (series[0]?.length || periods.length) - 1);
  const x = (i: number) => padL + (i / n) * (W - padL - padR);
  const y = (v: number) => bottom - ((v - lo) / span) * (bottom - top);
  return (
    <div className="sc-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Closing cash by scenario over time">
        <line x1={padL} y1={y(0)} x2={W - padR} y2={y(0)} className="sc-zero" />
        {series.map((s, si) => (
          <polyline key={si} fill="none" stroke={COLORS[si % COLORS.length]} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"
            points={s.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
        ))}
        {series.map((s, si) => Number.isFinite(s[s.length - 1]) ? (
          <circle key={si} cx={x(s.length - 1)} cy={y(s[s.length - 1])} r="3.5" fill={COLORS[si % COLORS.length]} />
        ) : null)}
        <text x={padL} y="230" className="sc-axis">{periods[0] || "Start"}</text>
        <text x={W - padR} y="230" textAnchor="end" className="sc-axis">{periods[periods.length - 1] || "End"}</text>
      </svg>
      <div className="sc-legend">
        {names.map((name, i) => (
          <span key={i}><i style={{ background: COLORS[i % COLORS.length] }} />{name} · <b>{money(series[i]?.[series[i].length - 1] ?? 0)}</b></span>
        ))}
      </div>
    </div>
  );
}

export function ScenarioLab({ periods, levers, connected, compute, money }: Props) {
  const [scenarios, setScenarios] = useState<Scenario[]>([{ id: "base", name: "Base", vals: {} }]);

  const results = useMemo(() => scenarios.map((scenario) => compute(effectiveVals(scenario, levers))), [scenarios, levers, compute]);

  function addScenario() {
    if (scenarios.length >= 5) return;
    const source = scenarios[scenarios.length - 1];
    setScenarios((current) => [...current, { id: `s_${Date.now()}`, name: `Scenario ${current.length}`, vals: { ...source.vals } }]);
  }
  function removeScenario(id: string) { setScenarios((current) => current.filter((scenario) => scenario.id !== id)); }
  function rename(id: string, name: string) { setScenarios((current) => current.map((scenario) => scenario.id === id ? { ...scenario, name } : scenario)); }
  function setVal(id: string, leverId: string, value: number) {
    setScenarios((current) => current.map((scenario) => scenario.id === id ? { ...scenario, vals: { ...scenario.vals, [leverId]: value } } : scenario));
  }

  // Only show levers that someone can meaningfully move (finite range).
  const shownLevers = levers.filter((lever) => lever.max > lever.min);

  const bestByKpi: Record<string, number> = {};
  KPIS.forEach((kpi) => {
    let bestIdx = -1, bestVal = kpi.better === "high" ? -Infinity : Infinity;
    results.forEach((result, i) => {
      const v = result.out[kpi.key];
      if (v == null || !Number.isFinite(v)) return;
      if ((kpi.better === "high" && v > bestVal) || (kpi.better === "low" && v < bestVal)) { bestVal = v as number; bestIdx = i; }
    });
    bestByKpi[kpi.key as string] = bestIdx;
  });

  return (
    <section className="panel sc-root">
      <div className="panel-head">
        <div><p className="eyebrow"><GitCompare size={13} /> Scenario lab</p><h2>Build scenarios, compare them side by side</h2>
          <p>Start from <b>Base</b> (your live model), clone it, and move the levers. Nothing is written to your sheet — this is a safe sandbox. Levers are the editable inputs detected in your model.</p></div>
        <Button onClick={addScenario} disabled={scenarios.length >= 5}><Plus size={15} /> Add scenario</Button>
      </div>

      {!connected && <div className="sc-note">You&rsquo;re on demo data — scenarios still work. Connect a model to compare against your real numbers.</div>}

      <div className="sc-scroll">
        <table className="sc-table">
          <thead>
            <tr>
              <th className="sc-rowhead">Scenario</th>
              {scenarios.map((scenario, i) => (
                <th key={scenario.id}>
                  <span className="sc-swatch" style={{ background: COLORS[i % COLORS.length] }} />
                  {scenario.id === "base"
                    ? <b>{scenario.name}</b>
                    : <input className="sc-name" value={scenario.name} onChange={(event) => rename(scenario.id, event.target.value)} aria-label="Scenario name" />}
                  {scenario.id !== "base" && <button className="sc-del" onClick={() => removeScenario(scenario.id)} aria-label={`Remove ${scenario.name}`}><Trash2 size={13} /></button>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="sc-section-row"><td colSpan={scenarios.length + 1}>Levers</td></tr>
            {shownLevers.map((lever) => (
              <tr key={lever.id}>
                <td className="sc-rowhead"><b>{lever.name}</b><small>{lever.unit}</small></td>
                {scenarios.map((scenario) => {
                  const value = scenario.vals[lever.id] ?? lever.base;
                  const changed = value !== lever.base;
                  return (
                    <td key={scenario.id}>
                      {scenario.id === "base"
                        ? <span className="sc-base-val">{lever.base}</span>
                        : <Input className={`sc-input ${changed ? "changed" : ""}`} type="number" step={lever.step} value={value}
                            onChange={(event) => setVal(scenario.id, lever.id, Number(event.target.value))} aria-label={`${lever.name} in ${scenario.name}`} />}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="sc-section-row"><td colSpan={scenarios.length + 1}>Results {connected ? "" : "(demo)"}</td></tr>
            {KPIS.map((kpi) => (
              <tr key={kpi.key as string} className="sc-kpi-row">
                <td className="sc-rowhead"><b>{kpi.label}</b></td>
                {results.map((result, i) => (
                  <td key={i} className={bestByKpi[kpi.key as string] === i && scenarios.length > 1 ? "sc-best" : ""}>
                    {kpi.fmt(result.out[kpi.key] as number | null, money)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sc-chart-head"><p className="eyebrow">Closing cash over time</p><span>{connected ? "Path shape is directional; endpoints match the results above." : "Demo data."}</span></div>
      <CompareChart series={results.map((result) => result.series)} names={scenarios.map((scenario) => scenario.name)} periods={periods} money={money} />
    </section>
  );
}
