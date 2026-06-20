#!/usr/bin/env node
/**
 * preflight.js — agent-side test runner
 *
 * Fetches HUD_TOKEN, CENSUS_KEY, and MAPBOX_TOKEN from thepopebot agent-job-secrets,
 * injects them into process.env, then spawns the full smoke test suite.
 *
 * Exit code mirrors the test result — non-zero means don't push.
 *
 * Usage (from community-map/ directory):
 *   node test/preflight.js
 *
 * Or from repo root:
 *   node community-map/test/preflight.js
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 1. Locate the agent-job-secrets script ───────────────────────────────────

// Walk up from community-map/test/ to find the repo root
function findSecretsScript() {
  let dir = resolve(__dirname, '..', '..'); // repo root (two levels up from test/)
  const candidates = [
    resolve(dir, 'skills', 'agent-job-secrets', 'agent-job-secrets.js'),
    resolve(dir, 'skills-library', 'agent-job-secrets', 'agent-job-secrets.js'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function fetchSecret(secretsScript, name) {
  const result = spawnSync('node', [secretsScript, 'get', name], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  if (result.error) throw new Error(`Failed to run secrets script: ${result.error.message}`);
  const value = (result.stdout || '').trim();
  // The script echoes errors to stdout starting with "No agent secrets" or similar
  if (!value || value.toLowerCase().startsWith('no ') || value.toLowerCase().includes('error')) {
    return null;
  }
  return value;
}

// ── 2. Fetch credentials ─────────────────────────────────────────────────────

const secretsScript = findSecretsScript();
const KEYS = ['HUD_TOKEN', 'CENSUS_KEY', 'MAPBOX_TOKEN'];
const missing = [];

if (secretsScript) {
  console.error('[preflight] Fetching secrets from thepopebot agent-job-secrets…');
  for (const key of KEYS) {
    if (!process.env[key]) {
      const val = fetchSecret(secretsScript, key);
      if (val) {
        process.env[key] = val;
        console.error(`[preflight] ✓ ${key} loaded`);
      } else {
        console.error(`[preflight] ✗ ${key} not found in secrets`);
        missing.push(key);
      }
    } else {
      console.error(`[preflight] ✓ ${key} already in env`);
    }
  }
} else {
  console.error('[preflight] agent-job-secrets script not found — falling back to .env values');
  for (const key of KEYS) {
    if (!process.env[key]) missing.push(key);
  }
}

if (missing.length) {
  console.error(`\n[preflight] Missing credentials: ${missing.join(', ')}`);
  console.error('[preflight] Add them to thepopebot admin (Settings → Secrets) with these exact names.');
  process.exit(1);
}

// ── 3. Run smoke tests ───────────────────────────────────────────────────────

console.error('\n[preflight] Running smoke tests…\n');

const smokeJs = resolve(__dirname, 'smoke.js');
const result = spawnSync(
  process.execPath,
  ['--test', smokeJs],
  {
    stdio: 'inherit',
    env:   { ...process.env },
    timeout: 60_000,
  }
);

if (result.error) {
  console.error(`[preflight] Test runner error: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
