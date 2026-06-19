/**
 * Community Demographics Map — local dev server
 * Serves static files and proxies external APIs (tokens stay server-side).
 * Start with: npm start  (loads .env via Node --env-file flag)
 */
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = process.env.PORT || 8731;

app.use(express.static(__dirname));

/**
 * GET /api/geocode?q=<address>
 * Proxies Census Bureau one-line address geocoder.
 * Returns { matches: [{address, lat, lon}] }
 */
app.get('/api/geocode', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q is required' });

  try {
    const url = new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
    url.searchParams.set('address',   q);
    url.searchParams.set('benchmark', 'Public_AR_Current');
    url.searchParams.set('format',    'json');

    const upstream = await fetch(url.toString());
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: 'upstream geocoder error' });
    }

    const data    = await upstream.json();
    const raw     = data?.result?.addressMatches ?? [];
    const matches = raw.map(m => ({
      address: m.matchedAddress,
      lat:     m.coordinates.y,
      lon:     m.coordinates.x,
    }));

    res.json({ matches });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/suggest?q=<query>
 * Proxies Mapbox Geocoding API (US addresses, places, postcodes).
 * Token stays server-side — never exposed to the browser.
 */
app.get('/api/suggest', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q is required' });

  const token = process.env.MAPBOX_TOKEN;
  if (!token) return res.status(500).json({ error: 'MAPBOX_TOKEN not set in .env' });

  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json` +
      `?country=us&types=address,place,postcode,neighborhood&limit=6&access_token=${token}`;
    const upstream = await fetch(url);
    if (!upstream.ok) return res.status(upstream.status).json({ error: 'Mapbox error' });
    res.json(await upstream.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/fmr?state=XX&county=YYY
 * Proxies HUD User API — Section 8 Fair Market Rents by county FIPS.
 * Returns { data: { basicdata: [{ Efficiency, One-Bedroom, Two-Bedroom, Three-Bedroom, Four-Bedroom }] } }
 */
app.get('/api/fmr', async (req, res) => {
  const { state, county } = req.query;
  if (!state || !county) return res.status(400).json({ error: 'state and county are required' });

  const token = process.env.HUD_TOKEN;
  if (!token) return res.status(500).json({ error: 'HUD_TOKEN not set in .env' });

  const fips = state.padStart(2, '0') + county.padStart(3, '0');
  try {
    const url = `https://www.huduser.gov/hudapi/public/fmr/data/${fips}`;
    const upstream = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!upstream.ok) return res.status(upstream.status).json({ error: 'HUD API error' });
    res.json(await upstream.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.error(`Serving http://localhost:${PORT}`);
});
