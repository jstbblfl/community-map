/**
 * Smoke tests — verify all upstream APIs return expected data.
 * Run before every push: npm test
 * Requires .env with MAPBOX_TOKEN and HUD_TOKEN.
 *
 * Known anchor: Census Tract 35, Fulton County (121), Georgia (13)
 *   Coordinates: -84.388, 33.749  (Atlanta GA)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const STATE   = '13';
const COUNTY  = '121';
const TRACT   = '003500';
const LNG     = -84.388;
const LAT     = 33.749;

const TIGERWEB   = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2023/MapServer/8/query';
const CENSUS_ACS = 'https://api.census.gov/data/2023/acs/acs5';
const HUD_API    = 'https://www.huduser.gov/hudapi/public/fmr/data';
const MAPBOX_API = 'https://api.mapbox.com/geocoding/v5/mapbox.places';

const CENSUS_KEY = process.env.CENSUS_KEY || '';

// ── TIGERweb ─────────────────────────────────────────────────────────────────

test('TIGERweb ACS2023/layer8 — Atlanta GA returns correct tract', async () => {
  const params = new URLSearchParams({
    geometry:     `${LNG},${LAT}`,
    geometryType: 'esriGeometryPoint',
    inSR:         '4326',
    spatialRel:   'esriSpatialRelIntersects',
    outFields:    'STATE,COUNTY,TRACT,BASENAME,NAME',
    returnGeometry: 'false',
    f:            'json',
  });
  const r = await fetch(`${TIGERWEB}?${params}`);
  assert.equal(r.ok, true, `TIGERweb HTTP ${r.status}`);
  const data = await r.json();
  assert.ok(data.features?.length > 0, 'No features returned — wrong layer or bad coords');
  assert.equal(data.features[0].attributes.STATE, STATE, 'Wrong state returned');
  assert.equal(data.features[0].attributes.COUNTY, COUNTY, 'Wrong county returned');
});

// ── Census ACS 2023 ───────────────────────────────────────────────────────────

test('Census ACS 2023 — median income (B19013) for Atlanta tract', async () => {
  assert.ok(CENSUS_KEY, 'CENSUS_KEY not set — get a free key at https://api.census.gov/data/key_signup.html');
  const url = `${CENSUS_ACS}?get=B19013_001E,NAME&for=tract:${TRACT}&in=state:${STATE}%20county:${COUNTY}&key=${CENSUS_KEY}`;
  const r = await fetch(url);
  assert.equal(r.ok, true, `ACS income HTTP ${r.status}`);
  const data = await r.json();
  assert.ok(Array.isArray(data) && data.length === 2, 'Expected [headers, values]');
  const income = parseInt(data[1][data[0].indexOf('B19013_001E')], 10);
  assert.ok(income > 0, `Expected positive income, got ${income}`);
});

test('Census ACS 2023 — rent by bedrooms (B25031) for Atlanta tract', async () => {
  assert.ok(CENSUS_KEY, 'CENSUS_KEY not set');
  const vars = 'B25031_002E,B25031_003E,B25031_004E,B25031_005E,B25031_006E';
  const url = `${CENSUS_ACS}?get=${vars}&for=tract:${TRACT}&in=state:${STATE}%20county:${COUNTY}&key=${CENSUS_KEY}`;
  const r = await fetch(url);
  assert.equal(r.ok, true, `ACS rent HTTP ${r.status}`);
  const data = await r.json();
  assert.ok(Array.isArray(data) && data.length === 2, 'Expected [headers, values]');
  const twoBR = parseInt(data[1][data[0].indexOf('B25031_004E')], 10);
  assert.ok(twoBR > 0, `Expected positive 2BR rent, got ${twoBR}`);
});

test('Census ACS 2023 — race variables (B03002) for Atlanta tract', async () => {
  assert.ok(CENSUS_KEY, 'CENSUS_KEY not set');
  const vars = 'B03002_001E,B03002_003E,B03002_012E';
  const url = `${CENSUS_ACS}?get=${vars}&for=tract:${TRACT}&in=state:${STATE}%20county:${COUNTY}&key=${CENSUS_KEY}`;
  const r = await fetch(url);
  assert.equal(r.ok, true, `ACS race HTTP ${r.status}`);
  const data = await r.json();
  assert.ok(Array.isArray(data) && data.length === 2, 'Expected [headers, values]');
  const total = parseInt(data[1][data[0].indexOf('B03002_001E')], 10);
  assert.ok(total > 0, `Expected positive total population, got ${total}`);
});

// ── HUD FMR ───────────────────────────────────────────────────────────────────

test('HUD FMR — Fulton County GA Section 8 rents', async () => {
  const token = process.env.HUD_TOKEN;
  assert.ok(token, 'HUD_TOKEN not set — add it to .env');
  const fips = STATE.padStart(2, '0') + COUNTY.padStart(3, '0');
  const r = await fetch(`${HUD_API}/${fips}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(r.ok, true, `HUD API HTTP ${r.status}`);
  const data = await r.json();
  const basic = data?.data?.basicdata?.[0];
  assert.ok(basic, 'No basicdata in HUD response');
  assert.ok(basic['Two-Bedroom'] > 0, `Expected Two-Bedroom FMR > 0, got ${basic['Two-Bedroom']}`);
});

// ── Mapbox ────────────────────────────────────────────────────────────────────

test('Mapbox Geocoding — "Atlanta GA" returns suggestions', async () => {
  const token = process.env.MAPBOX_TOKEN;
  assert.ok(token, 'MAPBOX_TOKEN not set — add it to .env');
  const url = `${MAPBOX_API}/${encodeURIComponent('Atlanta GA')}.json` +
    `?country=us&types=place&limit=3&access_token=${token}`;
  const r = await fetch(url);
  assert.equal(r.ok, true, `Mapbox HTTP ${r.status}`);
  const data = await r.json();
  assert.ok(data.features?.length > 0, 'No suggestions returned from Mapbox');
});
