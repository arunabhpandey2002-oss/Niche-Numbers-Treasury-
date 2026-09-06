"use client";

import { Check, CircleAlert, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AUTO_SOURCE, SKIP_SOURCE, moduleLabel, sourceModules } from "@/lib/model-mapping";
import type { MappingSuggestion, SourceAssignments, SourceModuleId } from "@/lib/model-mapping";
import type { ScanResult } from "@/lib/treasury-model";

type Props = {
  sheets: string[];
  assignments: SourceAssignments;
  scan: ScanResult | null;
  busy: boolean;
  onAssignmentChange: (module: SourceModuleId, sheet: string) => void;
  onMappingChange: (id: string, patch: Partial<MappingSuggestion>) => void;
  onScan: () => void;
};

function confidenceClass(confidence: number) {
  if (confidence >= 85) return "high";
  if (confidence >= 65) return "medium";
  return "low";
}

export function ModelMappingWorkbench({ sheets, assignments, scan, busy, onAssignmentChange, onMappingChange, onScan }: Props) {
  const mappings = scan?.mappings || [];
  const accepted = mappings.filter((mapping) => mapping.accepted).length;
  const review = mappings.filter((mapping) => mapping.confidence < 75).length;

  return <section className="panel mapping-panel adaptive-mapping">
    <div className="panel-head">
      <div><p className="eyebrow">Modular model setup</p><h2>Choose sources, then review the matches</h2><p>Each module can use automatic detection, a specific sheet, or be skipped. No model layout is assumed.</p></div>
      <Button onClick={onScan} disabled={busy}><RefreshCw size={15} className={busy ? "spin" : ""}/>{busy ? "Scanning…" : scan ? "Scan again" : "Scan workbook"}</Button>
    </div>

    <div className="mapping-steps">
      <div className="mapping-step active"><span>1</span><b>Choose source sheets</b></div>
      <div className={`mapping-step ${scan ? "active" : ""}`}><span>2</span><b>Review automatic mapping</b></div>
      <div className={`mapping-step ${scan && !review ? "active" : ""}`}><span>3</span><b>Use the model</b></div>
    </div>

    <div className="source-grid">
      {sourceModules.map((module) => {
        const selected = assignments[module.id] || AUTO_SOURCE;
        const resolved = scan?.sourceAssignments?.[module.id];
        const score = resolved && scan?.sourceScores?.[module.id]?.find((entry) => entry.sheet === resolved);
        return <article key={module.id} className={selected === SKIP_SOURCE ? "skipped" : ""}>
          <div><strong>{module.label}</strong>{resolved && resolved !== SKIP_SOURCE && <small><Check size={12}/> Using {resolved}{score ? ` · ${score.score}% match` : ""}</small>}</div>
          <Select value={selected} onValueChange={(value) => onAssignmentChange(module.id, value)}>
            <SelectTrigger aria-label={`${module.label} source`}><SelectValue/></SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO_SOURCE}>Detect automatically</SelectItem>
              <SelectItem value={SKIP_SOURCE}>Not available</SelectItem>
              {sheets.map((sheet) => <SelectItem key={sheet} value={sheet}>{sheet}</SelectItem>)}
            </SelectContent>
          </Select>
        </article>;
      })}
    </div>

    {!scan ? <div className="mapping-empty"><Sparkles size={18}/><div><strong>Ready to scan</strong><span>The scanner will read labels, dates, row orientation and common treasury terminology.</span></div></div> : <>
      <div className="mapping-review-head"><div><p className="eyebrow">Mapping review</p><h3>{accepted} matches accepted · {review} need attention</h3></div><span>{scan.sheets.length} source sheets · {scan.periods.length} periods</span></div>
      <div className="mapping-review-list">
        {mappings.length ? mappings.map((mapping) => <div className="mapping-review-row" key={mapping.id}>
          <Checkbox checked={mapping.accepted} onCheckedChange={(checked) => onMappingChange(mapping.id, { accepted: checked === true })} aria-label={`Accept ${mapping.label}`}/>
          <div className="mapping-review-name"><strong>{mappingLabel(mapping.module, mapping.metric)}</strong><span>Matched “{mapping.label}” in {mapping.sheet}</span></div>
          <Input value={mapping.range} onChange={(event) => onMappingChange(mapping.id, { range: event.target.value })} aria-label={`${mapping.label} range`}/>
          <span className={`confidence ${confidenceClass(mapping.confidence)}`}>{mapping.confidence}%</span>
          <span className={`mapping-kind ${mapping.writable ? "input" : "output"}`}>{mapping.writable ? "Input" : "Output"}</span>
        </div>) : <div className="mapping-empty"><CircleAlert size={18}/><div><strong>No confident line mappings yet</strong><span>Choose the source sheets above, then scan again. Modules without data can remain unavailable.</span></div></div>}
      </div>
    </>}
  </section>;
}

function mappingLabel(module: SourceModuleId, metric: string) {
  return `${moduleLabel(module)} · ${metric.replaceAll("_", " ")}`;
}
