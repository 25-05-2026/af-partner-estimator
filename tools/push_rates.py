"""Send private/rates-master.csv straight into the Sheet's Rates tab (replaces the whole tab).

Needs private/import.json: {"url": "<web app /exec url>", "key": "<import_key from the Settings tab>"}
Usage: python -I tools/push_rates.py
"""
import csv, json, os, re, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cfg = json.load(open(os.path.join(ROOT, 'private', 'import.json'), encoding='utf-8'))

NUM = re.compile(r'^-?\d+(\.\d+)?$')
def cell(v):
    v = (v or '').strip()
    if NUM.match(v):
        return float(v) if '.' in v else int(v)
    return v

with open(os.path.join(ROOT, 'private', 'rates-master.csv'), encoding='utf-8-sig') as f:
    rows = list(csv.reader(f))
rows = [rows[0]] + [[cell(c) for c in r] for r in rows[1:]]

body = json.dumps({'action': 'import_rates', 'import_key': cfg['key'], 'rows': rows}).encode('utf-8')
req = urllib.request.Request(cfg['url'], data=body, headers={'Content-Type': 'text/plain;charset=utf-8'}, method='POST')
with urllib.request.urlopen(req, timeout=300) as r:   # Apps Script answers via a redirect, which urllib follows
    print(r.read().decode('utf-8')[:300])
