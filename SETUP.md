# AF Partner Estimator: setup

Referral partner vehicle finance repayment estimator. Consumer and commercial, 12 to 84 month terms,
commercial residuals up to 30% on terms up to 60 months.

## Files

| File | What it is |
|---|---|
| `index.html` | The calculator. `CONFIG` at the top of the script holds the live data URL. |
| `rates.json` | Sample rate card used until the Google Sheet is connected (flagged `"sample": true`, so a yellow banner shows). |
| `apps-script/Code.gs` | Google Apps Script: serves live rates from a Sheet and logs every saved or printed estimate. |
| `logo.png` | AF logo. |

## Connecting live rates and quote capture (about 10 minutes)

1. Create a Google Sheet, e.g. **AF Partner Estimator**.
2. Extensions > Apps Script. Paste in `apps-script/Code.gs` and save.
3. Pick `setup` in the function list and click **Run**. Approve the permissions. This creates the
   **Rates**, **Settings** and **Quotes** tabs with sample rows.
4. Deploy > New deployment > type **Web app**. Execute as **Me**, Who has access **Anyone**. Copy the URL.
5. In `index.html`, set `CONFIG.apiUrl` to that URL. Publish.

After that, editing the **Rates** tab updates every partner's calculator on their next page load.
The `updated` date in Settings stamps itself when Rates is edited.

## How rates are matched

Each row in **Rates** is one lender tier. A blank cell means "any". The calculator finds every tier the
client fits and shows the **lowest repayment**. If nothing fits, it shows "Refer" and the estimate can
still be saved so you can follow it up. Lender names and tier ids are never shown to partners, but
they are recorded in the Quotes tab.

| Column | Meaning |
|---|---|
| `loan_type` | `consumer` or `commercial` |
| `vehicle_age_min` / `vehicle_age_max` | Vehicle age in years at the start (current year minus build year) |
| `age_at_end_max` | Maximum vehicle age at the end of the term |
| `residential` | Consumer: list of `buying, owning, renting, boarding` |
| `employment` | Consumer: list of `full_time, part_time, casual` |
| `job_months_min` | Consumer: minimum months in current job (choices are 0, 3, 6, 12, 24) |
| `asset_backed`, `gst_registered`, `comparable_credit` | Commercial: `Y`, `N` or blank |
| `abn_months_min` | Commercial: minimum ABN age in months (choices are 0, 6, 12, 24, 48) |
| `min_deposit_pct` | Minimum deposit for this tier |
| `rate` | Interest rate % p.a. |
| `est_fee` | Establishment fee, added to the loan |
| `monthly_fee` | Account keeping fee, added to each repayment |
| `brokerage_pct` | Brokerage % of amount financed, added to the loan |
| `min_loan` / `max_loan` | Applies to vehicle price less deposit |
| `max_term_months` | Longest term for this tier |
| `max_residual_pct` | Largest residual for this tier (global cap 30%) |
| `active` | `N` hides the row |

## Quote capture

**Save estimate** and **Print** send everything the partner entered plus the result, the matched tier
and the rate card version to the **Quotes** tab, with a reference like `AFQ-261111-W2O2` that also
prints on the PDF. Offline saves queue on the device and send next time the page opens.

Give each partner their own link with `?ref=CODE` (e.g. `...?ref=SMITHMOTORS`) to tag their quotes.

Set `notify_email` in Settings to get an email for every saved estimate.

## Local preview

`af-referrer-calculator` in `~/.claude/.claude/launch.json`, port 8772.
