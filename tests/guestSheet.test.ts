import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectColumns, mapGuestTable, normSide, normStatus, tableToText } from '../web/src/guestSheet.ts';
import { sheetExportUrl } from '../server/planning.ts';

test('guest sheet: common headers map to fields, phones stay in the row', () => {
  const rows = mapGuestTable([
    ['Guest Name', 'Side', 'No. of guests', 'Mobile No.', 'Group', 'RSVP', 'Room No'],
    ['Sharma Family', 'Bride side', '4', '+91 98765 43210', 'Close family', 'Yes', '204'],
    ['Rohan Mehta', "Groom's", '', '', 'College', '', ''],
    ['Total', '', '5', '', '', '', ''],
  ]);
  assert.ok(rows);
  assert.equal(rows.length, 2, 'the Total row is skipped');
  assert.deepEqual(
    { ...rows[0] },
    { name: 'Sharma Family', party_size: 4, side: 'bride', group_name: 'Close family', relation: '', status: 'yes', room: '204', note: '', phone: '+919876543210' },
  );
  assert.equal(rows[1].side, 'groom');
  assert.equal(rows[1].party_size, 1);
  assert.equal(rows[1].status, 'pending');
  assert.equal(rows[1].phone, '');
});

test('guest sheet: header row can sit below a title; first + last names join; adults + kids add up', () => {
  const rows = mapGuestTable([
    ['Wedding guest list 2027'],
    [],
    ['First Name', 'Last Name', 'Adults', 'Kids', 'Travelling from'],
    ['Priya', 'Nair', '2', '1', 'Kochi'],
  ]);
  assert.ok(rows);
  assert.equal(rows[0].name, 'Priya Nair');
  assert.equal(rows[0].party_size, 3);
  assert.equal(rows[0].side, '', '"Travelling from" is not the side column');
});

test('guest sheet: no recognisable name column → null (AI fallback)', () => {
  assert.equal(mapGuestTable([['Col A', 'Col B'], ['x', 'y']]), null);
  assert.equal(detectColumns(['Amount', 'Vendor']), null);
  // A lone "Family name" column is the household name.
  assert.equal(detectColumns(['Family Name', 'Count'])?.name, 0);
});

test('guest sheet: side and RSVP values normalise', () => {
  assert.equal(normSide('Ladki wale'), 'bride');
  assert.equal(normSide('Groom side'), 'groom');
  assert.equal(normSide('Common'), 'both');
  assert.equal(normSide('Delhi'), '');
  assert.equal(normStatus('Confirmed'), 'yes');
  assert.equal(normStatus('Regrets'), 'no');
  assert.equal(normStatus('tentative'), 'maybe');
  assert.equal(normStatus(''), 'pending');
});

test('guest sheet: AI fallback text joins cells', () => {
  assert.equal(tableToText([['A', 'B'], ['', ''], ['c', '']]), 'A | B\nc');
});

test('google sheets link: only docs.google.com sheet ids become export URLs', () => {
  const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
  assert.equal(sheetExportUrl(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=42`), `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=42`);
  assert.equal(sheetExportUrl(`https://docs.google.com/spreadsheets/d/${id}/edit?usp=sharing`), `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`);
  assert.equal(sheetExportUrl(`https://evil.example/spreadsheets/d/${id}`), null);
  assert.equal(sheetExportUrl(`https://docs.google.com.evil.example/spreadsheets/d/${id}`), null);
  assert.equal(sheetExportUrl('http://docs.google.com/spreadsheets/d/short'), null);
  assert.equal(sheetExportUrl(42), null);
});
