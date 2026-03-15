/**
 * Community Demographics Map — local dev server
 * Serves static files and proxies the Census Geocoder (no CORS headers there).
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

app.listen(PORT, () => {
  console.error(`Serving http://localhost:${PORT}`);
});
