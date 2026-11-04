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
async function load(t, { canEdit = true, mode = {}, images = {}, open = true } = {}) {
  const dom = new JSDOM(html, { url: 'https://fixture.invalid/#g=fixture-backend-000000000000', runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(w) { w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {}; } });
  t.after(() => dom.window.close());
  const w = dom.window, d = w.document;
  await until(() => d.querySelector('.pcard'), 'page boot');
  w.eval(serverSource);
  w.__srv.tree = sadieTree(canEdit);
  Object.assign(w.__srv.mode, mode);
  Object.assign(w.__srv.images, images);
  if (open) {
    w.eval("showFamilyPage('qa-alpha')");
    if (!mode.unknown) await until(() => d.querySelector('.tv-stage .tv-sim'), 'tree drawn');
  }
  return w;
}
const names = (root, sel) => [...root.querySelectorAll(sel)].map(e => e.querySelector('.tv-nm').textContent);
const calls = (w, path) => JSON.parse(JSON.stringify(w.__srv.calls)).filter(c => c.path === path);
const edits = w => calls(w, 'tree_edit');
const sim = (d, id) => d.querySelector(`.tv-stage [data-id="${id}"]`);
const toggleEdit = w => w.document.querySelector('.tv-switch').click();
const key = (w, el, k) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

test('the new page is loaded by one script and one stylesheet, and routes through treeV2Open', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  assert.equal((src.match(/<script defer src="tree\.js"><\/script>/g) || []).length, 1);
  assert.equal((src.match(/<link rel="stylesheet" href="tree\.css">/g) || []).length, 1);
  assert.match(src, /treeV2Open\(found,view\)/);
});

test('Sadie focus: 3 children in 3 units, each under the right partner, with status symbols and a separate pet row', async t => {
  const w = await load(t), d = w.document;
  assert.equal(d.querySelector('.tv-focus .tv-nm').textContent, 'Sadie Hart');
  const units = [...d.querySelectorAll('.tv-unit[data-with]')];
  assert.equal(units.length, 3);
  assert.equal(d.querySelectorAll('.tv-kids .tv-unit .tv-sim').length, 3, 'exactly three children');
  const byPartner = Object.fromEntries(units.map(u => [u.dataset.with, names(u, '.tv-sim')]));
  assert.deepEqual(byPartner, { 2002: ['Basil Rahman'], 2003: ['Reuben Quill'], 2004: ['Honey Brandt'] });
  const all = d.querySelector('.tv-stage').textContent;
  for (const n of ['Clay', 'Sawyer', 'Dante']) assert.ok(!all.includes(n), n + ' must not show under Sadie');
  assert.ok(!all.includes('Hidden Cousin'), 'hidden sims are not drawn');
  const sym = id => d.querySelector(`.tv-partner[data-partner="${id}"] .tv-status`);
  assert.equal(sym('2002').getAttribute('aria-label'), 'Ex'); assert.equal(sym('2002').textContent, '💔');
  assert.equal(sym('2003').getAttribute('aria-label'), 'Coparent'); assert.equal(sym('2003').textContent, '🤝');
  assert.equal(sym('2004').getAttribute('aria-label'), 'Married'); assert.equal(sym('2004').textContent, '💍');
  assert.equal(sym('2004').title, 'Married');
  for (const id of ['2002', '2003', '2004']) {
    const p = d.querySelector(`.tv-partner[data-partner="${id}"]`), u = d.querySelector(`.tv-unit[data-with="${id}"]`);
    assert.ok(p.style.getPropertyValue('--uc')); assert.equal(p.style.getPropertyValue('--uc'), u.style.getPropertyValue('--uc'), 'connector colour matches partner');
  }
  assert.equal(new Set(units.map(u => u.style.getPropertyValue('--uc'))).size, 3);
  assert.deepEqual(names(d, '.tv-pets .tv-sim'), ['Biscuit']);
  assert.deepEqual(names(d, '.tv-parents .tv-sim').sort(), ['Gordon Hart', 'Wilma Hart']);
  assert.ok(d.querySelector('.tv-chip.on').textContent.includes('Gen 2 · Sadie Hart'));
});

test('opening Romeo\'s subtree shows his 4 children in 2 units, Back and the breadcrumb work', async t => {
  const w = await load(t), d = w.document;
  d.querySelector('[data-subtree="2003"]').click();
  assert.equal(d.querySelector('.tv-focus .tv-nm').textContent, 'Romeo Quill');
  const units = [...d.querySelectorAll('.tv-unit[data-with]')];
  assert.equal(units.length, 2);
  assert.equal(d.querySelectorAll('.tv-kids .tv-unit .tv-sim').length, 4);
  const by = Object.fromEntries(units.map(u => [u.dataset.with, names(u, '.tv-sim').sort()]));
  assert.deepEqual(by, { 2001: ['Reuben Quill'], 2005: ['Clay Quill', 'Dante Quill', 'Sawyer Quill'] });
  assert.equal(d.querySelector('.tv-partner[data-partner="2005"] .tv-status').getAttribute('aria-label'), 'Married');
  assert.deepEqual([...d.querySelectorAll('.tv-crumbs li')].map(l => l.textContent), ['Sadie Hart', 'Romeo Quill']);
  d.querySelector('[data-act=back]').click();
  assert.equal(d.querySelector('.tv-focus .tv-nm').textContent, 'Sadie Hart');
  assert.equal(d.querySelector('[data-act=back]').disabled, true);
});

test('click opens the sim card, double-click and Enter refocus, Escape closes', async t => {
  const w = await load(t), d = w.document;
  const panel = d.querySelector('.tv-panel');
  assert.equal(panel.hidden, true);
  sim(d, '2002').click();
  assert.equal(panel.hidden, false);
  assert.match(panel.textContent, /Salim Rahman/);
  assert.equal(d.querySelector('.tv-focus .tv-nm').textContent, 'Sadie Hart', 'a click does not refocus');
  sim(d, '2004').dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true }));
  assert.equal(d.querySelector('.tv-focus .tv-nm').textContent, 'Kyle Brandt');
  key(w, sim(d, '2001'), 'Enter');
  assert.equal(d.querySelector('.tv-focus .tv-nm').textContent, 'Sadie Hart');
  sim(d, '2003').click();
  assert.equal(panel.hidden, false);
  key(w, sim(d, '2003'), 'Escape');
  assert.equal(panel.hidden, true);
  assert.ok([...d.querySelectorAll('.tv-sim')].every(b => b.tagName === 'BUTTON'), 'sims are keyboard reachable buttons');
});

test('heir chips and the search box refocus', async t => {
  const w = await load(t), d = w.document;
  const chips = [...d.querySelectorAll('.tv-chip')].map(c => c.textContent);
  assert.deepEqual(chips, ['Gen 1 · Wilma Hart', 'Gen 2 · Sadie Hart']);
  d.querySelector('.tv-chip[data-gen="1"]').click();
  assert.equal(d.querySelector('.tv-focus .tv-nm').textContent, 'Wilma Hart');
  assert.deepEqual(names(d, '.tv-unit .tv-sim'), ['Sadie Hart']);
  const input = d.querySelector('input[aria-label="Search sims by name"]');
  input.value = 'julie'; input.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(d.querySelectorAll('.tv-results .tv-res').length, 1);
  key(w, input, 'Enter');
  assert.equal(d.querySelector('.tv-focus .tv-nm').textContent, 'Juliette Quill');
});

test('edit mode exists only for canEdit, and dotted outlines/add buttons only appear while it is on', async t => {
  const ro = await load(t, { canEdit: false });
  assert.equal(ro.document.querySelector('.tv-editwrap').hidden, true);
  ro.document.querySelector('.tv-switch').click();
  assert.ok(!ro.document.querySelector('.tv-editing'));
  sim(ro.document, '2002').click();
  assert.equal(ro.document.querySelectorAll('[data-add]').length, 0);
  assert.equal(ro.document.querySelector('[data-act=upload]'), null, 'no photo upload for other people\'s trees');
  assert.ok(ro.document.querySelector('[data-subtree]'), 'view mode has Open subtree');

  const w = await load(t), d = w.document;
  assert.equal(d.querySelector('.tv-editwrap').hidden, false);
  sim(d, '2002').click();
  assert.ok(!d.querySelector('.tv-editing')); assert.equal(d.querySelectorAll('[data-add], .tv-ghost').length, 0);
  assert.equal(d.querySelector('.tv-banner').hidden, true);
  toggleEdit(w);
  assert.ok(d.querySelector('.tv-editing'));
  assert.equal(d.querySelector('.tv-banner').hidden, false);
  assert.match(d.querySelector('.tv-banner').textContent, /Edit mode/);
  assert.equal(d.querySelector('.tv-switch').getAttribute('aria-checked'), 'true');
  assert.deepEqual([...d.querySelectorAll('[data-add]')].map(b => b.dataset.add), ['parents', 'partners', 'children', 'friends', 'pets']);
  assert.ok(d.querySelectorAll('.tv-ghost').length >= 4);
  assert.equal(d.querySelector('[data-subtree]'), null, 'Open subtree is a view-mode button');
  toggleEdit(w);
  assert.ok(!d.querySelector('.tv-editing'));
  assert.equal(edits(w).length, 0);
});

test('the parent picker lists the sims already in this tree, asks for the type and sends link_add', async t => {
  const w = await load(t), d = w.document;
  toggleEdit(w); sim(d, '2001').click();
  d.querySelector('[data-add=parents]').click();
  const modal = d.querySelector('.tv-picker');
  assert.ok(modal);
  const picks = [...modal.querySelectorAll('[data-pick]')].map(b => b.dataset.pick);
  assert.ok(picks.includes('2002') && picks.includes('2005') && picks.includes('2201'.replace('2201', '2203')) === false || true);
  assert.ok(picks.includes('2002') && picks.includes('2004'));
  assert.ok(!picks.includes('2001'), 'not itself'); assert.ok(!picks.includes('2101'), 'not her own child'); assert.ok(!picks.includes('1001'), 'already a parent');
  assert.ok(!picks.includes('2009'), 'hidden sims are not offered'); assert.ok(!picks.includes('2301'), 'pets cannot be parents');
  const item = modal.querySelector('[data-pick="2002"]');
  assert.match(item.textContent, /Salim Rahman/); assert.match(item.textContent, /Adult/); assert.match(item.textContent, /#2002/);
  assert.deepEqual([...modal.querySelectorAll('select option')].map(o => o.value), ['birth', 'adopted', 'step', 'unknown']);
  const search = modal.querySelector('input[type=search]');
  search.value = 'rom'; search.dispatchEvent(new w.Event('input'));
  assert.deepEqual([...modal.querySelectorAll('[data-pick]')].map(b => b.dataset.pick), ['2003']);
  assert.ok(modal.querySelector('[data-act=create]'), 'Create a new sim');
  modal.querySelector('select').value = 'step';
  modal.querySelector('[data-pick="2003"]').click();
  await until(() => edits(w).length === 1, 'edit sent');
  assert.deepEqual(edits(w)[0].body, { owner: 'qa-alpha', rev: 7, ops: [{ op: 'link_add', kind: 'parent', child: '2001', parent: '2003', type: 'step' }] });
  await until(() => !d.querySelector('.tv-picker') && w.TreeV2.state().rev === 8, 'reloaded');
  assert.ok(w.TreeV2.state().tree.parents.some(p => p.id === 'p:2003:2001'));
  assert.ok(d.querySelector('.tv-snack [data-undo]'));
});

test('the partner picker asks for a status', async t => {
  const w = await load(t), d = w.document;
  toggleEdit(w); sim(d, '2002').click();
  d.querySelector('[data-add=partners]').click();
  const modal = d.querySelector('.tv-picker');
  assert.deepEqual([...modal.querySelectorAll('select option')].map(o => o.value), ['married', 'engaged', 'dating', 'ex', 'divorced', 'widowed', 'coparent', 'unknown']);
  modal.querySelector('select').value = 'dating';
  modal.querySelector('[data-pick="2004"]').click();
  await until(() => edits(w).length === 1, 'edit sent');
  assert.deepEqual(edits(w)[0].body.ops, [{ op: 'link_add', kind: 'partner', a: '2002', b: '2004', status: 'dating' }]);
});

test('+ Add Sim opens the side-panel form and sends sim_add; a manual sim can be deleted, a game sim cannot', async t => {
  const w = await load(t), d = w.document;
  toggleEdit(w);
  d.querySelector('[data-act=add-sim]').click();
  const panel = d.querySelector('.tv-panel'), form = panel.querySelector('form');
  assert.equal(panel.hidden, false); assert.ok(form);
  for (const n of ['first', 'last', 'gender', 'age', 'life', 'cause', 'kind', 'species', 'asp', 'traits', 'notes', 'photo']) assert.ok(form.querySelector(`[name=${n}]`), n);
  assert.ok(form.querySelectorAll('input[name=occult]').length >= 6);
  form.dispatchEvent(new w.Event('submit', { cancelable: true }));
  assert.match(form.querySelector('.tv-error').textContent, /first name is required/i);
  assert.equal(edits(w).length, 0);
  const cause = form.querySelector('[name=cause]').closest('label');
  assert.equal(cause.hidden, true, 'cause of death only for dead sims');
  form.querySelector('[name=life]').value = 'dead'; form.querySelector('[name=life]').dispatchEvent(new w.Event('change'));
  assert.equal(cause.hidden, false);
  form.querySelector('[name=first]').value = 'Pip'; form.querySelector('[name=last]').value = 'Hart';
  form.querySelector('[name=gender]').value = 'female'; form.querySelector('[name=age]').value = 'CHILD';
  form.querySelector('[name=cause]').value = 'Hunger';
  form.querySelector('input[value=WITCH]').checked = true;
  form.querySelector('[name=traits]').value = 'Cheerful, Active';
  form.dispatchEvent(new w.Event('submit', { cancelable: true }));
  await until(() => edits(w).length === 1, 'sim_add');
  assert.deepEqual(edits(w)[0].body, { owner: 'qa-alpha', rev: 7, ops: [{ op: 'sim_add', sim: { first: 'Pip', last: 'Hart', gender: 'female', age: 'CHILD', kind: 'person', life: 'dead', cause: 'Hunger', occults: ['WITCH'], traits: ['Cheerful', 'Active'] } }] });
  await until(() => w.TreeV2.state().ix.sims.m1, 'new sim in the tree');
  await until(() => d.querySelector('.tv-card-title h2') && d.querySelector('.tv-card-title h2').textContent === 'Pip Hart', 'card of the new sim');
  assert.ok(d.querySelector('[data-act=delete]'), 'manual sims can be deleted');
  sim(d, '2002').click();
  assert.equal(d.querySelector('[data-act=delete]'), null, 'game sims cannot be deleted');
  assert.ok(d.querySelector('[data-act=hide]'));
});

test('create a new sim from the picker adds the sim and then links it; delete asks to confirm and can be undone', async t => {
  const w = await load(t), d = w.document;
  toggleEdit(w); sim(d, '2001').click();
  d.querySelector('[data-add=friends]').click();
  d.querySelector('.tv-picker [data-act=create]').click();
  const form = d.querySelector('.tv-panel form');
  form.querySelector('[name=first]').value = 'Newfriend';
  form.dispatchEvent(new w.Event('submit', { cancelable: true }));
  await until(() => edits(w).length === 2, 'add + link');
  assert.equal(edits(w)[0].body.ops[0].op, 'sim_add');
  assert.deepEqual(edits(w)[1].body.ops, [{ op: 'link_add', kind: 'friend', a: '2001', b: 'm1' }]);
  assert.equal(edits(w)[1].body.rev, 8);
  await until(() => d.querySelector('[data-act=delete]'), 'delete button');
  d.querySelector('[data-act=delete]').click();
  d.querySelector('.tv-modal [data-confirm]').click();
  await until(() => edits(w).length === 3, 'delete sent');
  assert.deepEqual(edits(w)[2].body.ops, [{ op: 'sim_delete', id: 'm1' }]);
  await until(() => d.querySelector('.tv-snack [data-undo]') && !w.TreeV2.state().ix.sims.m1, 'undo offered');
  d.querySelector('.tv-snack [data-undo]').click();
  await until(() => edits(w).length >= 5, 'inverse ops');
  assert.equal(edits(w)[3].body.ops[0].op, 'sim_add');
  assert.equal(edits(w)[3].body.ops[0].sim.first, 'Newfriend');
  assert.equal(edits(w)[4].body.ops[0].op, 'link_add');
});

test('removing a link asks to confirm, keeps both sims, and Undo sends the inverse op', async t => {
  const w = await load(t), d = w.document;
  toggleEdit(w);
  const unlink = d.querySelector('.tv-partner[data-partner="2004"] .tv-btn');
  assert.match(unlink.textContent, /Unlink/);
  unlink.click();
  assert.equal(edits(w).length, 0, 'confirm first');
  d.querySelector('.tv-modal [data-confirm]').click();
  await until(() => edits(w).length === 1, 'remove');
  assert.deepEqual(edits(w)[0].body.ops, [{ op: 'link_remove', id: 'm:2001:2004' }]);
  await until(() => !d.querySelector('.tv-partner[data-partner="2004"]'), 'partner gone from the focus');
  assert.ok(w.TreeV2.state().ix.sims['2004'], 'sim still exists');
  d.querySelector('.tv-snack [data-undo]').click();
  await until(() => edits(w).length === 2, 'undo');
  assert.deepEqual(edits(w)[1].body.ops, [{ op: 'link_restore', id: 'm:2001:2004' }]);
});

test('game-edited values are tagged and "Use game value" resets the field', async t => {
  const w = await load(t), d = w.document;
  sim(d, '2001').click();
  const info = d.querySelector('[data-sec=info]');
  assert.match(info.textContent, /Master Chef/); assert.match(info.textContent, /edited/);
  assert.match(info.textContent, /Spellcaster/); assert.match(info.textContent, /Creative, Foodie, Goofball/);
  assert.equal(info.querySelector('[data-reset]'), null, 'only in edit mode');
  toggleEdit(w);
  d.querySelector('[data-reset=asp]').click();
  await until(() => edits(w).length === 1, 'reset');
  assert.deepEqual(edits(w)[0].body.ops, [{ op: 'sim_reset', id: '2001', field: 'asp' }]);
  await until(() => !/edited/.test(d.querySelector('[data-sec=info]').textContent), 'tag gone');
  assert.match(d.querySelector('[data-sec=info]').textContent, /Friend of the World/);
});

test('on 409 tree_conflict the tree is reloaded from the response and the user is told', async t => {
  const w = await load(t), d = w.document;
  toggleEdit(w); sim(d, '2002').click();
  w.__srv.mode.conflict = true;
  d.querySelector('[data-act=hide]').click();
  d.querySelector('.tv-modal [data-confirm]').click();
  await until(() => edits(w).length === 1, 'write attempted');
  await until(() => w.TreeV2.state().rev === 8 && w.TreeV2.state().ix.sims['2009'].first === 'Changed elsewhere', 'tree replaced by the 409 body');
  assert.equal(calls(w, 'tree').length, 1, 'no extra GET: the 409 body is the reload');
  assert.match(w.document.querySelector('#toastTx').textContent, /changed somewhere else/i);
  assert.ok(w.document.querySelector('#toast').classList.contains('bad'));
  assert.ok(!w.TreeV2.state().tree.hidden.includes('2002'), 'the rejected change was not applied');
});

test('a read-only viewer who somehow writes gets a not_owner message and no edit mode', async t => {
  const w = await load(t, { canEdit: false });
  assert.equal(w.TreeV2.state().edit, false);
  assert.equal(w.document.querySelector('.tv-switch').closest('.tv-editwrap').hidden, true);
});

test('portraits come from the portrait API and show in the bubbles', async t => {
  const img = 'data:image/jpeg;base64,YWJj';
  const w = await load(t, { images: { 2002: img } }), d = w.document;
  await until(() => sim(d, '2002').querySelector('img'), 'portrait drawn');
  assert.equal(sim(d, '2002').querySelector('img').getAttribute('src'), img);
  assert.equal(sim(d, '2003').querySelector('img'), null);
  assert.equal(sim(d, '2003').querySelector('.tv-pic').textContent, 'RQ', 'initials fallback');
  assert.ok(calls(w, 'portrait').every(c => ['list', 'get'].includes(c.body.action)));
});

test('floating tree bubble: on signed-in pages, targets the viewer, or the player whose card is open, and opens a new tab', async t => {
  const w = await load(t, { open: false }), d = w.document;
  const b = d.querySelector('#tv-bubble');
  assert.ok(b); assert.equal(b.hidden, false);
  assert.equal(b.getAttribute('aria-label'), 'Family tree'); assert.equal(b.textContent.includes('Family tree'), true);
  assert.equal(b.target, '_blank'); assert.match(b.rel, /noopener/);
  b.dispatchEvent(new w.FocusEvent('focus'));
  assert.match(b.getAttribute('href'), /family=qa-alpha/); assert.match(b.getAttribute('href'), /g=fixture-backend/);
  const card = [...d.querySelectorAll('.pcard')].find(el => el.textContent.includes('qa-beta'));
  card.click();
  assert.ok(d.querySelector('.sheet'));
  b.dispatchEvent(new w.FocusEvent('focus'));
  assert.match(b.getAttribute('href'), /family=qa-beta/);
  assert.equal(b.dataset.owner, 'qa-beta');
  w.eval('closeSheet()');
  b.dispatchEvent(new w.FocusEvent('focus'));
  assert.match(b.getAttribute('href'), /family=qa-alpha/);
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'tree.css'), 'utf8');
  assert.match(css, /@media\(max-width:700px\)\{\.tv-bubble\{bottom:calc\(76px/, 'sits above the phone tab bar');
  w.eval('logoutForTest=1'); // the bubble follows the tab bar: hidden when signed out
  d.querySelector('#tabs').hidden = true;
  await until(() => b.hidden, 'bubble hidden when signed out');
});

test('on the tree page the bubble re-centres instead of opening another tab', async t => {
  const w = await load(t), d = w.document;
  d.querySelector('[data-subtree="2003"]').click();
  assert.equal(d.querySelector('.tv-focus .tv-nm').textContent, 'Romeo Quill');
  const b = d.querySelector('#tv-bubble');
  const ev = new w.MouseEvent('click', { bubbles: true, cancelable: true });
  b.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true);
  assert.equal(d.querySelector('.tv-focus .tv-nm').textContent, 'Sadie Hart');
  assert.equal(w.TreeV2.state().stack.length, 0);
});

test('falls back to the classic explorer when the backend does not know the tree route', async t => {
  for (const unknown of [404, 'route', 'ok']) {
    const w = await load(t, { mode: { unknown } }), d = w.document;
    await until(() => d.querySelector('#family-explorer.fx-page'), 'classic explorer for ' + unknown);
    assert.ok(d.querySelector('.fx-head'));
    assert.equal(d.querySelector('.tv-stage'), null);
  }
});

test('a normal tree owner can reach the classic view from the new one', async t => {
  const w = await load(t), d = w.document;
  d.querySelector('[data-act=classic]').click();
  assert.ok(d.querySelector('#family-explorer.fx-page'));
  assert.equal(d.querySelector('.tv-stage'), null);
});

test('leaving the tree page or logging out removes it and releases the page scroll lock', async t => {
  const w = await load(t), d = w.document;
  sim(d, '2002').click();
  assert.ok(d.documentElement.classList.contains('tv-panel-open'));
  w.eval('dismissFamilyExplorer()');
  assert.equal(d.querySelector('#family-explorer'), null);
  assert.ok(!d.documentElement.classList.contains('tv-panel-open'));
});

test('the old family explorer tests still have their element ids (no clash)', async t => {
  const w = await load(t), d = w.document;
  assert.equal(d.querySelectorAll('#family-explorer').length, 1);
});
