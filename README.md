# Niche Numbers Treasury

A modular, browser-based treasury workspace for cash flow, working capital, runway and scenario planning. This repository is a standard Next.js application prepared for GitHub and Vercel.

## What is included

- Granular cash-flow waterfall with opening cash, operating flows, capex, debt drawdowns, repayments, interest, funding and closing cash
- Customer collections by account or invoice
- Supplier payments by account or invoice
- DSO, DPO and DIO scenario levers with Google Sheets write-back
- Per-customer DSO and per-supplier DPO write-back
- Debt portfolio summary, instrument cards and monthly drawdown/repayment/interest schedule
- Custom levers for interest, capex, financing, payroll, rent or any other assumption cell
- Deterministic workbook scanning: no LLM or paid API is required
- Optional Groq-powered "Ask the model" assistant with compact, routed context
- Separate saved mapping profile for every spreadsheet ID

The application does not require a fixed workbook template. A user selects the source sheet for each module, reviews the suggested mapping, and can skip modules that do not exist.

## How the connection works

1. The web application calls a Google Apps Script web app.
2. Apps Script opens the spreadsheet ID supplied by the application.
3. Read requests return only the requested ranges.
4. Write requests update only reviewed ranges.
5. Google Sheets recalculates the workbook, and the application scans the result again.

The connector is in `google-apps-script/Code.gs`.

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open the local URL printed in the terminal.

Useful checks:

```bash
npm test
npm run lint
npm run build
```

## Deploy

- Beginner instructions: [VERCEL_SETUP.md](VERCEL_SETUP.md)
- GitHub instructions: [GITHUB_SETUP.md](GITHUB_SETUP.md)

No Vercel environment variables are required for the current version. The Groq key is entered by the user inside the app and remains only in that browser tab.

## Connect Google Sheets

1. Open any Google Sheet owned by the Google account that can access the target models.
2. Choose **Extensions → Apps Script**.
3. Replace the editor contents with `google-apps-script/Code.gs`.
4. Change `REPLACE_WITH_A_LONG_RANDOM_TOKEN` to a private random value.
5. Choose **Deploy → New deployment → Web app**.
6. Set **Execute as: Me** and **Who has access: Anyone**.
7. Copy the deployed URL ending in `/exec`.
8. In Niche Numbers Treasury, click **Connect sheet** and enter the target Sheet URL, Apps Script URL and private token.
9. Click **Save and scan workbook**.

When Apps Script is changed later, deploy a **new version** under the existing deployment. The `/exec` URL remains the same.

## Workbook flexibility

The scanner recognises common finance terminology rather than workbook-specific cell addresses. It supports cash flow, receivables, payables, working capital, debt, liquidity, covenants and assumption/input tabs.

For granular schedules, either format is supported:

- long-form invoices: account, amount, due date, expected date;
- wide schedules: account, DSO/DPO, and monthly columns.

Unusual workbooks may need a one-time review in **Model mapping**. Those choices are stored only for that spreadsheet ID and do not carry into a different workbook.

## Write-back behaviour

- Customer page: writes only the selected customer's DSO cell.
- Supplier page: writes only the selected supplier's DPO cell.
- Scenario DSO/DPO: applies the chosen change across all detected customer/supplier driver cells while preserving their relative differences.
- Scenario DIO: writes to the detected single assumption cell.
- Custom levers: automatically suggest a matching detected input where possible, or let the user select an editable workbook cell.

The scenario screen separates the **Model value** currently read from Google Sheets from the temporary **Scenario value**. Every write is shown in a review dialog before it is sent. Write-back is restricted to mapped cells inside the current workbook's selected source tabs; formula and output rows are not intentionally overwritten.

## Main code locations

- `app/page.tsx` — main application and write-back workflow
- `components/treasury-module-views.tsx` — treasury screens and charts
- `components/model-mapping-workbench.tsx` — mapping review interface
- `lib/treasury-model.ts` — deterministic workbook parser
- `lib/model-mapping.ts` — finance dictionary and source scoring
- `google-apps-script/Code.gs` — free Google Sheets read/write connector
- `tests/treasury-model.test.mjs` — parser regression tests
- `lib/groq-assistant.ts` — question routing, compact AI context and response safeguards

## Security note

The current setup is intentionally lightweight and has no application login. Anyone who knows both the Apps Script URL and token can use the connector with spreadsheets accessible to the script owner's Google account. Keep both private and rotate the token if exposed. Before using this for sensitive production data, add authentication and stricter range permissions.
