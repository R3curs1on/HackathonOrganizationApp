const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const os = require('os');

const Participant = require('./models/Participant');

const app = express();
app.use(express.json());
app.use(cors());

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/hackathon';
const PORT = Number(process.env.PORT || 5000);
const HOST = process.env.HOST || '0.0.0.0';

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
  const interfaces = os.networkInterfaces();
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

log('SERVER_BOOT', { host: HOST, port: PORT, mongoUri: MONGO_URI });

mongoose.connection.on('connected', () => log('MONGO_CONNECTED'));
mongoose.connection.on('error', (err) => logError('MONGO_ERROR', err));
mongoose.connection.on('disconnected', () => log('MONGO_DISCONNECTED'));

mongoose.connect(MONGO_URI).catch((err) => logError('MONGO_CONNECT_FAILED', err));

function normalizeMobile(rawMobile) {
  return String(rawMobile || '').trim().replace(/\.0$/, '');
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
    body: req.body || null,
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
      if (participant.is_present) {
        log('ACTION_REGISTER_ALREADY', { requestId: req.requestId, mobile });
        return res.status(400).json({ error: 'Already Registered' });
      }
      participant.is_present = true;
      await participant.save();
      log('ACTION_REGISTER_SUCCESS', {
        requestId: req.requestId,
        mobile,
        name: participant.name,
        team_name: participant.team_name,
        lab_no: participant.lab_no,
      });
      return res.json({ name: participant.name, team_name: participant.team_name, lab_no: participant.lab_no });
    }

    if (type === 'redbull' || type === 'dinner') {
      if (!participant.is_present) {
        log('ACTION_CLAIM_NOT_REGISTERED', { requestId: req.requestId, mobile, type });
        return res.status(400).json({ error: 'Not Registered Yet' });
      }

      const flag = type === 'redbull' ? 'has_redbull' : 'has_dinner';
      if (participant[flag]) {
        log('ACTION_CLAIM_ALREADY', { requestId: req.requestId, mobile, type, flag });
        return res.status(400).json({ error: 'Already Claimed' });
      }

      participant[flag] = true;
      await participant.save();
      log('ACTION_CLAIM_SUCCESS', {
        requestId: req.requestId,
        mobile,
        type,
        name: participant.name,
        team_name: participant.team_name,
        lab_no: participant.lab_no,
      });
      return res.json({ success: true, name: participant.name, team_name: participant.team_name, lab_no: participant.lab_no });
    }

    log('ACTION_INVALID_TYPE', { requestId: req.requestId, mobile, type });
    return res.status(400).json({ error: 'Invalid type' });
  } catch (err) {
    logError('ACTION_ERROR', err, { requestId: req.requestId, mobile, type });
    return res.status(500).json({ error: err.message });
  }
});

app.get('/stats', async (req, res) => {
  try {
    const checkInCount = await Participant.countDocuments({ is_present: true });
    log('STATS_SUCCESS', { requestId: req.requestId, checkInCount });
    res.json({ checkInCount });
  } catch (err) {
    logError('STATS_ERROR', err, { requestId: req.requestId });
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, HOST, () => {
  log('SERVER_LISTENING', {
    host: HOST,
    port: PORT,
    localhostUrl: `http://127.0.0.1:${PORT}`,
    networkUrls: getNetworkUrls(),
  });
});
