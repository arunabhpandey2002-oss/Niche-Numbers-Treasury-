/** Niche Numbers Treasury — free Google Sheets connector. */

const TOKEN = 'REPLACE_WITH_A_LONG_RANDOM_TOKEN';
const DEFAULT_SHEET_ID = '';

function openSpreadsheet_(ssid) {
  if (ssid) return SpreadsheetApp.openById(ssid);
  if (DEFAULT_SHEET_ID) return SpreadsheetApp.openById(DEFAULT_SHEET_ID);
  return SpreadsheetApp.getActiveSpreadsheet();
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function assertToken_(token) {
  if (!TOKEN || TOKEN === 'REPLACE_WITH_A_LONG_RANDOM_TOKEN') throw new Error('Set a private TOKEN in Code.gs and deploy a new version.');
  if (token !== TOKEN) throw new Error('Invalid token');
}

function readRanges_(spreadsheet, ranges) {
  const values = {};
  (ranges || []).forEach(function (a1) {
    if (a1 && typeof a1 === 'string') values[a1] = spreadsheet.getRange(a1).getValues();
  });
  return values;
}

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    assertToken_(params.token);
    const spreadsheet = openSpreadsheet_(params.ssid);
    const action = params.action || 'read';
    if (action === 'list') return json_({ ok: true, spreadsheet: spreadsheet.getName(), sheets: spreadsheet.getSheets().map(function (sheet) { return { name: sheet.getName(), rows: sheet.getLastRow(), cols: sheet.getLastColumn() }; }) });
    if (action === 'read') {
      const ranges = String(params.ranges || '').split('|').map(function (value) { return value.trim(); }).filter(Boolean);
      return json_({ ok: true, spreadsheet: spreadsheet.getName(), values: readRanges_(spreadsheet, ranges) });
    }
    return json_({ ok: false, error: 'Unknown action' });
  } catch (error) { return json_({ ok: false, error: String(error) }); }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    assertToken_(body.token);
    const spreadsheet = openSpreadsheet_(body.ssid);
    if (body.action === 'read') return json_({ ok: true, spreadsheet: spreadsheet.getName(), values: readRanges_(spreadsheet, body.ranges || []) });
    if (body.action === 'write') {
      const writes = body.writes || [];
      writes.forEach(function (write) {
        if (!write || typeof write.range !== 'string' || !Array.isArray(write.values)) throw new Error('Invalid write request');
        const range = spreadsheet.getRange(write.range);
        const dimensionsMatch = write.values.length === range.getNumRows() && write.values.every(function (row) { return Array.isArray(row) && row.length === range.getNumColumns(); });
        if (!dimensionsMatch) throw new Error('Write dimensions do not match ' + write.range);
        range.setValues(write.values);
      });
      SpreadsheetApp.flush();
      return json_({ ok: true, spreadsheet: spreadsheet.getName(), wrote: writes.length });
    }
    return json_({ ok: false, error: 'Unknown action' });
  } catch (error) { return json_({ ok: false, error: String(error) }); }
}
