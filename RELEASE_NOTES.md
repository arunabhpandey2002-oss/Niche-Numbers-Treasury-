# Updated Treasury build

This package includes the requested cash-flow and scenario-control update.

## Changes

- Cash waterfall now starts from detected opening cash and separates customer collections, supplier payments, people costs, operating costs, taxes, interest and fees, debt repayments, debt drawdowns, equity/funding, capex, acquisitions, FX and other movements.
- Any difference between classified movements and closing cash is shown explicitly as **Unmapped / reconciliation** rather than being hidden in a broad debt or other bar.
- Scenario controls now show **Model value** versus **Scenario value**, with an obvious connected/not-connected status.
- Custom levers can select from editable input cells detected in the current workbook. Common interest, capex and financing inputs are suggested automatically when their labels match.
- Write-back is restricted to mapped cells in the active workbook's selected treasury source tabs.
- Debt now has portfolio KPIs, instrument summaries and a monthly schedule separating drawdowns, principal repayments, interest/fees and closing balances.
- Customer DSO and supplier DPO values are rounded to clean whole days in the controls and write-back.

## Verification

- ESLint passed.
- 15 automated tests passed.
- Next.js production build passed.
