const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const os = require('os');

const Participant = require('./models/Participant');
const Evaluation = require('./models/Evaluation');

const app = express();
app.use(express.json());
app.use(cors());

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/hackathon';
const PORT = Number(process.env.PORT || 5000);
const HOST = process.env.HOST || '0.0.0.0';
const DEFAULT_LAB_NO = process.env.DEFAULT_LAB_NO || '1000';
const TECH_PASSPHRASES = String(
  process.env.TECH_PASSPHRASES || 'acm@enigma,youdontknowmeson'
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

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

function getNetworkUrls() {
  let interfaces = {};
  try {
    interfaces = os.networkInterfaces();
  } catch (err) {
    logError('NETWORK_INTERFACES_READ_FAIL', err);
    return [];
  }
  const urls = [];

  Object.values(interfaces).forEach((entries) => {
    if (!entries) return;
    entries.forEach((entry) => {
      if (entry.family === 'IPv4' && !entry.internal) {
        urls.push(`http://${entry.address}:${PORT}`);
      }
    });
  });

  return urls;
}

function normalizeMobile(rawMobile) {
  return String(rawMobile || '').trim().replace(/\.0$/, '');
}

function normalizeLabNo(rawLabNo) {
  const value = String(rawLabNo || '').trim();
  return value || DEFAULT_LAB_NO;
}

function isRegistered(participant) {
  return Boolean(participant?.registered || participant?.is_present);
}

function normalizeScore(rawValue) {
  const num = Number(rawValue);
  if (!Number.isFinite(num) || num < 0) {
    return 0;
  }
  return Math.round(num * 100) / 100;
}

function csvEscape(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = String(value);
  const escaped = stringValue.replace(/"/g, '""');
  if (/[",\n]/.test(escaped)) {
    return `"${escaped}"`;
  }
  return escaped;
}

function toCsv(headers, rows) {
  const head = headers.map((header) => csvEscape(header.label)).join(',');
  const lines = rows.map((row) => headers.map((header) => csvEscape(row[header.key])).join(','));
  return `${head}\n${lines.join('\n')}`;
}

function sendCsv(res, filename, csvContent) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(`\uFEFF${csvContent}`);
}

function sanitizeSensitive(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeSensitive(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const blockedKeys = new Set(['passphrase', 'password', 'x-tech-passphrase']);
  const copy = {};
  Object.entries(value).forEach(([key, val]) => {
    if (blockedKeys.has(String(key).toLowerCase())) {
      copy[key] = '***';
      return;
    }
    copy[key] = sanitizeSensitive(val);
  });
  return copy;
}

function getPassphrase(req) {
  const headerValue = req.headers['x-tech-passphrase'];
  if (headerValue) {
    return String(headerValue).trim();
  }

  if (req.query?.passphrase) {
    return String(req.query.passphrase).trim();
  }

  if (req.body?.passphrase) {
    return String(req.body.passphrase).trim();
  }

  return '';
}

function isValidPassphrase(passphrase) {
  return TECH_PASSPHRASES.includes(passphrase);
}

function requireTechAccess(req, res, next) {
  const passphrase = getPassphrase(req);
  if (!isValidPassphrase(passphrase)) {
    return res.status(401).json({ error: 'Tech passphrase required' });
  }
  next();
}

async function getDashboardStats() {
  const registrationFilter = { $or: [{ registered: true }, { is_present: true }] };

  const [
    totalParticipants,
    registeredParticipants,
    dinnerTaken,
    totalTeamsRaw,
    registeredTeamsRaw,
  ] = await Promise.all([
    Participant.countDocuments(),
    Participant.countDocuments(registrationFilter),
    Participant.countDocuments({ has_dinner: true }),
    Participant.distinct('team_name', { team_name: { $nin: [null, ''] } }),
    Participant.distinct('team_name', {
      ...registrationFilter,
      team_name: { $nin: [null, ''] },
    }),
  ]);

  const totalTeams = totalTeamsRaw.length;
  const registeredTeams = registeredTeamsRaw.length;

  return {
    totalParticipants,
    registeredParticipants,
    remainingParticipants: Math.max(totalParticipants - registeredParticipants, 0),
    dinnerTaken,
    dinnerPending: Math.max(totalParticipants - dinnerTaken, 0),
    totalTeams,
    registeredTeams,
    remainingTeams: Math.max(totalTeams - registeredTeams, 0),
  };
}

async function getTeamDashboardList() {
  return Participant.aggregate([
    {
      $group: {
        _id: '$team_name',
        lab_no: { $first: '$lab_no' },
        participant_count: { $sum: 1 },
        registered_count: {
          $sum: {
            $cond: [{ $or: ['$registered', '$is_present'] }, 1, 0],
          },
        },
        dinner_count: {
          $sum: {
            $cond: ['$has_dinner', 1, 0],
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        team_name: { $ifNull: ['$_id', ''] },
        lab_no: {
          $ifNull: [
            {
              $cond: [{ $eq: [{ $ifNull: ['$lab_no', ''] }, ''] }, DEFAULT_LAB_NO, '$lab_no'],
            },
            DEFAULT_LAB_NO,
          ],
        },
        participant_count: 1,
        registered_count: 1,
        remaining_count: {
          $max: [{ $subtract: ['$participant_count', '$registered_count'] }, 0],
        },
        dinner_count: 1,
        dinner_pending_count: {
          $max: [{ $subtract: ['$participant_count', '$dinner_count'] }, 0],
        },
        team_registered: { $gt: ['$registered_count', 0] },
      },
    },
    {
      $sort: {
        team_name: 1,
      },
    },
  ]);
}

async function getParticipantList() {
  const docs = await Participant.find({}).sort({ team_name: 1, name: 1 }).lean();
  return docs.map((doc) => ({
    mobile: doc.mobile || '',
    name: doc.name || '',
    team_name: doc.team_name || '',
    lab_no: normalizeLabNo(doc.lab_no),
    registered: Boolean(doc.registered || doc.is_present),
    has_dinner: Boolean(doc.has_dinner),
    has_redbull: Boolean(doc.has_redbull),
    is_fake: Boolean(doc.is_fake),
  }));
}

async function getMergedEvaluations() {
  const [teamBaseList, evalDocs] = await Promise.all([
    Participant.aggregate([
      {
        $match: {
          team_name: { $nin: [null, ''] },
        },
      },
      {
        $group: {
          _id: '$team_name',
          lab_no: { $first: '$lab_no' },
          participant_count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          team_name: '$_id',
          lab_no: {
            $ifNull: [
              {
                $cond: [{ $eq: [{ $ifNull: ['$lab_no', ''] }, ''] }, DEFAULT_LAB_NO, '$lab_no'],
              },
              DEFAULT_LAB_NO,
            ],
          },
          participant_count: 1,
        },
      },
      {
        $sort: {
          team_name: 1,
        },
      },
    ]),
    Evaluation.find({}).sort({ total: -1, team_name: 1 }).lean(),
  ]);

  const map = new Map();

  teamBaseList.forEach((team) => {
    map.set(team.team_name, {
      team_name: team.team_name,
      lab_no: normalizeLabNo(team.lab_no),
      participant_count: team.participant_count || 0,
      evaluation_1: 0,
      evaluation_2: 0,
      final_presentation: 0,
      total: 0,
      remarks: '',
      evaluated: false,
      evaluated_at: null,
      updatedAt: null,
    });
  });

  evalDocs.forEach((entry) => {
    const existing = map.get(entry.team_name) || {
      team_name: entry.team_name,
      lab_no: normalizeLabNo(entry.lab_no),
      participant_count: 0,
    };

    const evaluation1 = normalizeScore(entry.evaluation_1 ?? entry.innovation);
    const evaluation2 = normalizeScore(entry.evaluation_2 ?? entry.technical);
    const finalPresentation = normalizeScore(entry.final_presentation ?? entry.presentation);
    const totalFromLegacy = normalizeScore(entry.innovation) +
      normalizeScore(entry.technical) +
      normalizeScore(entry.impact) +
      normalizeScore(entry.presentation);
    const computedTotal = evaluation1 + evaluation2 + finalPresentation;
    const total = normalizeScore(entry.total);

    map.set(entry.team_name, {
      ...existing,
      lab_no: normalizeLabNo(entry.lab_no || existing.lab_no),
      evaluation_1: evaluation1,
      evaluation_2: evaluation2,
      final_presentation: finalPresentation,
      total: total || computedTotal || totalFromLegacy,
      remarks: entry.remarks || '',
      evaluated: true,
      evaluated_at: entry.evaluated_at || null,
      updatedAt: entry.updatedAt || null,
    });
  });

  return Array.from(map.values()).sort((a, b) => {
    if ((b.total || 0) !== (a.total || 0)) {
      return (b.total || 0) - (a.total || 0);
    }
    return String(a.team_name).localeCompare(String(b.team_name));
  });
}

log('SERVER_BOOT', {
  host: HOST,
  port: PORT,
  mongoUri: MONGO_URI,
  defaultLabNo: DEFAULT_LAB_NO,
  techPassphraseCount: TECH_PASSPHRASES.length,
});

mongoose.connection.on('connected', () => log('MONGO_CONNECTED'));
mongoose.connection.on('error', (err) => logError('MONGO_ERROR', err));
mongoose.connection.on('disconnected', () => log('MONGO_DISCONNECTED'));

// 1. Define Mongo Options with increased Pool Size
const mongoOptions = {
  maxPoolSize: 20,             // Increase from default 10 to 50
  minPoolSize: 10,             // Keep 10 connections warm
  socketTimeoutMS: 45000,      // Close sockets after 45s of inactivity
  serverSelectionTimeoutMS: 5000,
};

// mongoose.connect(MONGO_URI).catch((err) => logError('MONGO_CONNECT_FAILED', err));
mongoose.connect(MONGO_URI, mongoOptions)
.then(() => log('MONGO_CONNECTED_WITH_POOL_SIZE_50'))
.catch((err) => logError('MONGO_CONNECT_FAILED', err));


const RENDER_EXTERNAL_URL = `https://hackathonorganizationapp.onrender.com/health`;

if (process.env.NODE_ENV === 'production') {
  setInterval(() => {
    // We use a dynamic import or require to avoid overhead
    const http = RENDER_EXTERNAL_URL.startsWith('https') ? require('https') : require('http');
    http.get(RENDER_EXTERNAL_URL, (res) => {
      log('SELF_PING_SUCCESS', { statusCode: res.statusCode });
    }).on('error', (err) => {
      logError('SELF_PING_ERROR', err);
    });
  }, 14 * 60 * 1000); // Ping every 14 minutes
}

app.use((req, res, next) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const started = Date.now();
  req.requestId = requestId;

  log('REQ_START', {
    requestId,
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
    body: sanitizeSensitive(req.body || null),
  });

  res.on('finish', () => {
    log('REQ_END', {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - started,
    });
  });

  next();
});

app.get('/health', (req, res) => {
  const mongoReadyState = mongoose.connection.readyState;
  const mongoConnected = mongoReadyState === 1;
  res.json({
    ok: true,
    uptimeSec: Math.floor(process.uptime()),
    mongoConnected,
    mongoReadyState,
    serverTime: now(),
  });
});

app.post('/tech/unlock', (req, res) => {
  const passphrase = getPassphrase(req);
  if (!isValidPassphrase(passphrase)) {
    return res.status(401).json({ error: 'Invalid passphrase' });
  }
  return res.json({ success: true, unlocked: true, serverTime: now() });
});

app.post('/action', async (req, res) => {
  const type = req.body?.type;
  const mobile = normalizeMobile(req.body?.mobile);
  if (!mobile || !type) {
    log('ACTION_VALIDATION_FAIL', { requestId: req.requestId, type, mobile });
    return res.status(400).json({ error: 'Missing mobile or type' });
  }

  try {
    log('ACTION_REQUEST', { requestId: req.requestId, mobile, type });
    const participant = await Participant.findOne({ mobile });
    if (!participant) {
      log('ACTION_PARTICIPANT_NOT_FOUND', { requestId: req.requestId, mobile, type });
      return res.status(404).json({ error: 'Participant not found' });
    }

    if (type === 'register') {
      const alreadyRegistered = isRegistered(participant);
      participant.lab_no = normalizeLabNo(participant.lab_no);
      participant.registered = true;
      participant.is_present = true;
      await participant.save();
      log('ACTION_REGISTER_SUCCESS', {
        requestId: req.requestId,
        mobile,
        alreadyRegistered,
        name: participant.name,
        team_name: participant.team_name,
        lab_no: participant.lab_no,
      });
      return res.json({
        success: true,
        alreadyRegistered,
        name: participant.name,
        team_name: participant.team_name,
        lab_no: participant.lab_no,
        isRegister: true,
        isRegistered: true,
        registered: true,
      });
    }

    if (type === 'redbull' || type === 'dinner') {
      if (!isRegistered(participant)) {
        log('ACTION_CLAIM_NOT_REGISTERED', { requestId: req.requestId, mobile, type });
        return res.status(400).json({ error: 'Not Registered Yet' });
      }

      const flag = type === 'redbull' ? 'has_redbull' : 'has_dinner';
      if (participant[flag]) {
        log('ACTION_CLAIM_ALREADY', { requestId: req.requestId, mobile, type, flag });
        return res.status(400).json({ error: 'Already Claimed' });
      }

      participant[flag] = true;
      participant.lab_no = normalizeLabNo(participant.lab_no);
      await participant.save();
      log('ACTION_CLAIM_SUCCESS', {
        requestId: req.requestId,
        mobile,
        type,
        name: participant.name,
        team_name: participant.team_name,
        lab_no: participant.lab_no,
      });
      return res.json({
        success: true,
        name: participant.name,
        team_name: participant.team_name,
        lab_no: participant.lab_no,
      });
    }

    log('ACTION_INVALID_TYPE', { requestId: req.requestId, mobile, type });
    return res.status(400).json({ error: 'Invalid type' });
  } catch (err) {
    logError('ACTION_ERROR', err, { requestId: req.requestId, mobile, type });
    return res.status(500).json({ error: err.message });
  }
});

app.get('/stats', requireTechAccess, async (req, res) => {
  try {
    const stats = await getDashboardStats();
    log('STATS_SUCCESS', { requestId: req.requestId, stats });
    res.json({
      checkInCount: stats.registeredParticipants,
      ...stats,
      serverTime: now(),
    });
  } catch (err) {
    logError('STATS_ERROR', err, { requestId: req.requestId });
    res.status(500).json({ error: err.message });
  }
});

app.get('/dashboard', requireTechAccess, async (req, res) => {
  try {
    const [stats, teams] = await Promise.all([getDashboardStats(), getTeamDashboardList()]);
    res.json({
      ...stats,
      teams,
      serverTime: now(),
    });
  } catch (err) {
    logError('DASHBOARD_ERROR', err, { requestId: req.requestId });
    res.status(500).json({ error: err.message });
  }
});

app.get('/dashboard/participants', requireTechAccess, async (req, res) => {
  try {
    const participants = await getParticipantList();
    res.json({ count: participants.length, participants, serverTime: now() });
  } catch (err) {
    logError('DASHBOARD_PARTICIPANTS_ERROR', err, { requestId: req.requestId });
    res.status(500).json({ error: err.message });
  }
});

app.get('/exports/participants', requireTechAccess, async (req, res) => {
  try {
    const format = String(req.query.format || 'csv').toLowerCase();
    const participants = await getParticipantList();

    if (format === 'json') {
      return res.json({ count: participants.length, participants, exportedAt: now() });
    }

    if (format !== 'csv') {
      return res.status(400).json({ error: 'Invalid format. Use csv or json.' });
    }

    const headers = [
      { key: 'mobile', label: 'Mobile' },
      { key: 'name', label: 'Name' },
      { key: 'team_name', label: 'Team Name' },
      { key: 'lab_no', label: 'Lab No' },
      { key: 'registered', label: 'Registered' },
      { key: 'has_dinner', label: 'Dinner Taken' },
      { key: 'has_redbull', label: 'RedBull Taken' },
      { key: 'is_fake', label: 'Fake Test Entry' },
    ];

    const csv = toCsv(headers, participants);
    sendCsv(res, `participants_${Date.now()}.csv`, csv);
    return null;
  } catch (err) {
    logError('EXPORT_PARTICIPANTS_ERROR', err, { requestId: req.requestId });
    return res.status(500).json({ error: err.message });
  }
});

app.get('/exports/teams', requireTechAccess, async (req, res) => {
  try {
    const format = String(req.query.format || 'csv').toLowerCase();
    const teams = await getTeamDashboardList();

    if (format === 'json') {
      return res.json({ count: teams.length, teams, exportedAt: now() });
    }

    if (format !== 'csv') {
      return res.status(400).json({ error: 'Invalid format. Use csv or json.' });
    }

    const headers = [
      { key: 'team_name', label: 'Team Name' },
      { key: 'lab_no', label: 'Lab No' },
      { key: 'participant_count', label: 'Participants' },
      { key: 'registered_count', label: 'Registered Participants' },
      { key: 'remaining_count', label: 'Remaining Participants' },
      { key: 'dinner_count', label: 'Dinner Taken' },
      { key: 'dinner_pending_count', label: 'Dinner Pending' },
      { key: 'team_registered', label: 'Team Registered' },
    ];

    const csv = toCsv(headers, teams);
    sendCsv(res, `teams_${Date.now()}.csv`, csv);
    return null;
  } catch (err) {
    logError('EXPORT_TEAMS_ERROR', err, { requestId: req.requestId });
    return res.status(500).json({ error: err.message });
  }
});

app.get('/evaluations', requireTechAccess, async (req, res) => {
  try {
    const evaluations = await getMergedEvaluations();
    res.json({ count: evaluations.length, evaluations, serverTime: now() });
  } catch (err) {
    logError('EVALUATION_LIST_ERROR', err, { requestId: req.requestId });
    res.status(500).json({ error: err.message });
  }
});

app.post('/evaluations', requireTechAccess, async (req, res) => {
  const teamName = String(req.body?.team_name || '').trim();
  const providedLabNo = String(req.body?.lab_no || '').trim();

  if (!teamName) {
    return res.status(400).json({ error: 'team_name is required' });
  }

  try {
    const evaluation1 = normalizeScore(req.body?.evaluation_1);
    const evaluation2 = normalizeScore(req.body?.evaluation_2);
    const finalPresentation = normalizeScore(req.body?.final_presentation);
    const total = evaluation1 + evaluation2 + finalPresentation;

    const existingParticipant = await Participant.findOne({ team_name: teamName }).lean();
    const labNo = normalizeLabNo(providedLabNo || existingParticipant?.lab_no);

    const evaluation = await Evaluation.findOneAndUpdate(
      { team_name: teamName },
      {
        team_name: teamName,
        lab_no: labNo,
        evaluation_1: evaluation1,
        evaluation_2: evaluation2,
        final_presentation: finalPresentation,
        total,
        remarks: String(req.body?.remarks || '').trim(),
        evaluated_at: new Date(),
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    log('EVALUATION_UPSERT_SUCCESS', {
      requestId: req.requestId,
      teamName,
      total,
    });

    res.json({ success: true, evaluation });
  } catch (err) {
    logError('EVALUATION_UPSERT_ERROR', err, { requestId: req.requestId, teamName });
    res.status(500).json({ error: err.message });
  }
});

app.get('/exports/evaluations', requireTechAccess, async (req, res) => {
  try {
    const format = String(req.query.format || 'csv').toLowerCase();
    const evaluations = await getMergedEvaluations();

    if (format === 'json') {
      return res.json({ count: evaluations.length, evaluations, exportedAt: now() });
    }

    if (format !== 'csv') {
      return res.status(400).json({ error: 'Invalid format. Use csv or json.' });
    }

    const headers = [
      { key: 'team_name', label: 'Team Name' },
      { key: 'lab_no', label: 'Lab No' },
      { key: 'participant_count', label: 'Participants' },
      { key: 'evaluation_1', label: 'Evaluation 1' },
      { key: 'evaluation_2', label: 'Evaluation 2' },
      { key: 'final_presentation', label: 'Final Presentation' },
      { key: 'total', label: 'Total' },
      { key: 'remarks', label: 'Remarks' },
      { key: 'evaluated', label: 'Evaluated' },
      { key: 'evaluated_at', label: 'Evaluated At' },
      { key: 'updatedAt', label: 'Updated At' },
    ];

    const csv = toCsv(
      headers,
      evaluations.map((item) => ({
        ...item,
        evaluated_at: item.evaluated_at ? new Date(item.evaluated_at).toISOString() : '',
        updatedAt: item.updatedAt ? new Date(item.updatedAt).toISOString() : '',
      }))
    );

    sendCsv(res, `evaluations_${Date.now()}.csv`, csv);
    return null;
  } catch (err) {
    logError('EXPORT_EVALUATIONS_ERROR', err, { requestId: req.requestId });
    return res.status(500).json({ error: err.message });
  }
});

// app.listen(PORT, HOST, () => {
//   log('SERVER_LISTENING', {
//     host: HOST,
//     port: PORT,
//     localhostUrl: `http://127.0.0.1:${PORT}`,
//     networkUrls: getNetworkUrls(),
//   });
// });

app.listen(PORT, HOST, () => {
  log('SERVER_LISTENING', {
    host: HOST,
    port: PORT,
    localhostUrl: `http://127.0.0.1:${PORT}`,
    networkUrls: getNetworkUrls(),
  });
});
