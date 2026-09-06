"use client";

import { useMemo, useState } from "react";
import { Check, PencilLine, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ScanRow } from "@/lib/treasury-model";

type LineField = { key: string; label: string; hint: string };

type Props = {
  rows: ScanRow[];
  lineFields: LineField[];
  lineMappings: Record<string, string>;
  driverMappings: Record<string, string>;
  startMonth: string;
  months: number;
  openingCash: number;
  busy: boolean;
  onSetLine: (key: string, range: string) => void;
  onSetDriver: (key: string, cell: string) => void;
  onStartMonth: (value: string) => void;
  onMonths: (value: number) => void;
  onOpeningCash: (value: number) => void;
  onRead: () => void;
};

const driverFields: LineField[] = [
  { key: "dso", label: "DSO — customer collection days", hint: "The single cell that sets how many days customers take to pay" },
  { key: "dpo", label: "DPO — supplier payment days", hint: "The single cell that sets how many days you take to pay suppliers" },
  { key: "dio", label: "DIO — inventory days", hint: "The single cell that sets how many days stock is held" },
];

function fmt(value: number) {
  const abs = Math.abs(value);
  const short = abs >= 1000 ? `${(abs / 1000).toFixed(1)}k` : abs >= 100 ? abs.toFixed(0) : abs.toFixed(1);
  return `${value < 0 ? "(" : ""}${short}${value < 0 ? ")" : ""}`;
}

function previewValues(values: number[]) {
  const nums = values.filter((value) => Number.isFinite(value) && value !== 0);
  if (!nums.length) return "";
  const head = nums.slice(0, 3).map(fmt).join(", ");
  return nums.length > 4 ? `${head} … ${fmt(nums[nums.length - 1])}` : nums.slice(0, 4).map(fmt).join(", ");
}

function Sparkline({ values }: { values: number[] }) {
  const nums = values.filter((value) => Number.isFinite(value));
  if (nums.length < 2) return null;
  const min = Math.min(...nums), max = Math.max(...nums), span = max - min || 1;
  const width = 96, height = 22;
  const points = nums.map((value, index) => `${(index / (nums.length - 1)) * width},${height - ((value - min) / span) * height}`).join(" ");
  return <svg className="mf-spark" viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

function ConceptPicker({ field, kind, options, currentRange, matchRow, onPick, onManual, onClear }: {
  field: LineField;
  kind: "line" | "driver";
  options: ScanRow[];
  currentRange: string;
  matchRow: ScanRow | undefined;
  onPick: (row: ScanRow) => void;
  onManual: (value: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState(false);
  const [manualValue, setManualValue] = useState(currentRange);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 60);
    return options.filter((row) => `${row.label} ${row.sheet} ${kind === "driver" ? row.inputCell : row.range}`.toLowerCase().includes(q)).slice(0, 60);
  }, [options, query, kind]);

  const status = matchRow
    ? { text: matchRow.label, sub: kind === "driver" ? `${matchRow.inputCell}${matchRow.inputValue !== undefined ? ` · currently ${fmt(matchRow.inputValue)}` : ""}` : `${matchRow.sheet} · ${previewValues(matchRow.values) || matchRow.range}`, ok: true }
    : currentRange
      ? { text: "Custom cell", sub: currentRange, ok: true }
      : { text: "Not mapped", sub: kind === "driver" ? "Pick the editable cell for this driver" : "Pick the row that holds this line", ok: false };

  return (
    <div className={`mf-concept ${status.ok ? "is-mapped" : "is-empty"}`}>
      <div className="mf-concept-head">
        <div className="mf-concept-name">
          <strong>{field.label}</strong>
          <span>{field.hint}</span>
        </div>
        <div className="mf-concept-status">
          <span className={`mf-dot ${status.ok ? "ok" : ""}`} aria-hidden="true" />
          <div>
            <b>{status.text}</b>
            <small>{status.sub}</small>
          </div>
          {matchRow && kind === "line" && <Sparkline values={matchRow.values} />}
          <Button type="button" variant="outline" size="sm" onClick={() => { setOpen((value) => !value); setManual(false); }}>
            {open ? "Close" : status.ok ? "Change" : "Choose row"}
          </Button>
        </div>
      </div>

      {open && (
        <div className="mf-picker">
          {!manual ? (
            <>
              <div className="mf-search">
                <Search size={15} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search rows${kind === "driver" ? " with an editable cell" : ""}…`} aria-label={`Search rows for ${field.label}`} autoFocus />
              </div>
              <div className="mf-options" role="listbox">
                {filtered.length ? filtered.map((row) => {
                  const chosen = kind === "driver" ? row.inputCell === currentRange : row.range === currentRange;
                  return (
                    <button type="button" key={row.id} className={`mf-option ${chosen ? "chosen" : ""}`} onClick={() => { onPick(row); setOpen(false); }}>
                      <span className="mf-option-main">
                        <b>{row.label || "(unlabelled row)"}</b>
                        <em>{row.sheet}{kind === "driver" ? ` · ${row.inputCell}` : ""}</em>
                      </span>
                      <span className="mf-option-preview">
                        {kind === "driver"
                          ? (row.inputValue !== undefined ? `now ${fmt(row.inputValue)}` : "editable cell")
                          : (previewValues(row.values) || "no cached values")}
                      </span>
                      {chosen && <Check size={15} className="mf-option-check" />}
                    </button>
                  );
                }) : <div className="mf-none">No matching rows. Try a different word, or type the cell manually below.</div>}
              </div>
              <div className="mf-picker-foot">
                <button type="button" className="mf-link" onClick={() => { setManualValue(currentRange); setManual(true); }}><PencilLine size={13} /> Type a cell/range manually</button>
                {currentRange && <button type="button" className="mf-link danger" onClick={() => { onClear(); setOpen(false); }}><X size={13} /> Clear mapping</button>}
              </div>
            </>
          ) : (
            <div className="mf-manual">
              <Label>Manual {kind === "driver" ? "cell" : "range"}</Label>
              <Input value={manualValue} onChange={(event) => setManualValue(event.target.value)} placeholder={kind === "driver" ? "e.g. 'Assumptions'!D76" : "e.g. 'Cash Flow'!B18:S18"} />
              <div className="mf-manual-actions">
                <Button type="button" variant="outline" size="sm" onClick={() => setManual(false)}>Back to list</Button>
                <Button type="button" size="sm" onClick={() => { onManual(manualValue.trim()); setOpen(false); }}>Apply</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function MappingFallback({ rows, lineFields, lineMappings, driverMappings, startMonth, months, openingCash, busy, onSetLine, onSetDriver, onStartMonth, onMonths, onOpeningCash, onRead }: Props) {
  const lineOptions = useMemo(() => rows.filter((row) => row.values.filter((value) => Number.isFinite(value)).length > 1), [rows]);
  const seriesFallback = lineOptions.length ? lineOptions : rows;
  const driverOptions = useMemo(() => rows.filter((row) => !!row.inputCell), [rows]);

  return (
    <section className="mf-root">
      <div className="mf-intro">
        <strong>Map any model, your way</strong>
        <span>For each line, pick the row from your workbook that holds it — you&rsquo;ll see its values so you know it&rsquo;s right. Anything your model doesn&rsquo;t have, leave unmapped.</span>
      </div>

      <div className="mf-timeline">
        <div><Label>First forecast month</Label><Input type="month" value={startMonth} onChange={(event) => onStartMonth(event.target.value)} /></div>
        <div><Label>Number of months</Label><Input type="number" min="1" max="120" value={months} onChange={(event) => onMonths(Math.max(1, Number(event.target.value) || 1))} /></div>
        <div><Label>Opening cash</Label><Input type="number" value={openingCash} onChange={(event) => onOpeningCash(Number(event.target.value) || 0)} /></div>
      </div>

      <div className="mf-group-title">Monthly lines</div>
      {!rows.length && <div className="mf-scanfirst">Connect and scan a workbook first — then every detected row appears here to choose from.</div>}
      <div className="mf-concepts">
        {lineFields.map((field) => {
          const currentRange = lineMappings[field.key] || "";
          const matchRow = rows.find((row) => row.range === currentRange);
          return <ConceptPicker key={field.key} field={field} kind="line" options={seriesFallback} currentRange={currentRange} matchRow={matchRow} onPick={(row) => onSetLine(field.key, row.range)} onManual={(value) => onSetLine(field.key, value)} onClear={() => onSetLine(field.key, "")} />;
        })}
      </div>

      <div className="mf-group-title">Editable drivers (write-back)</div>
      <div className="mf-concepts">
        {driverFields.map((field) => {
          const currentRange = driverMappings[field.key] || "";
          const matchRow = rows.find((row) => row.inputCell === currentRange);
          return <ConceptPicker key={field.key} field={field} kind="driver" options={driverOptions} currentRange={currentRange} matchRow={matchRow} onPick={(row) => onSetDriver(field.key, row.inputCell || "")} onManual={(value) => onSetDriver(field.key, value)} onClear={() => onSetDriver(field.key, "")} />;
        })}
      </div>

      <div className="mf-foot">
        <span>Your choices are saved for this workbook only.</span>
        <Button onClick={onRead} disabled={busy}><RefreshCw size={15} className={busy ? "spin" : ""} /> Read mapped rows</Button>
      </div>
    </section>
  );
}
