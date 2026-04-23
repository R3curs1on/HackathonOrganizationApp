const express = require('express');
const fs = require('fs');
const path = require('path');

function now() {
  return new Date().toISOString();
}

function log(event, payload = {}) {
  console.log(`[${now()}] ${event}`, payload);
}

function logError(event, err, payload = {}) {
  console.error(`[${now()}] ${event}`, {
    ...payload,
    message: err?.message,
    stack: err?.stack,
  });
}

function loadLocalEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    return false;
  }

  const content = fs.readFileSync(envPath, 'utf8');
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      return;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    if (!key || process.env[key] !== undefined) {
      return;
    }

    let value = trimmed.slice(eqIndex + 1).trim();
    value = value.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    process.env[key] = value;
  });

  return true;
}

const LOCAL_ENV_LOADED = loadLocalEnvFile();

const app = express();
const rawPort = Number(process.env.PORT);
const PORT = Number.isInteger(rawPort) && rawPort >= 0 && rawPort < 65536 ? rawPort : 3001;
const BACKEND_API_URL = normalizeBaseUrl(process.env.BACKEND_API_URL || 'http://127.0.0.1:5000');
const TECH_PASSPHRASE = String(process.env.TECH_PASSPHRASE || '').trim();
const PUBLIC_DIR = path.join(__dirname, 'public');
const INDEX_FILE = path.join(PUBLIC_DIR, 'index.html');

app.disable('x-powered-by');

function normalizeBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return 'http://127.0.0.1:5000';
  }

  const url = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return url.replace(/\/+$/, '');
}

function backendHeaders(extra = {}) {
  const headers = { ...extra };
  if (TECH_PASSPHRASE) {
    headers['x-tech-passphrase'] = TECH_PASSPHRASE;
  }
  return headers;
}

function logProcess(event, payload = {}) {
  log(event, payload);
}

function getProxyDiagnostics() {
  const proxyKeys = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy'];
  const values = {};
  proxyKeys.forEach((key) => {
    if (process.env[key]) {
      values[key] = process.env[key];
    }
  });

  const noProxy = String(process.env.NO_PROXY || process.env.no_proxy || '');
  values.NO_PROXY = noProxy;
  values.localhostBypassed = /(^|,)\s*(localhost|127\.0\.0\.1)\s*(,|$)/i.test(noProxy);
  return values;
}

function createAbortSignal(timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  return controller.signal;
}

async function fetchJson(endpoint, options = {}) {
  const url = new URL(endpoint, BACKEND_API_URL);
  const startedAt = Date.now();
  log('UPSTREAM_REQUEST', {
    endpoint,
    url: url.toString(),
  });

  const response = await fetch(url, {
    ...options,
    headers: backendHeaders(options.headers || {}),
    signal: options.signal || createAbortSignal(),
  });

  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    const body = contentType.includes('application/json')
      ? await response.json().catch(() => ({}))
      : { error: await response.text().catch(() => '') };
    const message = body?.error || body?.message || `Backend request failed with ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    logError('UPSTREAM_RESPONSE_FAIL', error, {
      endpoint,
      url: url.toString(),
      status: response.status,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }

  if (contentType.includes('application/json')) {
    const payload = await response.json();
    log('UPSTREAM_RESPONSE', {
      endpoint,
      url: url.toString(),
      status: response.status,
      durationMs: Date.now() - startedAt,
    });
    return payload;
  }

  log('UPSTREAM_RESPONSE', {
    endpoint,
    url: url.toString(),
    status: response.status,
    durationMs: Date.now() - startedAt,
  });
  return response.text();
}

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function formatDateLabel(input) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function buildTimeline(evaluations) {
  const buckets = new Map();

  evaluations.forEach((entry) => {
    const source = entry.evaluated_at || entry.updatedAt;
    const date = new Date(source);
    if (Number.isNaN(date.getTime())) {
      return;
    }

    const key = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
      .toISOString()
      .slice(0, 10);
    buckets.set(key, (buckets.get(key) || 0) + 1);
  });

  const ordered = Array.from(buckets.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  let runningTotal = 0;

  return ordered.map(([date, count]) => {
    runningTotal += count;
    return {
      date,
      label: formatDateLabel(`${date}T00:00:00Z`),
      value: runningTotal,
      delta: count,
    };
  });
}

function summarizeData(dashboard, evaluationResponse, health) {
  const stats = dashboard || {};
  const teams = Array.isArray(dashboard?.teams) ? dashboard.teams : [];
  const evaluations = Array.isArray(evaluationResponse?.evaluations)
    ? evaluationResponse.evaluations
    : [];

  const leaderboard = [...evaluations].sort((a, b) => {
    const totalDiff = toFiniteNumber(b.total) - toFiniteNumber(a.total);
    if (totalDiff !== 0) {
      return totalDiff;
    }

    return String(a.team_name || '').localeCompare(String(b.team_name || ''));
  });

  const topTeams = [...teams].sort((a, b) => {
    const participantDiff = toFiniteNumber(b.participant_count) - toFiniteNumber(a.participant_count);
    if (participantDiff !== 0) {
      return participantDiff;
    }

    return String(a.team_name || '').localeCompare(String(b.team_name || ''));
  });

  const evaluatedTeams = evaluations.filter((entry) => entry.evaluated || toFiniteNumber(entry.total) > 0);
  const totalScore = evaluatedTeams.reduce((sum, entry) => sum + toFiniteNumber(entry.total), 0);
  const averageScore = evaluatedTeams.length ? totalScore / evaluatedTeams.length : 0;
  const highestScore = leaderboard[0] || null;
  const timeline = buildTimeline(evaluations);

  return {
    generatedAt: new Date().toISOString(),
    backendUrl: BACKEND_API_URL,
    techConfigured: Boolean(TECH_PASSPHRASE),
    backendHealth: health,
    stats: {
      totalParticipants: toFiniteNumber(stats.totalParticipants),
      registeredParticipants: toFiniteNumber(stats.registeredParticipants),
      remainingParticipants: toFiniteNumber(stats.remainingParticipants),
      dinnerTaken: toFiniteNumber(stats.dinnerTaken),
      dinnerPending: toFiniteNumber(stats.dinnerPending),
      totalTeams: toFiniteNumber(stats.totalTeams),
      registeredTeams: toFiniteNumber(stats.registeredTeams),
      remainingTeams: toFiniteNumber(stats.remainingTeams),
    },
    charts: {
      teamStatus: [
        { label: 'Registered teams', value: toFiniteNumber(stats.registeredTeams), color: '#f5c84c' },
        { label: 'Pending teams', value: toFiniteNumber(stats.remainingTeams), color: '#3b4a62' },
      ],
      participantStatus: [
        { label: 'Checked in', value: toFiniteNumber(stats.registeredParticipants), color: '#7cd7a8' },
        { label: 'Waiting', value: toFiniteNumber(stats.remainingParticipants), color: '#3b4a62' },
      ],
      teamSizes: topTeams.slice(0, 8).map((team) => ({
        team_name: team.team_name || 'Unassigned Team',
        lab_no: team.lab_no || '1000',
        participant_count: toFiniteNumber(team.participant_count),
        registered_count: toFiniteNumber(team.registered_count),
        dinner_count: toFiniteNumber(team.dinner_count),
      })),
      timeline,
    },
    highlights: {
      evaluatedTeams: evaluatedTeams.length,
      averageScore: Number(averageScore.toFixed(2)),
      highestScore: highestScore
        ? {
            team_name: highestScore.team_name || 'Unassigned Team',
            total: toFiniteNumber(highestScore.total),
          }
        : null,
      recentEvaluations: [...leaderboard].slice(0, 5).map((entry) => ({
        team_name: entry.team_name || 'Unassigned Team',
        lab_no: entry.lab_no || '1000',
        total: toFiniteNumber(entry.total),
        evaluation_1: toFiniteNumber(entry.evaluation_1),
        evaluation_2: toFiniteNumber(entry.evaluation_2),
        final_presentation: toFiniteNumber(entry.final_presentation),
        evaluated_at: entry.evaluated_at || null,
      })),
    },
    leaderboard: leaderboard.slice(0, 12).map((entry) => ({
      team_name: entry.team_name || 'Unassigned Team',
      lab_no: entry.lab_no || '1000',
      participant_count: toFiniteNumber(entry.participant_count),
      evaluation_1: toFiniteNumber(entry.evaluation_1),
      evaluation_2: toFiniteNumber(entry.evaluation_2),
      final_presentation: toFiniteNumber(entry.final_presentation),
      total: toFiniteNumber(entry.total),
      remarks: entry.remarks || '',
      evaluated_at: entry.evaluated_at || null,
      updatedAt: entry.updatedAt || null,
    })),
  };
}

async function loadSummary() {
  if (!TECH_PASSPHRASE) {
    const error = new Error('TECH_PASSPHRASE is not configured for the website server');
    error.status = 500;
    throw error;
  }

  const [health, dashboard, evaluationResponse] = await Promise.all([
    fetchJson('/health'),
    fetchJson('/dashboard'),
    fetchJson('/evaluations'),
  ]);

  return summarizeData(dashboard, evaluationResponse, health);
}

log('WEBSITE_BOOT', {
  port: PORT,
  backendApiUrl: BACKEND_API_URL,
  techConfigured: Boolean(TECH_PASSPHRASE),
  localEnvLoaded: LOCAL_ENV_LOADED,
  publicDirExists: fs.existsSync(PUBLIC_DIR),
  indexFileExists: fs.existsSync(INDEX_FILE),
  proxyDiagnostics: getProxyDiagnostics(),
});

process.on('unhandledRejection', (reason) => {
  logProcess('PROCESS_UNHANDLED_REJECTION', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

process.on('uncaughtException', (error) => {
  logProcess('PROCESS_UNCAUGHT_EXCEPTION', {
    message: error?.message,
    stack: error?.stack,
  });
});

process.on('SIGINT', () => {
  logProcess('PROCESS_SIGINT');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logProcess('PROCESS_SIGTERM');
  process.exit(0);
});

app.use((req, res, next) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  req.requestId = requestId;

  log('REQ_START', {
    requestId,
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
    queryKeys: Object.keys(req.query || {}),
  });

  res.on('finish', () => {
    log('REQ_END', {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });

  next();
});

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

app.get('/health', (req, res) => {
  log('WEBSITE_HEALTH_ROUTE', { requestId: req.requestId });
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    websiteOk: true,
    websiteTime: now(),
    backendApiUrl: BACKEND_API_URL,
    techConfigured: Boolean(TECH_PASSPHRASE),
    localEnvLoaded: LOCAL_ENV_LOADED,
  });
});

app.get('/', (req, res) => {
  log('ROOT_ROUTE', {
    requestId: req.requestId,
    indexFileExists: fs.existsSync(INDEX_FILE),
  });

  if (!fs.existsSync(INDEX_FILE)) {
    return res.status(500).type('text/plain').send('index.html missing');
  }

  return res.sendFile(INDEX_FILE);
});

app.get('/index.html', (req, res) => {
  log('INDEX_ROUTE', { requestId: req.requestId });
  if (!fs.existsSync(INDEX_FILE)) {
    return res.status(500).type('text/plain').send('index.html missing');
  }
  return res.sendFile(INDEX_FILE);
});

app.get('/api/summary', async (req, res) => {
  const startedAt = Date.now();
  log('SUMMARY_REQUEST', { requestId: req.requestId });
  try {
    const summary = await loadSummary();
    res.setHeader('Cache-Control', 'no-store');
    res.json(summary);
    log('SUMMARY_SUCCESS', {
      requestId: req.requestId,
      teams: summary.stats.totalTeams,
      evaluatedTeams: summary.highlights.evaluatedTeams,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    logError('SUMMARY_ERROR', error, {
      requestId: req.requestId,
      durationMs: Date.now() - startedAt,
    });
    res.status(error.status || 500).json({
      error: error.message || 'Failed to load summary',
    });
  }
});

app.get('/api/export/:dataset', async (req, res) => {
  const dataset = String(req.params.dataset || '').trim().toLowerCase();
  const format = String(req.query.format || 'csv').trim().toLowerCase();
  const startedAt = Date.now();
  const allowed = new Map([
    ['teams', '/exports/teams'],
    ['participants', '/exports/participants'],
    ['evaluations', '/exports/evaluations'],
  ]);

  if (!allowed.has(dataset)) {
    log('EXPORT_INVALID_DATASET', { requestId: req.requestId, dataset, format });
    return res.status(404).json({ error: 'Unknown export dataset' });
  }

  if (!TECH_PASSPHRASE) {
    log('EXPORT_MISSING_PASSPHRASE', { requestId: req.requestId, dataset, format });
    return res.status(500).json({ error: 'TECH_PASSPHRASE is not configured for the website server' });
  }

  try {
    log('EXPORT_REQUEST', { requestId: req.requestId, dataset, format });
    const upstream = new URL(allowed.get(dataset), BACKEND_API_URL);
    upstream.searchParams.set('format', format);

    const response = await fetch(upstream, {
      headers: backendHeaders(),
      signal: createAbortSignal(),
    });

    const body = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type');
    const disposition = response.headers.get('content-disposition');

    res.status(response.status);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', contentType || (format === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8'));
    if (disposition) {
      res.setHeader('Content-Disposition', disposition);
    }
    log('EXPORT_SUCCESS', {
      requestId: req.requestId,
      dataset,
      format,
      statusCode: response.status,
      durationMs: Date.now() - startedAt,
      bytes: body.length,
    });
    return res.send(body);
  } catch (error) {
    logError('EXPORT_ERROR', error, {
      requestId: req.requestId,
      dataset,
      format,
      durationMs: Date.now() - startedAt,
    });
    return res.status(error.status || 500).json({
      error: error.message || 'Failed to export dataset',
    });
  }
});

app.get('/api/health', async (req, res) => {
  const startedAt = Date.now();
  try {
    const health = await fetchJson('/health');
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      websiteOk: true,
      websiteTime: now(),
      backend: health,
      backendApiUrl: BACKEND_API_URL,
    });
    log('WEBSITE_HEALTH_SUCCESS', {
      requestId: req.requestId,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    logError('WEBSITE_HEALTH_ERROR', error, {
      requestId: req.requestId,
      durationMs: Date.now() - startedAt,
    });
    res.status(error.status || 500).json({
      error: error.message || 'Failed to load backend health',
    });
  }
});

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return next();
  }

  if (req.path === '/health' || req.path.startsWith('/api')) {
    return next();
  }

  log('SPA_FALLBACK', {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
  });

  if (!fs.existsSync(INDEX_FILE)) {
    return res.status(500).type('text/plain').send('index.html missing');
  }

  return res.sendFile(INDEX_FILE);
});

app.use((err, req, res, next) => {
  logError('UNHANDLED_REQUEST_ERROR', err, {
    requestId: req?.requestId,
    method: req?.method,
    path: req?.originalUrl,
  });
  if (res.headersSent) {
    return next(err);
  }
  return res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  log('WEBSITE_LISTENING', {
    url: `http://127.0.0.1:${PORT}`,
    backendApiUrl: BACKEND_API_URL,
    techConfigured: Boolean(TECH_PASSPHRASE),
    indexFileExists: fs.existsSync(INDEX_FILE),
    proxyDiagnostics: getProxyDiagnostics(),
  });
});
