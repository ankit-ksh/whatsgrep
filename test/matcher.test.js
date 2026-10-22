import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileRule, matches } from '../src/matcher.js';

const rule = compileRule({
  name: 'coupon',
  chats: ['Buy & Sell'],
  all: [['sell', 'selling'], ['srr', 'bf', 'lunch']],
  none: [['buy', 'buying', 'anyone selling']],
});
const hit = (text, chat = 'Buy & Sell') => matches(rule, text, chat);

test('seller messages match', () => {
  assert.ok(hit('Selling SRR bf coupon'));
  assert.ok(hit('sell lunch coupon srr'));
});
test('buyer messages are dropped', () => {
  assert.ok(!hit('anyone selling srr bf coupon'));
  assert.ok(!hit('buying srr coupon'));
});
test('whole words only', () => {
  assert.ok(!hit('reseller of srr'));
  assert.ok(!hit('selling lunchroom'));
});
test('chat filter applies', () => {
  assert.ok(!hit('selling srr bf', 'Other group'));
  assert.ok(hit('selling srr bf', 'buy & sell'));
});
test('re: prefix is a raw regex', () => {
  const r = compileRule({ name: 'x', all: ['re:s+r+r'] });
  assert.ok(matches(r, 'ssrrr coupon', 'any'));
});
test('rule without conditions never matches', () => {
  assert.ok(!matches(compileRule({ name: 'e' }), 'anything', 'c'));
});
test('1-to-1 chats match by phone number', () => {
  const r = compileRule({ name: 'p', chats: ['+91 98765-43210'], all: ['hi'] });
  assert.ok(matches(r, 'hi', ['', '919876543210@c.us']));
  assert.ok(!matches(r, 'hi', ['', '911111111111@c.us']));
});
test('phone number without country code matches by suffix', () => {
  const r = compileRule({ name: 'p', chats: ['9876501234'], all: ['hi'] });
  assert.ok(matches(r, 'hi', ['', '919876501234@c.us']));
  assert.ok(!matches(r, 'hi', ['', '919999999999@c.us']));
});
test('chat entries: contains:, re:, exact:', () => {
  const t = (chats, name) => matches(compileRule({ name: 'c', chats, all: ['hi'] }), 'hi', [name]);
  assert.ok(t(['contains:buy & sell'], 'Hostel Buy & Sell IITX'));
  assert.ok(!t(['Buy & Sell'], 'Hostel Buy & Sell IITX'));
  assert.ok(t(['re:^buy.*sell'], 'Buy and Sell'));
  assert.ok(!t(['re:^buy.*sell'], 'My Buy and Sell'));
  assert.ok(t(['exact:Buy & Sell'], 'buy & sell'));
});
test('chats as an object of lists', () => {
  const r = compileRule({ name: 'o', chats: { exact: ['Mess'], contains: ['buy', 'sell'] }, all: ['hi'] });
  assert.ok(matches(r, 'hi', ['mess']));
  assert.ok(matches(r, 'hi', ['Hostel Sell']));
  assert.ok(!matches(r, 'hi', ['Mess 2']));
});
test('chats: any / "*" / omitted match every chat', () => {
  for (const chats of ['all', 'any', 'everywhere', '*', ['Mess', 'all'], undefined]) {
    assert.ok(matches(compileRule({ name: 'a', chats, all: ['hi'] }), 'hi', ['Whatever']));
  }
  assert.ok(!matches(compileRule({ name: 'a', chats: 'exact:any', all: ['hi'] }), 'hi', ['Whatever']));
  assert.ok(matches(compileRule({ name: 'a', chats: 'exact:any', all: ['hi'] }), 'hi', ['any']));
});
test('any: one term from the list is enough', () => {
  const r = compileRule({ name: 'a', any: ['laptop', 'phone', 'tablet'] });
  assert.ok(matches(r, 'selling a PHONE', ['c']));
  assert.ok(!matches(r, 'selling a bike', ['c']));
});
test('any combined with all and none: all must hold', () => {
  const r = compileRule({ name: 'a', any: ['laptop', 'phone'], all: ['sale'], none: ['wanted'] });
  assert.ok(matches(r, 'phone for sale', ['c']));
  assert.ok(!matches(r, 'phone wanted, sale?', ['c']));
  assert.ok(!matches(r, 'bike for sale', ['c']));
  assert.ok(!matches(r, 'phone only', ['c']));
});

// --- from / message sections ---
const R = (rule) => compileRule({ name: 'r', ...rule });
const m = (rule, text, chat = ['Any Chat']) => matches(rule, text, chat);

test('message: any / all / none together', () => {
  const r = R({ message: { any: ['laptop', 'phone'], all: [['selling', 'for sale']], none: ['wanted'] } });
  assert.ok(m(r, 'phone for sale'));
  assert.ok(!m(r, 'phone wanted for sale'));
  assert.ok(!m(r, 'selling a bike'));
  assert.ok(!m(r, 'laptop only'));
});
test('message as a plain list means any', () => {
  const r = R({ message: ['giveaway', 'free pickup'] });
  assert.ok(m(r, 'Big GIVEAWAY today'));
  assert.ok(!m(r, 'nothing here'));
});
test('from: list, grouped kinds, and everywhere words', () => {
  const msg = { message: ['hi'] };
  assert.ok(m(R({ from: ['Mess', 'contains:market'], ...msg }), 'hi', ['Hostel Market']));
  assert.ok(m(R({ from: { exact: ['Mess'], contains: ['market'] }, ...msg }), 'hi', ['Mess']));
  assert.ok(!m(R({ from: { exact: ['Mess'] }, ...msg }), 'hi', ['Mess 2']));
  for (const from of ['all', 'everywhere', 'any', '*', undefined]) assert.ok(m(R({ from, ...msg }), 'hi', ['x']));
});
test('from: none excludes chats, all requires several matches', () => {
  const msg = { message: ['hi'] };
  const excl = R({ from: { contains: ['market'], none: ['contains:old'] }, ...msg });
  assert.ok(m(excl, 'hi', ['New Market']));
  assert.ok(!m(excl, 'hi', ['Old Market']));
  const onlyNone = R({ from: { none: ['Spam'] }, ...msg });
  assert.ok(m(onlyNone, 'hi', ['Friends']));
  assert.ok(!m(onlyNone, 'hi', ['spam']));
  const both = R({ from: { all: ['contains:hostel', 'contains:market'] }, ...msg });
  assert.ok(m(both, 'hi', ['Hostel Market']));
  assert.ok(!m(both, 'hi', ['Hostel Chat']));
});
test('old-style chats / top-level any/all/none still work', () => {
  const r = R({ chats: ['Mess'], any: ['coupon'], none: ['buy'] });
  assert.ok(m(r, 'coupon here', ['Mess']));
  assert.ok(!m(r, 'buy coupon', ['Mess']));
  assert.ok(!m(r, 'coupon here', ['Other']));
});

// --- exclude, exact/contains in message, optional message ---
test('exclude works in message and from, and none is an alias', () => {
  const r = R({ from: { exclude: ['contains:old'] , any: ['contains:market'] }, message: { any: ['bike'], exclude: ['wanted'] } });
  assert.ok(m(r, 'bike here', ['New Market']));
  assert.ok(!m(r, 'bike wanted', ['New Market']));
  assert.ok(!m(r, 'bike here', ['Old Market']));
  assert.ok(m(R({ message: { any: ['bike'], none: ['wanted'] } }), 'bike', ['x']));
  assert.ok(!m(R({ message: { any: ['bike'], none: ['wanted'] } }), 'bike wanted', ['x']));
});
test('exclude takes exact / contains / re groups', () => {
  const r = R({ message: { any: ['laptop'], exclude: { exact: ['wtb'], contains: ['wanted'], re: ['looking\\s+for'] } } });
  assert.ok(m(r, 'laptop for sale'));
  assert.ok(!m(r, 'laptop WTB'));
  assert.ok(!m(r, 'laptop unwanted'));       // contains: matches inside a word
  assert.ok(!m(r, 'laptop looking  for'));
  assert.ok(m(r, 'laptop wtbx'));             // exact: whole word only
});
test('message words: exact (default) vs contains', () => {
  assert.ok(m(R({ message: ['bike'] }), 'a bike'));
  assert.ok(!m(R({ message: ['bike'] }), 'motorbike'));
  assert.ok(m(R({ message: ['contains:bike'] }), 'motorbike'));
  assert.ok(!m(R({ message: ['exact:bike'] }), 'bikes'));
  assert.ok(m(R({ message: { contains: ['bik'] } }), 'bikes'));
});
test('message is optional when from has any', () => {
  const r = R({ from: ['Alerts'] });
  assert.ok(m(r, 'anything at all', ['Alerts']));
  assert.ok(!m(r, 'anything at all', ['Other']));
  assert.ok(!m(R({ from: 'all' }), 'x', ['Other']));   // nothing to look for: never fires
});
test('all as exact/contains object requires every entry', () => {
  const r = R({ message: { all: { contains: ['sell', 'laptop'] } } });
  assert.ok(m(r, 'reseller of laptops'));
  assert.ok(!m(r, 'reseller only'));
});
