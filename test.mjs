/**
 * Playwright test for community demographics map.
 * Spins up python HTTP server, opens page, clicks map, verifies census data.
 */
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';

const PORT = 8731;
const BASE = `http://localhost:${PORT}`;

// ── start server ──────────────────────────────────────────────
function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['server.js'], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stderr.on('data', d => {
      if (d.toString().includes('Serving')) resolve(proc);
    });
    proc.stdout.on('data', d => {
      if (d.toString().includes('Serving')) resolve(proc);
    });
    proc.on('error', reject);
    setTimeout(() => resolve(proc), 2000); // fallback
  });
}

// ── helpers ───────────────────────────────────────────────────
function pass(msg) { console.log(`  ✓  ${msg}`); }
function fail(msg) { console.error(`  ✗  ${msg}`); process.exitCode = 1; }

// ── main ──────────────────────────────────────────────────────
let server;
let browser;

try {
  console.log('\n▶ Starting HTTP server…');
  server = await startServer();
  await sleep(500);
  pass(`Server on ${BASE}`);

  console.log('\n▶ Launching Chromium…');
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    // Capture console + network errors
  });

  const page = await context.newPage();

  // Collect console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(err.message));

  // ── Test 1: page loads ────────────────────────────────────
  console.log('\n▶ Test 1 · Page load');
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });

  const title = await page.title();
  if (title.includes('Demographics')) pass(`Title: "${title}"`);
  else fail(`Unexpected title: "${title}"`);

  // Map container present
  const mapEl = await page.$('#map');
  if (mapEl) pass('Map container present');
  else fail('Map container missing');

  // Leaflet loaded
  const leafletLoaded = await page.evaluate(() => typeof window.L !== 'undefined');
  if (leafletLoaded) pass('Leaflet.js loaded');
  else fail('Leaflet.js NOT loaded');

  // ── Test 2: UI elements ───────────────────────────────────
  console.log('\n▶ Test 2 · UI elements');

  const searchInput = await page.$('#address-input');
  if (searchInput) pass('Address input present');
  else fail('Address input missing');

  const layerBtns = await page.$$('.layer-btn');
  if (layerBtns.length === 4) pass(`Layer buttons: ${layerBtns.length}`);
  else fail(`Expected 4 layer buttons, got ${layerBtns.length}`);

  const placeholder = await page.$('#demo-placeholder');
  if (placeholder) pass('Demo placeholder visible');
  else fail('Demo placeholder missing');

  // ── Test 3: Address search ────────────────────────────────
  console.log('\n▶ Test 3 · Address search (Nominatim)');
  await page.fill('#address-input', 'Times Square, New York, NY');
  await page.click('#search-btn');
  await sleep(5000);
  pass('Address search triggered (Nominatim)');

  // ── Test 4: TIGERweb Census Tract API ────────────────────
  console.log('\n▶ Test 4 · Census TIGERweb API (direct fetch from browser)');

  const geoResult = await page.evaluate(async () => {
    // Times Square: lat 40.758, lng -73.985
    const lat = 40.758, lng = -73.985;
    const params = new URLSearchParams({
      geometry: `${lng},${lat}`,
      geometryType: 'esriGeometryPoint',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'STATE,COUNTY,TRACT,BASENAME,NAME',
      returnGeometry: 'false',
      f: 'json',
    });
    const url = `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2022/MapServer/6/query?${params}`;
    try {
      const r = await fetch(url);
      if (!r.ok) return { error: `HTTP ${r.status}` };
      const d = await r.json();
      const a = d?.features?.[0]?.attributes;
      if (!a) return { error: 'No tract found', raw: JSON.stringify(d).slice(0, 300) };
      return { ok: true, state: a.STATE, county: a.COUNTY, tract: a.TRACT, name: a.NAME };
    } catch (e) {
      return { error: e.message };
    }
  });

  if (geoResult.error) {
    fail(`TIGERweb Geocoder failed: ${geoResult.error}`);
    if (geoResult.raw) console.log('    Raw:', geoResult.raw);
  } else {
    pass(`TIGERweb → state:${geoResult.state} county:${geoResult.county} tract:${geoResult.tract} (${geoResult.name})`);
  }

  // ── Test 5: ACS Income API ────────────────────────────────
  console.log('\n▶ Test 5 · ACS Income API');
  const acsResult = await page.evaluate(async () => {
    const state = '36', county = '061', tract = '009901'; // Manhattan example
    const url = `https://api.census.gov/data/2022/acs/acs5?get=B19013_001E,NAME&for=tract:${tract}&in=state:${state}%20county:${county}`;
    try {
      const r = await fetch(url);
      if (!r.ok) return { error: `HTTP ${r.status}` };
      const d = await r.json();
      if (!Array.isArray(d) || d.length < 2) return { error: 'Unexpected shape', raw: JSON.stringify(d).slice(0, 300) };
      const idx = d[0].indexOf('B19013_001E');
      return { ok: true, income: d[1][idx], name: d[1][d[0].indexOf('NAME')] };
    } catch (e) {
      return { error: e.message };
    }
  });

  if (acsResult.error) {
    fail(`ACS Income API failed: ${acsResult.error}`);
    if (acsResult.raw) console.log('    Raw:', acsResult.raw);
  } else {
    pass(`ACS Income → ${acsResult.name}: $${parseInt(acsResult.income).toLocaleString()}`);
  }

  // ── Test 6: ACS Race API ──────────────────────────────────
  console.log('\n▶ Test 6 · ACS Race API');
  const raceResult = await page.evaluate(async () => {
    const state = '36', county = '061', tract = '009901';
    const vars = 'B03002_001E,B03002_003E,B03002_004E,B03002_006E,B03002_012E';
    const url = `https://api.census.gov/data/2022/acs/acs5?get=${vars}&for=tract:${tract}&in=state:${state}%20county:${county}`;
    try {
      const r = await fetch(url);
      if (!r.ok) return { error: `HTTP ${r.status}` };
      const d = await r.json();
      if (!Array.isArray(d) || d.length < 2) return { error: 'Unexpected shape' };
      const rv = (code) => parseInt(d[1][d[0].indexOf(code)], 10);
      return {
        ok: true,
        total: rv('B03002_001E'),
        white: rv('B03002_003E'),
        black: rv('B03002_004E'),
        asian: rv('B03002_006E'),
        hispanic: rv('B03002_012E'),
      };
    } catch (e) {
      return { error: e.message };
    }
  });

  if (raceResult.error) {
    fail(`ACS Race API failed: ${raceResult.error}`);
  } else {
    const t = raceResult.total;
    const pct = n => (n / t * 100).toFixed(1) + '%';
    pass(`ACS Race → total:${t}, white:${pct(raceResult.white)}, black:${pct(raceResult.black)}, asian:${pct(raceResult.asian)}, hispanic:${pct(raceResult.hispanic)}`);
  }

  // ── Test 7: End-to-end map click ─────────────────────────
  console.log('\n▶ Test 7 · End-to-end map click → demographics panel');

  // Click Chicago city center area on the map
  await page.evaluate(() => {
    // Navigate map to Chicago
    const m = Object.values(window).find(v => v && typeof v.setView === 'function' && v._leaflet_id);
    if (m) m.setView([41.878, -87.630], 12);
  });
  await sleep(1000);

  // Click center of map element
  const mapBox = await page.$('#map');
  const bbox = await mapBox.boundingBox();
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;

  await page.mouse.click(cx, cy);

  // Wait for census data to load (up to 20s)
  try {
    await page.waitForSelector('#demo-content', { state: 'visible', timeout: 20000 });
    pass('Demographics panel rendered after click');

    const incomeText = await page.textContent('#income-value');
    pass(`Income value displayed: ${incomeText}`);

    const raceRows = await page.$$('.race-row');
    if (raceRows.length > 0) pass(`Race bars: ${raceRows.length} groups shown`);
    else fail('No race bars rendered');

    const locationText = await page.textContent('#demo-location');
    pass(`Location: ${locationText}`);

  } catch (e) {
    // Check if error panel showed
    const errEl = await page.$('#demo-error');
    const errVisible = errEl ? await errEl.isVisible() : false;
    if (errVisible) {
      const errText = await page.textContent('#demo-error');
      fail(`Demo error shown: ${errText}`);
    } else {
      fail(`Demographics panel did not appear: ${e.message}`);
    }
  }

  // ── Test 8a: Census geocoder fallback ────────────────────
  console.log('\n▶ Test 8a · Census geocoder proxy fallback');
  const censusProxy = await page.evaluate(async () => {
    try {
      const r = await fetch('/api/geocode?q=1060+Great+Oaks+Dr+Lawrenceville+GA');
      if (!r.ok) return { error: `HTTP ${r.status}` };
      const d = await r.json();
      return { ok: true, count: d.matches?.length, first: d.matches?.[0] };
    } catch (e) { return { error: e.message }; }
  });
  if (censusProxy.error) {
    fail(`Census proxy failed: ${censusProxy.error}`);
  } else if (!censusProxy.count) {
    fail('Census proxy returned 0 matches for known address');
  } else {
    pass(`Census proxy → "${censusProxy.first.address}" (${censusProxy.first.lat.toFixed(4)}, ${censusProxy.first.lon.toFixed(4)})`);
  }

  // ── Test 8b: Full end-to-end address that Nominatim misses ─
  console.log('\n▶ Test 8b · End-to-end: address only Census finds');
  await page.fill('#address-input', '');
  await sleep(200);
  await page.fill('#address-input', '1060 Great Oaks Dr Lawrenceville GA');
  await page.click('#search-btn');
  try {
    await page.waitForSelector('#demo-content', { state: 'visible', timeout: 25000 });
    const loc = await page.textContent('#demo-location');
    pass(`Lawrenceville GA address found & demographics loaded: ${loc}`);
  } catch (e) {
    // Check if it at least hit the Census fallback
    const status = await page.textContent('#search-status');
    if (status) fail(`Address search failed, status: "${status}"`);
    else fail(`Demographics did not load for Lawrenceville address: ${e.message}`);
  }

  // ── Test 9: Layer switcher ────────────────────────────────
  console.log('\n▶ Test 9 · Layer switcher');
  await page.keyboard.press('Escape');
  await page.click('#map');
  await sleep(300);
  const raceBtnSel = '.layer-btn[data-layer="race"]';
  await page.click(raceBtnSel);
  await sleep(500);
  const raceActive = await page.$eval(raceBtnSel, el => el.classList.contains('active'));
  if (raceActive) pass('Race layer button activates');
  else fail('Race layer button did not activate');

  // ── Report console errors ─────────────────────────────────
  console.log('\n▶ Console errors during test:');
  if (consoleErrors.length === 0) {
    pass('No JS console errors');
  } else {
    const filtered = consoleErrors.filter(e =>
      !e.includes('net::ERR_') && // CORS/network expected for some tile layers
      !e.includes('favicon')
    );
    if (filtered.length === 0) pass('No significant JS errors (only network/tile errors)');
    else filtered.forEach(e => fail(`Console error: ${e}`));
  }

  console.log('\n' + '─'.repeat(55));
  if (process.exitCode === 1) {
    console.error('RESULT: Some tests FAILED — see ✗ above\n');
  } else {
    console.log('RESULT: All tests PASSED ✓\n');
  }

} finally {
  if (browser) await browser.close();
  if (server)  server.kill();
}
