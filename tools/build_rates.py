"""Build the rate card from extracted lender rows.

Input:  a folder of group_*.json files (rows in the extraction schema, see SETUP.md).
Output: private/rates-master.csv  every row with lender, product, source, notes and status (NOT published)
        rates.json                public feed: active rows only, criteria + rate, no lender details

Usage: python -I tools/build_rates.py <folder with group_*.json>
"""
import csv, glob, json, os, sys, datetime

SRC = sys.argv[1]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CODES = {'RACV': 'RV', 'Latitude': 'LT', 'Westpac': 'WP', 'Angle': 'AN', 'Metro': 'MT',
         'Pepper': 'PP', 'Resimac': 'RS', 'Branded': 'BF', 'Plenti': 'PL'}

PUBLIC = ['id', 'loan_type', 'condition', 'vehicle_age_min', 'vehicle_age_max', 'age_at_end_max',
          'credit_score_min', 'credit_score_max', 'residential', 'employment', 'job_months_min',
          'asset_backed', 'gst_registered', 'comparable_credit', 'abn_months_min', 'min_deposit_pct',
          'min_loan', 'max_loan', 'min_term_months', 'max_term_months', 'max_residual_pct', 'doc_type', 'rate']
MASTER = ['id', 'active', 'status_note', 'lender', 'product'] + PUBLIC[1:] + ['rate_basis', 'source', 'notes']

# Lenders that price on their own risk grade with no credit score mapping: the cheapest grade would
# otherwise match every client. Off until Michael decides how to map them.
RISK_GRADED = {'LT': 'Latitude prices on its own risk grade (no credit score on the card)',
               'AN': 'Angle rates vary by credit rating with no score bands on the card',
               'PP': 'Pepper tiers A to C are its own risk grades with no stated criteria'}


def status(code, r):
    text = (r['product'] + ' ' + r['notes']).lower()
    if code in RISK_GRADED:
        return RISK_GRADED[code]
    if code == 'WP':
        return 'Westpac Xpress special caps brokerage at 3%; AF charges 4% on commercial'
    if 'electric' in r['product'].lower():
        return 'Electric vehicle pricing (we do not ask if the car is electric)'
    if 'spring promo' in r['product'].lower():
        return 'Promo stacked on the 2% broker discount; card does not confirm they combine'
    return ''


rows = []
for path in sorted(glob.glob(os.path.join(SRC, 'group_*.json'))):
    rows += json.load(open(path, encoding='utf-8'))

counters, out = {}, []
for r in rows:
    code = next(c for k, c in CODES.items() if r['lender'].startswith(k))
    counters[code] = counters.get(code, 0) + 1
    r = dict(r)
    r['id'] = f'{code}-{counters[code]:03d}'
    note = status(code, r)
    r['status_note'] = note
    r['active'] = 'N' if note else 'Y'
    out.append(r)

os.makedirs(os.path.join(ROOT, 'private'), exist_ok=True)
with open(os.path.join(ROOT, 'private', 'rates-master.csv'), 'w', newline='', encoding='utf-8-sig') as f:
    w = csv.DictWriter(f, fieldnames=MASTER, extrasaction='ignore')
    w.writeheader()
    w.writerows(out)

rates_path = os.path.join(ROOT, 'rates.json')
current = json.load(open(rates_path, encoding='utf-8'))
current.update({
    'version': 'Lender rate cards Nov 2026',
    'updated': datetime.date.today().isoformat(),
    'sample': False,
    'tiers': [{k: r.get(k, '') for k in PUBLIC} for r in out if r['active'] == 'Y'],
})
with open(rates_path, 'w', encoding='utf-8', newline='\n') as f:
    json.dump(current, f, ensure_ascii=False, separators=(',', ':'))

active = sum(r['active'] == 'Y' for r in out)
print(f'{len(out)} rows, {active} active')
for code in sorted(counters):
    print(code, counters[code], 'active', sum(1 for r in out if r['id'].startswith(code) and r['active'] == 'Y'))
