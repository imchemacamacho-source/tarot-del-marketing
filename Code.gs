// Deploy this file in Google Apps Script, not api/lead.js (which runs on Vercel).
const SPREADSHEET_ID = '1Y3IIHMdPra7Q0pJMHd6dK0-317lLjUcP0aJagp0NHss';
const SHEET_NAME = 'Registros';
const HEADERS = [
  'Fecha y hora', 'Nombre', 'WhatsApp', 'Tema consultado',
  'Carta 1', 'Carta 2', 'Carta 3', 'Consentimiento comercial',
  'Fecha del consentimiento', 'Clic en WhatsApp',
  'Estado del lead', 'Observaciones', 'ID de registro', 'Email'
];

function jsonResponse_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

// Prevent names, phone numbers, or topics from being interpreted as formulas.
function literal_(value) {
  const text = String(value || '');
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function doPost(e) {
  let data;
  try { data = JSON.parse(e.postData.contents); }
  catch (_) { return jsonResponse_({ ok: false, code: 'INVALID_JSON' }); }
  const email = data && typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  if (!data || typeof data.name !== 'string' || !data.name.trim() || data.name.length > 100 ||
      typeof data.phone !== 'string' || !/^[+0-9() .-]{8,22}$/.test(data.phone.trim()) ||
      data.phone.replace(/\D/g, '').length < 8 ||
      typeof data.topic !== 'string' || !data.topic.trim() || data.topic.length > 120 ||
      typeof data.marketingConsent !== 'boolean' ||
      (data.email !== undefined && typeof data.email !== 'string') ||
      email.length > 254 ||
      (email && !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email)) ||
      typeof data.registrationId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(data.registrationId)) {
    return jsonResponse_({ ok: false, code: 'INVALID_DATA' });
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return jsonResponse_({ ok: false, code: 'BUSY' });
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
    if (!sheet) return jsonResponse_({ ok: false, code: 'SHEET_NOT_FOUND' });
    const headers = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
    // Preserve the existing columns; M tracks retries and N stores the email.
    if (HEADERS.slice(0, 12).some((header, i) => headers[i] !== header) ||
        HEADERS.slice(12).some((header, i) => headers[i + 12] && headers[i + 12] !== header)) {
      return jsonResponse_({ ok: false, code: 'HEADERS_MISMATCH' });
    }
    HEADERS.slice(12).forEach((header, i) => {
      if (!headers[i + 12]) sheet.getRange(1, i + 13).setValue(header);
    });
    const lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      const existing = sheet.getRange(2, 13, lastRow - 1, 1)
        .createTextFinder(data.registrationId).matchEntireCell(true).useRegularExpression(false).findNext();
      if (existing) {
        const savedEmail = String(sheet.getRange(existing.getRow(), 14).getValue() || '');
        if (email && savedEmail !== email) return jsonResponse_({ ok: false, code: 'REGISTRATION_EMAIL_CONFLICT' });
        return jsonResponse_({ ok: true, stored: true, duplicate: true,
          sheet: SHEET_NAME, row: existing.getRow(), registrationId: data.registrationId,
          email: savedEmail, emailStored: Boolean(savedEmail) });
      }
    }
    const row = lastRow + 1;
    const now = new Date();
    sheet.getRange(row, 3).setNumberFormat('@');
    sheet.getRange(row, 14).setNumberFormat('@');
    sheet.getRange(row, 1, 1, HEADERS.length).setValues([[
      now, literal_(data.name.trim()), literal_(data.phone.trim()), literal_(data.topic.trim()),
      '', '', '', data.marketingConsent ? 'Sí' : 'No',
      data.marketingConsent ? now : '', 'No', 'Nuevo', '', data.registrationId, literal_(email)
    ]]);
    SpreadsheetApp.flush();
    if (sheet.getRange(row, 13).getValue() !== data.registrationId ||
        (email && sheet.getRange(row, 14).getValue() !== email)) {
      return jsonResponse_({ ok: false, code: 'WRITE_NOT_CONFIRMED' });
    }
    return jsonResponse_({ ok: true, stored: true,
      sheet: SHEET_NAME, row: row, registrationId: data.registrationId,
      email: email, emailStored: Boolean(email) });
  } catch (_) { return jsonResponse_({ ok: false, code: 'WRITE_FAILED' }); }
  finally { lock.releaseLock(); }
}

function doGet() {
  return jsonResponse_({ ok: true, version: 'tarot-email-capture-1', emailSupport: true });
}
