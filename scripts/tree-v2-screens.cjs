// Takes UI screenshots of the family tree v2 with synthetic data. No network: every request except the page itself is aborted.
// usage: NODE_PATH=/opt/npm-tools/node_modules node scripts/tree-v2-screens.cjs [outDir]
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { sadieTree, serverSource, inlineHtml, sim } = require('../tests/tree-v2-fixture.cjs');
const out = path.resolve(process.argv[2] || path.join(__dirname, '..', 'screens'));
fs.mkdirSync(out, { recursive: true });
const html = inlineHtml();
const URL = 'https://fixture.invalid/#g=fixture-backend-000000000000';

// Temporary fixture variants for layout checks (only used here, never by the tests).
function variant(name) {
  const t = sadieTree(true);
  const par = (parent, child) => ({ id: `p:${parent}:${child}`, child, parent, type: 'birth', src: 'game' });
  const prt = (a, b, status) => ({ id: `m:${a}:${b}`, a, b, status, src: 'game' });
  const addSim = (id, first, age) => { t.sims[id] = sim(id, first, 'Test', age); };
  if (name === 'one') { t.partners = t.partners.filter(l => !(l.a === '2001' && l.b !== '2004')); t.parents = t.parents.filter(l => !['2002', '2003'].includes(l.parent)); }
  if (name === 'six') {
    [['3001', 'Ada', 'dating'], ['3002', 'Bo', 'widowed'], ['3003', 'Cy', 'engaged']].forEach(([id, n, st]) => { addSim(id, n, 'ADULT'); t.partners.push(prt('2001', id, st)); });
    addSim('3101', 'Dot', 'CHILD'); t.parents.push(par('2001', '3101'), par('3001', '3101'));
    addSim('3102', 'Eli', 'TEEN'); t.parents.push(par('2001', '3102'), par('3002', '3102'));
    addSim('3103', 'Fay', 'CHILD'); t.parents.push(par('2001', '3103'));  // other parent unknown
    // Cy (engaged) has no children
  }
  if (name === 'seven') {
    t.partners = t.partners.filter(l => !(l.a === '2001' && l.b !== '2004')); t.parents = t.parents.filter(l => !['2002', '2003'].includes(l.parent));
    for (let i = 1; i <= 6; i++) { addSim('320' + i, 'Kid' + i, 'CHILD'); t.parents.push(par('2001', '320' + i), par('2004', '320' + i)); }
  }
  return t;
}
async function session(browser, viewport, theme, tree) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: theme, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.route('**/*', r => r.request().url().startsWith('https://fixture.invalid/') ? r.fulfill({ status: 200, contentType: 'text/html', body: html }) : r.abort());
  await page.addInitScript(t => { try { localStorage.setItem('tg-theme', t); } catch (e) {} }, theme);
  await page.goto(URL);
  await page.waitForSelector('.pcard');
  await page.addStyleTag({ content: '#qa-controls{display:none!important}' });
  await page.evaluate(src => {
    window.eval(src);
    window.__srv.tree = JSON.parse(window.__tree);
    const mk = (a, b) => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 128, 128); g.addColorStop(0, a); g.addColorStop(1, b); x.fillStyle = g; x.fillRect(0, 0, 128, 128); x.fillStyle = 'rgba(255,255,255,.85)'; x.beginPath(); x.arc(64, 50, 24, 0, 7); x.fill(); x.fillRect(32, 84, 64, 60); return c.toDataURL('image/jpeg', .8); };
    window.__srv.images = { 2001: mk('#f6b26b', '#cc4125'), 2004: mk('#6fa8dc', '#3d85c6'), 2101: mk('#93c47d', '#38761d'), 2003: mk('#b4a7d6', '#674ea7') };
  }, `window.__tree=${JSON.stringify(JSON.stringify(tree || sadieTree(true)))};` + serverSource);
  await page.evaluate(() => showFamilyPage('qa-alpha'));
  await page.waitForSelector('.tv-stage .tv-sim');
  await page.waitForTimeout(600);
  return { ctx, page };
}
const shot = (page, name, full) => page.screenshot({ path: path.join(out, name + '.png'), fullPage: !!full });

(async () => {
  const browser = await chromium.launch();
  const sizes = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844 } };
  for (const theme of ['light', 'dark']) {
    for (const [sn, vp] of Object.entries(sizes)) {
      const { ctx, page } = await session(browser, vp, theme);
      await shot(page, `focus-${theme}-${sn}`, true);
      if (theme === 'light' || sn === 'desktop') {
        await page.click('.tv-stage [data-id="2002"]');
        await page.waitForTimeout(200);
        await shot(page, `panel-${theme}-${sn}`, sn === 'desktop');
        await page.keyboard.press('Escape');
      }
      if (theme === 'light') {
        await page.click('.tv-switch');
        await page.click('.tv-stage [data-id="2001"]');
        await page.click('[data-add=parents]');
        await page.waitForSelector('.tv-picker [data-pick]');
        await page.waitForTimeout(300);
        await shot(page, `edit-picker-${theme}-${sn}`);
        await page.keyboard.press('Escape');
        await page.click('.tv-panel-close');
        await page.waitForTimeout(150);
        await shot(page, `edit-mode-${theme}-${sn}`, true);
        if (sn === 'desktop') {
          await page.click('[data-act=add-sim]');
          await page.waitForTimeout(150);
          await shot(page, `add-form-${theme}-${sn}`);
          await page.keyboard.press('Escape');
          await page.waitForTimeout(150);
        }
      }
      if (theme === 'light' && sn === 'desktop') {
        await page.click('.tv-switch');
        await page.click('[data-subtree="2003"]');
        await page.waitForTimeout(500);
        await shot(page, `subtree-romeo-${theme}-${sn}`, true);
      }
      await ctx.close();
    }
  }
  for (const name of ['one', 'six', 'seven']) {
    for (const [sn, vp] of Object.entries(sizes)) {
      const { ctx, page } = await session(browser, vp, 'light', variant(name));
      await shot(page, `var-${name}-light-${sn}`, true);
      await ctx.close();
    }
  }
  await browser.close();
  console.log(fs.readdirSync(out).sort().join('\n'));
})().catch(e => { console.error(e); process.exit(1); });
