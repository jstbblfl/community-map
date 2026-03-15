import { chromium } from 'playwright';

const b = await chromium.launch({ headless: true });
const page = await b.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('http://localhost:8731', { waitUntil: 'networkidle', timeout: 15000 });

// 1. Check Google Places loaded
const gmaps = await page.evaluate(() =>
  typeof google !== 'undefined' &&
  typeof google.maps?.places?.AutocompleteService !== 'undefined'
);
console.log('Google Places API loaded:', gmaps);

// 2. Type the previously-failing address and wait for predictions
await page.fill('#address-input', '1060 Great Oaks Dr Lawrenceville');
await page.waitForTimeout(1500);

const dropdownOpen = await page.locator('#suggestions.open').count() > 0;
console.log('Dropdown opened:', dropdownOpen);

const itemCount = await page.locator('.suggestion-item').count();
console.log('Prediction count:', itemCount);

if (itemCount > 0) {
  const firstMain = await page.locator('.suggestion-main').first().textContent();
  const firstSub  = await page.locator('.suggestion-sub').first().textContent().catch(() => '');
  console.log('Top prediction:', firstMain.trim(), '|', firstSub.trim());

  // Click first suggestion
  await page.locator('.suggestion-item').first().click({ force: true });

  // Wait for demographics panel
  try {
    await page.waitForSelector('#demo-content', { state: 'visible', timeout: 20000 });
    const income = await page.textContent('#income-value');
    const loc    = await page.textContent('#demo-location');
    console.log('PASS: Demographics loaded');
    console.log('  Income:', income.trim());
    console.log('  Location:', loc.trim());
  } catch (e) {
    const errTxt = await page.textContent('#demo-error').catch(() => '');
    console.log('FAIL: Demographics error:', errTxt || e.message);
  }
} else {
  console.log('FAIL: No predictions returned');
}

// 3. JS errors
const jsErrs = errors.filter(e => !e.includes('favicon'));
if (jsErrs.length) {
  console.log('JS errors:');
  jsErrs.forEach(e => console.log(' ', e));
} else {
  console.log('No JS errors');
}

await b.close();
