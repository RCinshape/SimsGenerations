// Tree v2: connector wires, status tooltips, and the overlay sim card.
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { sadieTree, serverSource, inlineHtml } = require('./tree-v2-fixture.cjs');

const html = inlineHtml();
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, what, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) throw new Error('timeout: ' + what); await wait(10); }
}
async function load(t) {
  const dom = new JSDOM(html, { url: 'https://fixture.invalid/#g=fixture-backend-000000000000', runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(w) { w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {}; } });
  t.after(() => dom.window.close());
  const w = dom.window, d = w.document;
  await until(() => d.querySelector('.pcard'), 'page boot');
  w.eval(serverSource);
  w.__srv.tree = sadieTree(true);
  w.eval("showFamilyPage('qa-alpha')");
  await until(() => d.querySelector('.tv-stage .tv-sim'), 'tree drawn');
  return w;
}
const key = (w, el, k) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

test('one svg layer behind the nodes with one path group per couple, in that couple\'s colour', async t => {
  const w = await load(t), d = w.document;
  const svgs = d.querySelectorAll('.tv-canvas > svg.tv-wires');
  assert.equal(svgs.length, 1);
  const groups = [...svgs[0].querySelectorAll('g.tv-couple:not(.tv-hang)')];
  assert.deepEqual(groups.map(g => g.dataset.with).sort(), ['2002', '2003', '2004']);
  for (const g of groups) {
    const card = d.querySelector(`.tv-partner[data-partner="${g.dataset.with}"]`);
    const colour = card.style.getPropertyValue('--uc').trim();
    assert.ok(colour);
    assert.equal(g.getAttribute('stroke'), colour, 'group uses the couple colour');
    assert.equal(colour, d.querySelector(`.tv-unit[data-with="${g.dataset.with}"]`).style.getPropertyValue('--uc').trim());
    assert.ok(g.querySelector('path.tv-link'), 'link to the partner');
    assert.ok(g.querySelector('path.tv-descent'), 'line down to this couple\'s children');
  }
  assert.ok(svgs[0].querySelector('g.tv-parents-wire path'), 'parents are wired to the focus sim');
  assert.ok(svgs[0].querySelector('g.tv-pets-wire path[stroke-dasharray]'), 'pets hang on a dotted line');
  assert.equal(svgs[0].getAttribute('aria-hidden'), 'true');
});

test('line style shows the relationship status: dashed ex, dotted co-parent, solid married', async t => {
  const w = await load(t), d = w.document;
  const link = id => d.querySelector(`g.tv-couple[data-with="${id}"] path.tv-link`);
  assert.equal(link('2002').dataset.style, 'dashed'); assert.ok(link('2002').getAttribute('stroke-dasharray'));
  assert.equal(link('2003').dataset.style, 'dotted'); assert.ok(link('2003').getAttribute('stroke-dasharray'));
  assert.equal(link('2004').dataset.style, 'solid'); assert.equal(link('2004').getAttribute('stroke-dasharray'), null);
  const parents = d.querySelector('g.tv-parents-wire path.tv-link');
  assert.equal(parents.dataset.style, 'solid', 'Wilma and Gordon are married');
});

test('every status badge is a focusable button with the right label and tooltip', async t => {
  const w = await load(t), d = w.document;
  const want = { married: 'Married', engaged: 'Engaged (fiancé/fiancée)', dating: 'Dating', ex: 'Ex', divorced: 'Divorced', widowed: 'Widowed', coparent: 'Co-parent', unknown: 'Status unknown' };
  for (const [k, label] of Object.entries(want)) assert.equal(w.TreeV2.STATUS[k].label, label);
  const on = { 2002: 'Ex', 2003: 'Co-parent', 2004: 'Married' };
  for (const [id, label] of Object.entries(on)) {
    const b = d.querySelector(`.tv-partner[data-partner="${id}"] .tv-status`);
    assert.equal(b.tagName, 'BUTTON'); assert.equal(b.getAttribute('aria-label'), label); assert.equal(b.dataset.tip, label);
    b.focus();
    b.dispatchEvent(new w.FocusEvent('focusin', { bubbles: true }));
    const tip = d.querySelector('.tv-tooltip');
    assert.ok(tip && !tip.hidden); assert.equal(tip.getAttribute('role'), 'tooltip'); assert.equal(tip.textContent, label);
    assert.equal(b.getAttribute('aria-describedby'), tip.id);
    b.dispatchEvent(new w.FocusEvent('focusout', { bubbles: true }));
    assert.equal(tip.hidden, true);
  }
  // hover works too, and the parents\' badge says Married
  const pb = d.querySelector('.tv-parents .tv-status');
  pb.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
  assert.equal(d.querySelector('.tv-tooltip').textContent, 'Married');
  // other icons: grave marker, heir crown, occult, pet species
  const tipOf = (id, mark) => d.querySelector(`.tv-node[data-node="${id}"] .tv-mark[data-mark="${mark}"]`);
  assert.equal(tipOf('1001', 'dead').dataset.tip, 'Deceased');
  assert.equal(tipOf('1001', 'heir').dataset.tip, 'Heir of generation 1');
  assert.equal(tipOf('2001', 'occult').dataset.tip, 'Spellcaster');
  assert.equal(tipOf('2301', 'species').dataset.tip, 'Dog');
  for (const m of d.querySelectorAll('.tv-mark')) assert.ok(m.getAttribute('aria-label') && m.tagName === 'BUTTON');
});

test('the sim card is an overlay sheet; Escape closes it and focus returns to the sim; backdrop click closes too', async t => {
  const w = await load(t), d = w.document;
  const sheet = d.querySelector('.tv-panel'), back = d.querySelector('.tv-backdrop');
  assert.equal(sheet.parentElement, d.body, 'not inside the tree layout');
  assert.equal(sheet.hidden, true);
  const btn = d.querySelector('.tv-stage [data-id="2002"]');
  btn.focus(); btn.click();
  assert.equal(sheet.hidden, false); assert.ok(sheet.classList.contains('is-open')); assert.ok(back.classList.contains('is-open'));
  assert.ok(sheet.contains(d.activeElement), 'focus moved into the sheet');
  key(w, d.activeElement, 'Escape');
  assert.equal(sheet.hidden, true); assert.ok(!sheet.classList.contains('is-open'));
  assert.equal(d.activeElement, d.querySelector('.tv-stage [data-id="2002"]'), 'focus is back on the sim');
  d.querySelector('.tv-stage [data-id="2003"]').click();
  assert.equal(sheet.hidden, false);
  back.click();
  assert.equal(sheet.hidden, true);
});

test('classic top-down layout: a bus under the focus, one column per couple, ordered married first; unknown parent gets a placeholder column', async t => {
  const w = await load(t), d = w.document;
  const cols = [...d.querySelectorAll('.tv-kids > .tv-col[data-col]')];
  assert.deepEqual(cols.map(c => c.dataset.col), ['2004', '2003', '2002'], 'married, then co-parent, then ex');
  for (const c of cols) { assert.ok(c.querySelector(':scope > .tv-partner .tv-status')); assert.ok(c.querySelector(':scope > .tv-unit .tv-sim'), 'children sit in the partner\'s column'); }
  assert.ok(d.querySelector('g.tv-bus-wire path'));
  // a child whose other parent is unknown gets its own column headed by a placeholder
  w.__srv.tree.sims.m9 = { id: 'm9', first: 'Solo', last: '', gender: '', age: 'CHILD', kind: 'person', species: '', life: 'alive', cause: '', occults: [], traits: [], asp: '', inHousehold: false, src: 'game', edited: [], gameValues: {} };
  w.__srv.tree.parents.push({ id: 'p:2001:m9', child: 'm9', parent: '2001', type: 'birth', src: 'game' });
  w.eval("showFamilyPage('qa-alpha')");
  await until(() => d.querySelector('.tv-col.tv-hangcol'), 'placeholder column');
  const hang = d.querySelector('.tv-col.tv-hangcol');
  assert.match(hang.querySelector('.tv-ph').textContent, /Other parent unknown/);
  assert.equal(hang.querySelector('.tv-unit .tv-nm').textContent, 'Solo');
  assert.equal(d.querySelector('.tv-kids').lastElementChild, hang);
});

test('css: the sheet is fixed, transform-animated with the spring curve, and honours reduced motion', () => {
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'tree.css'), 'utf8');
  assert.match(css, /\.tv-panel\{position:fixed;[^}]*transition:transform 380ms cubic-bezier\(\.32,\.72,0,1\)/);
  assert.match(css, /\.tv-has-panel|\.tv-body\{display:block\}/);
  assert.ok(!/\.tv-has-panel \.tv-body\{grid/.test(css), 'opening the card never changes the page grid');
  assert.match(css, /prefers-reduced-motion:reduce\)\{[^}]*\.tv-panel/);
  assert.match(css, /translate3d\(0,100%,0\)/, 'bottom sheet on phones');
});

// Real layout checks need a browser; they are skipped when playwright is not installed.
let chromium = null;
try { ({ chromium } = require('playwright')); } catch (e) { /* skipped below */ }
test('opening the sheet does not change the stage box (real browser)', { skip: !chromium && 'playwright not installed' }, async t => {
  let browser;
  try { browser = await chromium.launch(); } catch (e) { t.skip('no browser: ' + e.message); return; }
  t.after(() => browser.close());
  for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const ctx = await browser.newContext({ viewport: vp, reducedMotion: 'no-preference' });
    const page = await ctx.newPage();
    await page.route('**/*', r => r.request().url().startsWith('https://fixture.invalid/') ? r.fulfill({ status: 200, contentType: 'text/html', body: html }) : r.abort());
    await page.goto('https://fixture.invalid/#g=fixture-backend-000000000000');
    await page.waitForSelector('.pcard');
    await page.evaluate(src => { window.eval(src); window.__srv.tree = JSON.parse(window.__tree); }, `window.__tree=${JSON.stringify(JSON.stringify(sadieTree(true)))};` + serverSource);
    await page.evaluate(() => showFamilyPage('qa-alpha'));
    await page.waitForSelector('.tv-stage .tv-sim');
    await page.waitForTimeout(300);
    const box = () => page.evaluate(() => { const r = document.querySelector('.tv-stage').getBoundingClientRect(); return [r.x, r.y + scrollY, r.width, r.height].map(Math.round); });
    const before = await box();
    await page.click('.tv-stage [data-id="2002"]');
    await page.waitForTimeout(600);
    assert.deepEqual(await box(), before, 'stage box while open ' + vp.width);
    assert.ok(await page.evaluate(() => getComputedStyle(document.querySelector('.tv-panel')).position === 'fixed'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    assert.deepEqual(await box(), before, 'stage box after close ' + vp.width);
    assert.equal(await page.evaluate(() => document.querySelector('.tv-panel').hidden), true);
    // no two wires cross or run on top of each other (segments of straight paths; touching ends are joins)
    const segs = await page.evaluate(() => [...document.querySelectorAll('.tv-wires path.tv-wire')].filter(p => !p.closest('.tv-parents-wire')).map((p, i) => {
      const n = (p.getAttribute('d').match(/-?\d+(\.\d+)?/g) || []).map(Number), out = [];
      for (let k = 0; k + 3 < n.length; k += 2) out.push([n[k], n[k + 1], n[k + 2], n[k + 3], i]);
      return out;
    }).flat());
    assert.ok(segs.length > 8);
    const eps = 0.6, cross = (a, b) => {
      const horiz = s => Math.abs(s[1] - s[3]) < eps, vert = s => Math.abs(s[0] - s[2]) < eps;
      if (horiz(a) && horiz(b)) return Math.abs(a[1] - b[1]) < eps && Math.min(Math.max(a[0], a[2]), Math.max(b[0], b[2])) - Math.max(Math.min(a[0], a[2]), Math.min(b[0], b[2])) > 1;
      if (vert(a) && vert(b)) return Math.abs(a[0] - b[0]) < eps && Math.min(Math.max(a[1], a[3]), Math.max(b[1], b[3])) - Math.max(Math.min(a[1], a[3]), Math.min(b[1], b[3])) > 1;
      const [h, v] = horiz(a) ? [a, b] : [b, a];
      if (!horiz(h) || !vert(v)) return false;
      const inside = (x, lo, hi) => x > Math.min(lo, hi) + 1.5 && x < Math.max(lo, hi) - 1.5;
      return inside(v[0], h[0], h[2]) && inside(h[1], v[1], v[3]);
    };
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (segs[i][4] !== segs[j][4]) assert.ok(!cross(segs[i], segs[j]), 'wires touch badly: ' + JSON.stringify([segs[i], segs[j]]));
    await ctx.close();
  }
});
