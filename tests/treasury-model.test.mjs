import assert from "node:assert/strict";
import test from "node:test";

import { SCAN_SCHEMA_VERSION, buildCashBridge, cashCandidateRows, defaultCashRoles, parseWorkbook, paymentsForScan, roundDays } from "../lib/treasury-model.ts";
import { AUTO_SOURCE, SKIP_SOURCE, emptySourceAssignments, resolveSources } from "../lib/model-mapping.ts";

test("detects optional customer collection records", () => {
  const scan = parseWorkbook("Granular AR", [
    {
      name: "Receivables Detail",
      values: [
        ["Customer", "Invoice", "Amount", "Due Date", "Expected Collection Date", "Probability", "Early Payment Discount"],
        ["Acme", "INV-1", 100, "2026-01-15", "2026-03-15", "80%", "2%"],
        ["Beta", "INV-2", 50, "2026-02-15", "2026-02-28", "", ""],
      ],
    },
  ]);

  assert.ok(scan.modules.includes("collections"));
  assert.equal(scan.collections.length, 2);
  assert.equal(scan.collections[0].customer, "Acme");
  assert.equal(scan.collections[0].expectedMonth, "Mar 26");
  assert.equal(scan.collections[0].probability, 0.8);
  assert.equal(scan.collections[0].dateCell, "'Receivables Detail'!E2");
  assert.equal(scan.collections[0].discountCell, "'Receivables Detail'!G2");
});

test("detects account-by-month debtor schedules and editable customer DSO cells", () => {
  const scan = parseWorkbook("Wide AR", [{
    name: "Customer Book",
    values: [
      ["Accounts Receivable Detail (INR)"],
      [],
      ["Account", "Collection Days", "Opening", "Apr-26", "May-26"],
      ["MONTHLY BILLINGS"],
      ["Acme", 45, "-", 100, 110],
      ["Beta", 60, "-", 50, 55],
      ["Total billings", "", "", 150, 165],
      [],
      ["COLLECTIONS RECEIVED"],
      ["Acme", "", "", 80, 105],
      ["Beta", "", "", 30, 50],
      ["TOTAL COLLECTIONS", "", "", 110, 155],
    ],
  }]);

  assert.equal(scan.collections.length, 4);
  assert.equal(scan.collections[0].sourceKind, "account_schedule");
  assert.equal(scan.collections[0].driverCell, "'Customer Book'!B5");
  assert.equal(scan.collections[0].driverValue, 45);
  assert.equal(scan.collections[0].expectedMonth, "Apr 26");
  assert.ok(scan.mappings.some((mapping) => mapping.metric === "customer_dso" && mapping.confidence === 96));
});

test("detects account-by-month creditor schedules and editable supplier DPO cells", () => {
  const scan = parseWorkbook("Wide AP", [{
    name: "Creditors",
    values: [
      ["Accounts Payable Detail (INR)"],
      [],
      ["Supplier", "Payment Days", "Opening", "Apr-26", "May-26"],
      ["PURCHASES"],
      ["Alpha Ltd", 45, "-", 100, 110],
      ["Beta Ltd", 60, "-", 50, 55],
      ["Total purchases", "", "", 150, 165],
      [],
      ["PAYMENTS MADE"],
      ["Alpha Ltd", "", "", 80, 105],
      ["Beta Ltd", "", "", 30, 50],
      ["TOTAL PAYMENTS", "", "", 110, 155],
    ],
  }]);

  assert.equal(scan.payments.length, 4);
  assert.equal(scan.payments[0].sourceKind, "account_schedule");
  assert.equal(scan.payments[0].driverCell, "'Creditors'!B5");
  assert.equal(scan.payments[0].driverValue, 45);
  assert.equal(scan.payments[0].supplier, "Alpha Ltd");
  assert.ok(scan.mappings.some((mapping) => mapping.metric === "supplier_dpo" && mapping.confidence === 96));
  assert.equal(scan.schemaVersion, SCAN_SCHEMA_VERSION);

  const oldSavedScan = { ...scan, schemaVersion: undefined, payments: [] };
  const recovered = paymentsForScan(oldSavedScan);
  assert.equal(recovered.length, 4);
  assert.equal(recovered[0].supplier, "Alpha Ltd");
  assert.equal(recovered[0].expectedMonth, "Apr 26");
});

test("separates debt instruments with mixed-case headings and ignores subtitles", () => {
  const scan = parseWorkbook("Debt", [{ name: "Debt Schedule", values: [
    ["DEBT SCHEDULE"],
    ["Term loan amortisation + revolving facility with cash sweep"],
    ["₹ crore", "Apr-26", "May-26"],
    ["TERM LOAN"],
    ["Closing balance", 40, 30],
    ["Cash interest", 1, 0.8],
    ["Principal repayment", 5, 10],
    ["REVOLVING FACILITY (linked from Cash Flow plug)"],
    ["Closing drawn", 0, 12],
    ["Interest paid", 0, 0.2],
  ] }]);
  const closing = scan.rows.filter((row) => /closing balance|closing drawn/i.test(row.label));
  assert.deepEqual(closing.map((row) => row.section), ["TERM LOAN", "REVOLVING FACILITY (linked from Cash Flow plug)"]);
  assert.ok(!scan.rows.some((row) => row.section === "Term loan amortisation + revolving facility with cash sweep"));
});

test("maps the populated DIO input cell instead of a blank cell to its right", () => {
  const scan = parseWorkbook("Inputs", [{ name: "Assumptions", values: [
    ["ASSUMPTIONS"],
    ["Inventory days (DIO, memo)", 22, "", ""],
  ] }]);
  const dio = scan.rows.find((row) => /dio/i.test(row.label));
  assert.equal(dio?.inputCell, "'Assumptions'!B2");
  assert.equal(dio?.inputValue, 22);
});

test("resolves module sources independently and honours skipped modules", () => {
  const tabs = [
    { name: "Monthly Liquidity", values: [["Beginning cash", "Apr-26", "May-26"], ["Ending cash", 10, 12]] },
    { name: "Supplier Ledger", values: [["Vendor", "Payment days"], ["Alpha", 45]] },
  ];
  const selected = { ...emptySourceAssignments, debt: SKIP_SOURCE, cashFlow: AUTO_SOURCE };
  const { resolved } = resolveSources(tabs, selected);
  assert.equal(resolved.cashFlow, "Monthly Liquidity");
  assert.equal(resolved.payables, "Supplier Ledger");
  assert.equal(resolved.debt, SKIP_SOURCE);
});

test("builds a granular cash bridge with opening cash and separate debt movements", () => {
  const row=(label,values)=>({id:label,sheet:"Cash Flow",row:1,label,section:"Cash Flow",entity:"Group",currency:"USD",unit:"USD",range:"",values,display:values.map(String)});
  const steps=buildCashBridge([
    row("Opening balance",[100,80]),
    row("Customer receipts",[40,50]),
    row("Supplier payments",[-25,-30]),
    row("Principal repayment",[10,5]),
    row("Revolver drawdown",[15,0]),
    row("Interest paid",[2,2]),
    row("Closing balance",[118,93]),
  ],0,1);
  assert.equal(steps[0].name,"Opening cash");
  assert.equal(steps[0].value,100);
  assert.equal(steps.find((step)=>step.name==="Debt repayments")?.value,-15);
  assert.equal(steps.find((step)=>step.name==="Debt drawdowns")?.value,15);
  assert.equal(steps.find((step)=>step.name==="Interest & fees")?.value,-4);
  assert.equal(steps.at(-1)?.value,93);
});

test("curated bridge on a P&L (no cash statement) is complete with no reconciliation bar", () => {
  const row=(label,sheet,values)=>({id:`${sheet}:${label}`,sheet,row:1,label,section:sheet,entity:"Group",currency:"INR",unit:"INR",range:"",values,display:values.map(String)});
  const rows=[
    row("Revenue excluding GST","P&L",[100,100]),
    row("Cost of goods sold","P&L",[40,40]),
    row("Employee costs","P&L",[20,20]),
    row("Office rent per seat","P&L",[5,5]),      // driver-shaped -> excluded from candidates
    row("Total EBITDA","P&L",[35,35]),            // subtotal -> excluded
    row("Growth rate","Assumptions",[0.1,0.1]),   // assumptions sheet -> excluded
  ];
  const candidates=cashCandidateRows(rows,"Assumptions");
  assert.ok(candidates.some((r)=>r.label==="Revenue excluding GST"));
  assert.ok(!candidates.some((r)=>r.label==="Total EBITDA"));
  assert.ok(!candidates.some((r)=>r.label==="Office rent per seat"));
  assert.ok(!candidates.some((r)=>r.sheet==="Assumptions"));

  const roles=defaultCashRoles(rows,"Assumptions");
  assert.equal(roles["P&L:Revenue excluding GST"],"in");
  assert.equal(roles["P&L:Cost of goods sold"],"out");
  assert.equal(roles["P&L:Employee costs"],"out");

  const steps=buildCashBridge(rows,0,1,{roles,openingId:"",closingId:"",customLines:[{id:"c",name:"Owner funding",role:"in",monthly:10}]});
  assert.equal(steps[0].name,"Opening cash");
  assert.equal(steps[0].value,0);
  assert.ok(!steps.some((s)=>s.name.includes("reconcil")),"no reconciliation bar when closing is derived");
  const movements=steps.slice(1,-1).reduce((sum,s)=>sum+s.value,0);
  const closing=steps.at(-1).value;
  assert.equal(closing,movements,"closing equals the sum of movements");
  // 200 revenue - 80 cogs - 40 people + 20 owner funding = 100
  assert.equal(closing,100);
  assert.ok(steps.some((s)=>s.name==="Owner funding"&&s.value===20),"custom line appears once");
});

test("curated bridge flags a gap when a closing-cash row disagrees", () => {
  const row=(label,values)=>({id:label,sheet:"Cash Flow",row:1,label,section:"Cash Flow",entity:"Group",currency:"USD",unit:"USD",range:"",values,display:values.map(String)});
  const rows=[
    row("Opening balance",[100,100]),
    row("Customer receipts",[50,50]),
    row("Supplier payments",[-20,-20]),
    row("Closing balance",[300,300]),   // deliberately wrong (should be 100+60=160)
  ];
  const roles={"Customer receipts":"in","Supplier payments":"out"};
  const steps=buildCashBridge(rows,0,1,{roles,openingId:"Opening balance",closingId:"Closing balance"});
  const recon=steps.find((s)=>s.name.includes("reconcil"));
  assert.ok(recon,"reconciliation bar shown when closing row disagrees");
  assert.equal(steps[0].value,100);
  assert.equal(steps.at(-1).value,300);
});

test("rounds spreadsheet day drivers to clean whole-day controls", () => {
  assert.equal(roundDays(58.94230769230768),59);
  assert.equal(roundDays(Number.NaN),0);
});
