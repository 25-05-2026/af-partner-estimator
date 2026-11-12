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
          'min_loan', 'max_loan', 'min_term_months', 'max_term_months', 'max_residual_pct', 'doc_type', 'fuel', 'brokerage_pct', 'rate']
MASTER = ['id', 'active', 'status_note', 'lender', 'product'] + PUBLIC[1:] + ['rate_basis', 'source', 'notes']

# Lenders that price on their own risk grade with no credit score mapping: the cheapest grade would
# otherwise match every client. Off until Michael decides how to map them.
RISK_GRADED = {'LT': 'Card row replaced by the estimated credit score mapping rows below',
               'AN': 'Card row replaced by the estimated credit score mapping rows below',
}


def status(code, r):
    text = (r['product'] + ' ' + r['notes']).lower()
    if code in RISK_GRADED:
        return RISK_GRADED[code]
    if code == 'PP' and 'Tier A' not in r['product']:
        return 'Pepper commercial is for asset backed clients only (Michael, 2026-11-12)'
    if code == 'PP' and 'private sale' in r['product'].lower():
        return 'Private sale pricing (partners quote dealer sales)'
    if code == 'WP' and 'private sale' in (r['product'] + r['notes']).lower():
        return 'Private sale pricing (partners quote dealer sales)'
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
    r.setdefault('fuel', '')
    r.setdefault('brokerage_pct', '')
    if code == 'RV':
        r['age_at_end_max'] = 20   # RACV: vehicle no older than 20 years at end of term (Michael, 2026-11-12)
    if code == 'WP':
        # Westpac Xpress (Michael, 2026-11-12): low doc product, asset backed only (no renters or boarders),
        # vehicle 5 years or newer. Older vehicles, renters and boarders need Westpac full doc (no rate card yet).
        r['doc_type'] = 'low_doc'
        r['asset_backed'] = 'Y'
        r['vehicle_age_max'] = 5
        r['brokerage_pct'] = 3   # Westpac Xpress special caps brokerage at 3% (Michael: quote it at 3%)
    # Pepper tiers (Michael, 2026-11-12): A = asset backed, B = renter, C = boarder
    if code == 'PP':
        tier = 'A' if 'Tier A' in r['product'] else 'B' if 'Tier B' in r['product'] else 'C'
        r['asset_backed'] = 'Y' if tier == 'A' else 'N'
        r['residential'] = {'A': '', 'B': 'renting', 'C': 'boarding'}[tier]
    if 'electric' in r['product'].lower():
        r['fuel'] = 'hybrid,bev'   # Resimac EV pricing covers fully electric, hybrid and plug-in hybrid
    note = status(code, r)
    r['status_note'] = note
    r['active'] = 'N' if note else 'Y'
    out.append(r)

# Plenti: battery EV 0.50% p.a. discount, minimum score 600. Add a fully electric copy of each active row.
extra = []
for r in out:
    if r['id'].startswith('PL-') and r['active'] == 'Y':
        e = dict(r)
        counters['PL'] += 1
        e['id'] = f"PL-{counters['PL']:03d}"
        e['fuel'] = 'bev'
        e['rate'] = round(float(r['rate']) - 0.5, 2)
        e['credit_score_min'] = max(600, int(r['credit_score_min'] or 0))
        e['product'] = r['product'] + ' (battery EV discount 0.50%)'
        extra.append(e)
out += extra

# Metro (Michael, 2026-11-12) and Westpac (card): 1% p.a. off for fully electric vehicles.
extra = []
for r in out:
    if r['id'][:3] in ('MT-', 'WP-') and r['active'] == 'Y' and not r.get('fuel'):
        code = r['id'][:2]
        e = dict(r)
        counters[code] += 1
        e['id'] = f"{code}-{counters[code]:03d}"
        e['fuel'] = 'bev'
        e['rate'] = round(float(r['rate']) - 1.0, 2)
        e['product'] = r['product'] + ' (electric vehicle discount 1%)'
        e['notes'] = ('EV discount 1% advised by Michael 2026-11-12, not on the card. ' if code == 'MT' else 'EV discount 1% per card. ') + r['notes']
        extra.append(e)
out += extra

# ---- Estimated credit score mappings (Michael, 2026-11-12: "just guesstimate") ----
BASE = {k: '' for k in MASTER}
def add(code, product, notes, **kw):
    counters[code] += 1
    r = dict(BASE, id=f'{code}-{counters[code]:03d}', active='Y', status_note='', loan_type='consumer',
             product=product, notes='ESTIMATED mapping, not from the card. ' + notes, source='estimate', fuel='', brokerage_pct='')
    r.update(kw)
    out.append(r)

# Latitude: strong files (800+) all get tier 1 whatever their job or living situation. Below that the
# profile matters: a stable profile (buying, owning or renting; full or part time; 6+ months in the job)
# gets the better rate, anyone else the next tier down.
LT_BANDS = [  # (score_min, score_max, stable rate, other rate)
    (800, '', 8.99, 8.99), (700, 799, 10.99, 12.99), (600, 699, 12.99, 14.99),
    (500, 599, 14.99, 17.99), (400, 499, 17.99, 22.99)]
for lo, hi, stable, other in LT_BANDS:
    lat = dict(lender='Latitude Financial Services', max_loan=200000, credit_score_min=lo, credit_score_max=hi,
               rate_basis='estimated from Finance Broker tier ranges (tiers 1 to 23)')
    if stable != other:
        add('LT', f'Motor Loan, estimated score {lo}+, stable profile',
            'Stable = buying, owning or renting; full or part time; 6+ months in job.',
            residential='buying,owning,renting', employment='full_time,part_time', job_months_min=6, rate=stable, **lat)
    add('LT', f'Motor Loan, estimated score {lo}+', 'Any profile.', rate=other, **lat)

# Angle: card rates (by vehicle age and home ownership) assumed for scores 700+, loaded below that.
for r in [x for x in out if x['id'].startswith('AN-') and x['status_note']]:
    for lo, hi, load in [(700, '', 0), (600, 699, 1.5), (500, 599, 3.0)]:
        e = {k: r.get(k, '') for k in MASTER}
        add('AN', f"{r['product']}, estimated score {lo}+",
            f'Card rate {r["rate"]}% plus {load}% estimated loading for this score band.',
            **{k: e[k] for k in ('lender', 'condition', 'vehicle_age_min', 'vehicle_age_max', 'residential')},
            credit_score_min=lo, credit_score_max=hi, rate=round(float(r['rate']) + load, 2),
            rate_basis='card rate with estimated score loading')

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
