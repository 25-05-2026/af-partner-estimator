/**
 * AF Partner Estimator backend.
 *
 * One Google Sheet with three tabs:
 *   Rates     one row per lender tier. The calculator picks the cheapest tier the client qualifies for.
 *   Settings  key | value pairs (residual limits, frequencies, showRate, notify email, capture key).
 *   Quotes    every saved or printed estimate lands here. New columns are added automatically.
 *
 * GET  <web app url>?action=rates   returns the live rate card as JSON.
 * POST <web app url>                appends an estimate to Quotes.
 *
 * Run setup() once from the editor to create the tabs with sample data.
 */

const TAB_RATES = 'Rates';
const TAB_SETTINGS = 'Settings';
const TAB_QUOTES = 'Quotes';

const RATE_HEADERS = [
  'id', 'active', 'lender', 'loan_type', 'tier',
  'vehicle_age_min', 'vehicle_age_max', 'age_at_end_max',
  'residential', 'employment', 'job_months_min',
  'asset_backed', 'gst_registered', 'comparable_credit', 'abn_months_min',
  'min_deposit_pct', 'rate', 'est_fee', 'monthly_fee', 'brokerage_pct',
  'min_loan', 'max_loan', 'max_term_months', 'max_residual_pct', 'notes'
];

const QUOTE_HEADERS = [
  'received', 'quote_ref', 'action', 'created', 'referrer_name', 'referrer_business', 'referrer_code',
  'client_name', 'client_mobile', 'client_consent', 'loan_type', 'vehicle_year', 'vehicle_age_years',
  'residential_status', 'employment_status', 'job_time',
  'asset_backed', 'gst_registered', 'comparable_credit', 'abn_time',
  'vehicle_price', 'deposit', 'amount_financed', 'term_months', 'frequency', 'residual_pct', 'residual_amount',
  'result', 'repayment', 'indicative_rate', 'est_fee', 'monthly_fee', 'brokerage', 'naf',
  'matched_tier', 'matched_lender', 'rates_version', 'rates_updated', 'disclaimer_ack', 'page', 'user_agent'
];

/* ---------------- Web app ---------------- */

function doGet(e) {
  return json_(getRateCard_());
}

function doPost(e) {
  let data;
  try { data = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad json' }); }

  const settings = readSettings_();
  if (settings.capture_key && data.key !== settings.capture_key) return json_({ ok: false, error: 'bad key' });
  delete data.key;
  data.received = new Date();
  // Look up the lender from the private Rates tab using the matched tier id.
  if (data.matched_tier) {
    const rows = sheet_(TAB_RATES).getDataRange().getValues();
    const h = rows[0], iId = h.indexOf('id'), iL = h.indexOf('lender');
    const hit = rows.find(r => String(r[iId]) === String(data.matched_tier));
    if (hit && iL > -1) data.matched_lender = hit[iL];
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_(TAB_QUOTES);
    if (sh.getLastRow() === 0) sh.appendRow(QUOTE_HEADERS);
    let headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    // Add any new fields as new columns so the sheet keeps up as questions are added.
    Object.keys(data).forEach(k => {
      if (headers.indexOf(k) === -1) { sh.getRange(1, headers.length + 1).setValue(k); headers.push(k); }
    });
    sh.appendRow(headers.map(h => data[h] === undefined ? '' : data[h]));
  } finally {
    lock.releaseLock();
  }

  if (settings.notify_email) {
    try {
      MailApp.sendEmail(settings.notify_email,
        `New partner estimate ${data.quote_ref} from ${data.referrer_name || 'unknown'}`,
        Object.keys(data).filter(k => k !== 'user_agent').map(k => `${k}: ${data[k]}`).join('\n'));
    } catch (err) { console.warn(err); }
  }
  return json_({ ok: true, ref: data.quote_ref });
}

/* ---------------- Rate card ---------------- */

function getRateCard_() {
  const settings = readSettings_();
  const sh = sheet_(TAB_RATES);
  const values = sh.getDataRange().getValues();
  const headers = values.shift().map(h => String(h).trim());
  const tiers = values
    .filter(r => r.some(c => c !== ''))
    .map(r => {
      const o = {};
      // Lender names and notes stay private: partners only ever receive the tier id.
      headers.forEach((h, i) => { if (h && h !== 'lender' && h !== 'notes') o[h] = r[i] instanceof Date ? r[i].toISOString() : r[i]; });
      return o;
    });

  const publicSettings = Object.assign({}, settings);
  delete publicSettings.capture_key;
  delete publicSettings.notify_email;
  const updated = settings.updated instanceof Date ? Utilities.formatDate(settings.updated, 'Australia/Sydney', 'yyyy-MM-dd') : String(settings.updated || '');

  return { version: String(settings.version || updated), updated: updated, sample: false, settings: publicSettings, tiers: tiers };
}

function readSettings_() {
  const sh = sheet_(TAB_SETTINGS);
  const out = {};
  if (sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(([k, v]) => { if (k) out[String(k).trim()] = v; });
  return out;
}

/** Stamp Settings > updated whenever the Rates tab is edited, so partners see when rates last changed. */
function onEdit(e) {
  if (!e || e.range.getSheet().getName() !== TAB_RATES) return;
  const sh = sheet_(TAB_SETTINGS);
  const rows = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === 'updated') {
      sh.getRange(i + 2, 2).setValue(Utilities.formatDate(new Date(), 'Australia/Sydney', 'yyyy-MM-dd'));
      sh.getRange(i + 2, 2).setNumberFormat('@');
      return;
    }
  }
}

/* ---------------- Setup ---------------- */

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const settings = sheet_(TAB_SETTINGS);
  if (settings.getLastRow() === 0) {
    settings.getRange(1, 1, 14, 3).setValues([
      ['key', 'value', 'what it does'],
      ['updated', Utilities.formatDate(new Date(), 'Australia/Sydney', 'yyyy-MM-dd'), 'Set automatically when the Rates tab is edited'],
      ['version', '', 'Optional label, e.g. Nov 2026 rate card'],
      ['showRate', 'N', 'Y shows the indicative interest rate to partners. Lender names are never shown.'],
      ['maxTermMonths', 84, 'Longest term offered'],
      ['residualMaxPct', 30, 'Largest residual allowed (commercial only)'],
      ['residualMaxTermMonths', 60, 'Residuals only on terms up to this many months'],
      ['residualBase', 'price', 'price = residual is a % of vehicle price, naf = % of total amount financed'],
      ['nonAssetBackedMinDepositPct', 20, 'Minimum deposit for non asset backed commercial clients'],
      ['consumerFreqs', 'weekly,fortnightly,monthly', 'Frequencies offered to consumer clients'],
      ['commercialFreqs', 'monthly', 'Frequencies offered to commercial clients'],
      ['commercialInAdvance', 'N', 'Y = commercial repayments calculated in advance'],
      ['notify_email', '', 'Email address to notify on each saved estimate (optional)'],
      ['capture_key', '', 'Optional shared key. Must match captureKey in index.html']
    ]);
    settings.getRange('B2').setNumberFormat('@');
    settings.setFrozenRows(1);
    settings.getRange('A1:C1').setFontWeight('bold');
  }

  const rates = sheet_(TAB_RATES);
  if (rates.getLastRow() === 0) {
    const sample = [
      ['C-A1','Y','Sample Lender A','consumer','Prime, newer vehicle',0,3,15,'buying,owning,renting','full_time,part_time',6,'','','','','',8.49,995,8,0,5000,150000,84,'','Sample only'],
      ['C-B1','Y','Sample Lender B','consumer','Older vehicle',8,15,20,'buying,owning,renting','full_time,part_time',6,'','','','','',11.49,1195,10,0,5000,80000,72,'','Sample only'],
      ['B-A1','Y','Sample Lender D','commercial','Asset backed, newer vehicle',0,5,15,'','','','Y','','',24,'',7.49,495,4.95,3,10000,250000,84,30,'Sample only'],
      ['B-B1','Y','Sample Lender E','commercial','Non asset backed',0,10,15,'','','','','Y','Y',24,'',9.49,595,4.95,3,10000,150000,60,30,'Sample only']
    ];
    rates.getRange(1, 1, 1, RATE_HEADERS.length).setValues([RATE_HEADERS]).setFontWeight('bold');
    rates.getRange(2, 1, sample.length, RATE_HEADERS.length).setValues(sample);
    rates.setFrozenRows(1);
  }

  const quotes = sheet_(TAB_QUOTES);
  if (quotes.getLastRow() === 0) {
    quotes.getRange(1, 1, 1, QUOTE_HEADERS.length).setValues([QUOTE_HEADERS]).setFontWeight('bold');
    quotes.setFrozenRows(1);
  }
}

/* ---------------- Helpers ---------------- */

function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
