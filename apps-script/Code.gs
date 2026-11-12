/**
 * AF Partner Estimator backend.
 *
 * One Google Sheet with three tabs:
 *   Rates     one row per lender tier. The calculator picks the cheapest tier the client qualifies for.
 *   Balloons  maximum balloon % by new/used, vehicle age and term (commercial only).
 *   Settings  key | value pairs (residual cap, frequencies, showRate, notify email, capture key).
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
const TAB_BALLOONS = 'Balloons';

const RATE_HEADERS = [
  'id', 'active', 'status_note', 'lender', 'product', 'loan_type', 'condition',
  'vehicle_age_min', 'vehicle_age_max', 'age_at_end_max', 'credit_score_min', 'credit_score_max',
  'residential', 'employment', 'job_months_min', 'asset_backed', 'gst_registered', 'comparable_credit',
  'abn_months_min', 'min_deposit_pct', 'min_loan', 'max_loan', 'min_term_months', 'max_term_months',
  'max_residual_pct', 'doc_type', 'fuel', 'brokerage_pct', 'rate', 'rate_basis', 'source', 'notes'
];
// Only these columns ever leave the Sheet. Lender, product, source and notes stay private.
const PUBLIC_RATE_FIELDS = [
  'id', 'loan_type', 'condition', 'vehicle_age_min', 'vehicle_age_max', 'age_at_end_max',
  'credit_score_min', 'credit_score_max', 'residential', 'employment', 'job_months_min',
  'asset_backed', 'gst_registered', 'comparable_credit', 'abn_months_min', 'min_deposit_pct',
  'min_loan', 'max_loan', 'min_term_months', 'max_term_months', 'max_residual_pct', 'doc_type', 'fuel', 'brokerage_pct', 'rate'
];

const QUOTE_HEADERS = [
  'received', 'quote_ref', 'action', 'created', 'referrer_name', 'referrer_business', 'referrer_code',
  'client_name', 'client_first_name', 'client_last_name', 'client_mobile', 'client_email', 'client_consent', 'loan_type', 'vehicle_condition', 'vehicle_fuel', 'vehicle_year', 'vehicle_age_years', 'balloon_max_pct',
  'residential_status', 'employment_status', 'job_time',
  'asset_backed', 'living_situation', 'gst_registered', 'comparable_credit', 'abn_time',
  'vehicle_price', 'deposit', 'amount_financed', 'term_months', 'frequency', 'residual_pct', 'residual_amount',
  'credit_score', 'credit_score_used', 'result', 'refer_reason', 'repayment', 'indicative_rate', 'est_fee', 'origination_fee', 'brokerage_pct', 'brokerage', 'naf',
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
      const mail = buildEmail_(data);
      MailApp.sendEmail({
        to: String(settings.notify_email), subject: mail.subject, body: mail.text, htmlBody: mail.html,
        name: 'AF Partner Estimator'
      });
    } catch (err) { console.warn(err); }
  }
  return json_({ ok: true, ref: data.quote_ref });
}

/* ---------------- Alert email to Milo ---------------- */

function buildEmail_(d) {
  const v = x => (x === undefined || x === null || x === '') ? '' : String(x);
  const esc = s => v(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = n => (n === '' || n === undefined || n === null || isNaN(+n)) ? '' : '$' + (+n).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const isCom = v(d.loan_type).toLowerCase() === 'commercial';
  const client = v(d.client_name) || 'Client name not provided';
  const referrer = [v(d.referrer_name), v(d.referrer_business)].filter(Boolean).join(', ') || 'Unknown partner';
  const freq = v(d.frequency).toLowerCase();

  const sections = [
    ['Referred by', [
      ['Partner', v(d.referrer_name)],
      ['Business', v(d.referrer_business)],
      ['Partner code', v(d.referrer_code)]
    ]],
    ['Client', [
      ['Name', v(d.client_name) || 'Not provided'],
      ['Mobile', v(d.client_mobile) || 'Not provided', d.client_mobile ? 'tel:' + v(d.client_mobile).replace(/[^0-9+]/g, '') : ''],
      ['Email', v(d.client_email) || 'Not provided', d.client_email ? 'mailto:' + v(d.client_email) : ''],
      ['Agreed to be contacted', v(d.client_consent) || 'No details given'],
      ['Loan type', v(d.loan_type)],
      ['Credit score', v(d.credit_score) + (v(d.credit_score) === "I don't know" ? ` (assumed ${v(d.credit_score_used)})` : '')]
    ].concat(isCom ? [
      ['Asset backed', v(d.asset_backed)],
      ['Renting or boarding', v(d.living_situation)],
      ['GST registered', v(d.gst_registered)],
      ['Comparable credit', v(d.comparable_credit)],
      ['ABN running', v(d.abn_time)]
    ] : [
      ['Residential status', v(d.residential_status)],
      ['Employment', v(d.employment_status)],
      ['Time in job', v(d.job_time)]
    ])],
    ['Vehicle and loan', [
      ['Vehicle', v(d.vehicle_year) ? `${v(d.vehicle_condition) ? d.vehicle_condition + ', ' : ''}${d.vehicle_year} (${d.vehicle_age_years} years old)` : ''],
      ['Fuel type', v(d.vehicle_fuel)],
      ['Vehicle price', money(d.vehicle_price)],
      ['Deposit or trade in', money(d.deposit)],
      ['Amount financed', money(d.amount_financed)],
      ['Term', v(d.term_months) ? `${d.term_months} months` : ''],
      ['Residual', +d.residual_pct ? `${money(d.residual_amount)} (${d.residual_pct}%, max ${d.balloon_max_pct}%)` : '']
    ]],
    ['Estimate shown to partner', [
      ['Result', v(d.result)],
      ['Refer reason', v(d.refer_reason)],
      ['Repayment', d.repayment !== '' && d.repayment !== undefined ? `${money(d.repayment)} ${freq}` : ''],
      ['Indicative rate', v(d.indicative_rate) ? `${d.indicative_rate}% p.a.` : ''],
      ['Lender tier', [v(d.matched_lender), v(d.matched_tier)].filter(Boolean).join(', ')],
      ['Fees financed', [d.est_fee !== '' && d.est_fee !== undefined ? `Establishment ${money(d.est_fee)}` : '', d.origination_fee ? `Origination ${money(d.origination_fee)}` : '', d.brokerage ? `Brokerage ${money(d.brokerage)} (${d.brokerage_pct}%)` : ''].filter(Boolean).join(', ')],
      ['Total financed', money(d.naf)],
      ['Rate card', [v(d.rates_version), v(d.rates_updated)].filter(Boolean).join(', ')]
    ]]
  ];

  const headline = d.repayment !== '' && d.repayment !== undefined
    ? `${money(d.repayment)} ${freq} over ${d.term_months} months`
    : 'Referred to office for assessment';

  const rowsHtml = rows => rows.filter(r => r[1] !== '').map(([k, val, href]) =>
    `<tr><td style="padding:6px 0;color:#6B7280;width:46%;vertical-align:top">${esc(k)}</td>` +
    `<td style="padding:6px 0;color:#0F1424;font-weight:600">${href ? `<a href="${esc(href)}" style="color:#5C8A28">${esc(val)}</a>` : esc(val)}</td></tr>`).join('');

  const html =
    `<div style="background:#F7F9FB;padding:24px 12px;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5">` +
    `<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden">` +
    `<div style="background:#1A2138;color:#fff;padding:22px 24px">` +
    `<div style="color:#8DC63F;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase">New partner estimate &middot; ${esc(d.quote_ref)}</div>` +
    `<div style="font-size:20px;font-weight:800;margin:6px 0 2px">${esc(client)}</div>` +
    `<div style="color:#C9CEDC">From ${esc(referrer)}</div>` +
    `<div style="margin-top:14px;font-size:18px;font-weight:700;color:#8DC63F">${esc(headline)}</div>` +
    `</div><div style="padding:8px 24px 20px">` +
    sections.map(([title, rows]) =>
      `<div style="margin-top:16px;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#5C8A28">${esc(title)}</div>` +
      `<table style="width:100%;border-collapse:collapse;border-top:1px solid #E5E7EB;margin-top:6px">${rowsHtml(rows)}</table>`).join('') +
    `<p style="margin:20px 0 0;color:#6B7280;font-size:12px">Submitted ${esc(Utilities.formatDate(d.received || new Date(), 'Australia/Sydney', 'd MMM yyyy, h:mm a'))} via the AF Partner Estimator. ` +
    `The partner acknowledged the indicative only disclaimer. All details are as entered by the partner and are unverified.</p>` +
    `</div></div></div>`;

  const text = [`New partner estimate ${v(d.quote_ref)}`, `${client}, from ${referrer}`, headline, '']
    .concat(sections.map(([title, rows]) => [title.toUpperCase()].concat(rows.filter(r => r[1] !== '').map(r => `${r[0]}: ${r[1]}`)).join('\n')))
    .join('\n\n');

  // Mobile in the subject so the alert is easy to find when the client's lead comes in.
  const mob = v(d.client_mobile) ? `, ${v(d.client_mobile)}` : '';
  return { subject: `Partner referral: ${client}${mob} from ${referrer} (${v(d.quote_ref)})`, html, text };
}

/** Run from the editor to send a sample alert to the notify_email address. */
function testEmail() {
  const to = readSettings_().notify_email;
  if (!to) throw new Error('Set notify_email in the Settings tab first.');
  const mail = buildEmail_({
    quote_ref: 'AFQ-TEST-0000', received: new Date(), referrer_name: 'Test Partner', referrer_business: 'Test Motors', referrer_code: 'TEST',
    client_name: 'Sample Client', client_mobile: '0400 000 000', client_email: 'sample@example.com', client_consent: 'Yes', loan_type: 'Consumer',
    residential_status: 'Buying', employment_status: 'Full time', job_time: '2 years or more',
    vehicle_year: 2024, vehicle_age_years: 2, vehicle_price: 45000, deposit: 0, amount_financed: 45000, term_months: 60,
    frequency: 'Monthly', residual_pct: 0, result: 'Estimate shown', repayment: 951.44, indicative_rate: 8.49,
    credit_score: '750 to 799', credit_score_used: 750, est_fee: 550, origination_fee: 1250, naf: 46800, matched_tier: 'C-A1', matched_lender: 'Sample Lender A', rates_version: 'TEST'
  });
  MailApp.sendEmail({ to: String(to), subject: '[TEST] ' + mail.subject, body: mail.text, htmlBody: mail.html, name: 'AF Partner Estimator' });
}

/* ---------------- Rate card ---------------- */

function getRateCard_() {
  const settings = readSettings_();
  const sh = sheet_(TAB_RATES);
  const values = sh.getDataRange().getValues();
  const headers = values.shift().map(h => String(h).trim());
  const tiers = values
    .filter(r => r.some(c => c !== ''))
    .filter(r => String(r[headers.indexOf('active')]).trim().toUpperCase() !== 'N')
    .map(r => {
      const o = {};
      // Lender names, products and notes stay private: partners only ever receive the tier id.
      PUBLIC_RATE_FIELDS.forEach(h => { const i = headers.indexOf(h); if (i > -1) o[h] = r[i]; });
      return o;
    });

  const publicSettings = Object.assign({}, settings);
  delete publicSettings.capture_key;
  delete publicSettings.notify_email;
  const updated = settings.updated instanceof Date ? Utilities.formatDate(settings.updated, 'Australia/Sydney', 'yyyy-MM-dd') : String(settings.updated || '');

  return { version: String(settings.version || updated), updated: updated, sample: false, settings: publicSettings, tiers: tiers, balloons: readTable_(TAB_BALLOONS) };
}

function readTable_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const values = sh.getDataRange().getValues();
  const headers = values.shift().map(h => String(h).trim());
  return values.filter(r => r.some(c => c !== '')).map(r => {
    const o = {}; headers.forEach((h, i) => { if (h) o[h] = r[i]; }); return o;
  });
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
  if (!e || [TAB_RATES, TAB_BALLOONS].indexOf(e.range.getSheet().getName()) === -1) return;
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
    const rowsS = [
      ['key', 'value', 'what it does'],
      ['updated', Utilities.formatDate(new Date(), 'Australia/Sydney', 'yyyy-MM-dd'), 'Set automatically when the Rates tab is edited'],
      ['version', '', 'Optional label, e.g. Nov 2026 rate card'],
      ['showRate', 'N', 'Y shows the indicative interest rate to partners. Lender names are never shown.'],
      ['maxTermMonths', 84, 'Longest term offered'],
      ['residualMaxPct', 40, 'Hard cap on any balloon. The Balloons tab sets the limit by vehicle and term.'],
      ['residualBase', 'price', 'price = residual is a % of vehicle price, naf = % of total amount financed'],
      ['nonAssetBackedMinDepositPct', 20, 'Minimum deposit for commercial renters (not asset backed) without comparable credit. Boarders are not offered commercial.'],
      ['consumerFreqs', 'weekly,fortnightly,monthly', 'Frequencies offered to consumer clients'],
      ['commercialFreqs', 'monthly', 'Frequencies offered to commercial clients'],
      ['commercialInAdvance', 'N', 'Y = commercial repayments calculated in advance'],
      ['notify_email', 'milo@acquiredfinance.com', 'Who gets an email for each submitted estimate. Separate several addresses with commas.'],
      ['capture_key', '', 'Optional shared key. Must match captureKey in index.html'],
      ['establishmentFee', 550, 'Added to every loan'],
      ['originationFee', 1250, 'Added to every loan'],
      ['commercialBrokeragePct', 4, 'Brokerage % of amount financed, added to commercial loans'],
      ['consumerBrokeragePct', 0, 'Brokerage % of amount financed, added to consumer loans'],
      ['monthlyAdminFeeMax', 12.5, 'Shown as a note under the repayment, not added to it'],
      ['unknownCreditScore', 500, 'Score assumed when the partner answers I don\'t know'],
      ['docTypes', 'low_doc,no_financials', 'Commercial doc types to quote on. Add full_doc to include full financials rates.']
    ];
    settings.getRange(1, 1, rowsS.length, 3).setValues(rowsS);
    settings.getRange('B2').setNumberFormat('@');
    settings.setFrozenRows(1);
    settings.getRange('A1:C1').setFontWeight('bold');
  }

  const rates = sheet_(TAB_RATES);
  if (rates.getLastRow() === 0) {
    // Import private/rates-master.csv into this tab (File > Import > Replace current sheet).
    rates.getRange(1, 1, 1, RATE_HEADERS.length).setValues([RATE_HEADERS]).setFontWeight('bold');
    rates.setFrozenRows(1);
  }

  const balloons = sheet_(TAB_BALLOONS);
  if (balloons.getLastRow() === 0) {
    const bal = [
      ['condition', 'used_age_min', 'used_age_max', 12, 24, 36, 48, 60, 72, 84],
      ['new', '', '', 0, 0, 40, 35, 40, 25, 25],
      ['used', 0, 3, 0, 0, 30, 25, 40, 15, 15],
      ['used', 4, 4, 0, 0, 30, 25, 40, 15, 0],
      ['used', 5, 5, 0, 0, 30, 25, 20, 0, 0],
      ['used', 6, 6, 0, 0, 20, 10, 0, 0, 0],
      ['used', 7, 7, 0, 0, 20, 0, 0, 0, 0],
      ['used', 8, '', 0, 0, 0, 0, 0, 0, 0]
    ];
    balloons.getRange(1, 1, bal.length, bal[0].length).setValues(bal);
    balloons.getRange(1, 1, 1, bal[0].length).setFontWeight('bold');
    balloons.setFrozenRows(1);
    balloons.getRange(bal.length + 2, 1).setValue('Max balloon % by term in months. Commercial only. used_age_max blank = and older. 60 months set to 40% for new and used up to 4 years old (lender exception).');
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
