import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, cleanupExpiredSessions } from './db.js';
import { config } from './config.js';
import { createToken, verifyPassword } from './auth.js';
import { AREAS, EFICACIAS, ESTADOS, LUGARES, PRIORIDADES, TIPOS_SGC } from './catalogs.js';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.resolve(__dirname, '..', 'data', 'uploads');

fs.mkdirSync(uploadDir, { recursive: true });

app.use(cors({
  origin: config.appOrigin,
  credentials: true
}));
app.use(express.json({ limit: '8mb' }));
app.use('/uploads', express.static(uploadDir));

const requiredPublicFields = [
  'reporterName',
  'area',
  'locationType',
  'concreteLocation',
  'description',
  'urgency'
];

function getSessionToken(req) {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

function requireAdmin(req, res, next) {
  cleanupExpiredSessions();

  const token = getSessionToken(req);
  if (!token) return res.status(401).json({ error: 'Sesion requerida' });

  const session = db.prepare(`
    SELECT users.id, users.name, users.email, users.role
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token = ?
      AND sessions.expires_at > CURRENT_TIMESTAMP
      AND users.active = 1
  `).get(token);

  if (!session) return res.status(401).json({ error: 'Sesion vencida o invalida' });

  req.user = session;
  next();
}

function reportToPublic(row) {
  return {
    id: row.public_id,
    reporterName: row.reporter_name,
    findingDate: row.finding_date,
    area: row.area,
    locationType: row.location_type,
    concreteLocation: row.concrete_location,
    description: row.description,
    urgency: row.urgency,
    evidenceUrl: row.evidence_url,
    evidenceFile: row.evidence_file,
    sgcType: row.sgc_type,
    status: row.status,
    owner: row.owner,
    dueDate: row.due_date,
    requiredAction: row.required_action,
    efficacy: row.efficacy,
    closedAt: row.closed_at,
    observations: row.observations,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function makePublicId() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `H-${stamp}-${suffix}`;
}

function todayLocalDate() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function saveEvidenceFile(file) {
  if (!file?.data || !file?.name) return null;

  const match = String(file.data).match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/);
  if (!match) {
    const error = new Error('La captura debe ser PNG, JPG o WebP');
    error.statusCode = 400;
    throw error;
  }

  const extensionByMime = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/webp': '.webp'
  };
  const buffer = Buffer.from(match[2], 'base64');
  const maxBytes = 5 * 1024 * 1024;

  if (buffer.length > maxBytes) {
    const error = new Error('La captura no debe superar 5 MB');
    error.statusCode = 400;
    throw error;
  }

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extensionByMime[match[1]]}`;
  fs.writeFileSync(path.join(uploadDir, filename), buffer);
  return `/uploads/${filename}`;
}

function addEvent(reportId, userId, eventType, message) {
  db.prepare(`
    INSERT INTO report_events (report_id, user_id, event_type, message)
    VALUES (?, ?, ?, ?)
  `).run(reportId, userId || null, eventType, message);
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/catalogs', (_req, res) => {
  res.json({
    areas: AREAS,
    locations: LUGARES,
    priorities: PRIORIDADES,
    sgcTypes: TIPOS_SGC,
    statuses: ESTADOS,
    efficacies: EFICACIAS
  });
});

app.post('/api/reports', (req, res) => {
  try {
    const missing = requiredPublicFields.filter((field) => !String(req.body[field] || '').trim());
    if (missing.length) {
      return res.status(400).json({ error: 'Faltan campos obligatorios', fields: missing });
    }

    const evidenceFile = saveEvidenceFile(req.body.evidenceFile);
    const publicId = makePublicId();
    const insert = db.prepare(`
      INSERT INTO reports (
        public_id, reporter_name, finding_date, area, location_type, concrete_location,
        description, urgency, evidence_url, evidence_file
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insert.run(
      publicId,
      req.body.reporterName.trim(),
      todayLocalDate(),
      req.body.area,
      req.body.locationType,
      req.body.concreteLocation.trim(),
      req.body.description.trim(),
      req.body.urgency,
      req.body.evidenceUrl?.trim() || null,
      evidenceFile
    );

    addEvent(result.lastInsertRowid, null, 'created', 'Hallazgo registrado por formulario publico');

    const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(reportToPublic(row));
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'No se pudo registrar el hallazgo' });
  }
});

app.get('/api/reports', (req, res) => {
  const search = `%${String(req.query.search || '').trim()}%`;
  const status = String(req.query.status || '').trim();

  const rows = status
    ? db.prepare(`
        SELECT * FROM reports
        WHERE status = ?
          AND (public_id LIKE ? OR area LIKE ? OR location_type LIKE ? OR description LIKE ?)
        ORDER BY created_at DESC
      `).all(status, search, search, search, search)
    : db.prepare(`
        SELECT * FROM reports
        WHERE public_id LIKE ? OR area LIKE ? OR location_type LIKE ? OR description LIKE ?
        ORDER BY created_at DESC
      `).all(search, search, search, search);

  res.json(rows.map(reportToPublic));
});

app.get('/api/reports/:publicId/events', (req, res) => {
  const report = db.prepare('SELECT id FROM reports WHERE public_id = ?').get(req.params.publicId);
  if (!report) return res.status(404).json({ error: 'Hallazgo no encontrado' });

  const events = db.prepare(`
    SELECT report_events.event_type AS type, report_events.message, report_events.created_at AS createdAt,
           users.name AS userName
    FROM report_events
    LEFT JOIN users ON users.id = report_events.user_id
    WHERE report_events.report_id = ?
    ORDER BY report_events.created_at ASC
  `).all(report.id);

  res.json(events);
});

app.get('/api/stats', (_req, res) => {
  const byStatus = db.prepare(`
    SELECT status, COUNT(*) AS total
    FROM reports
    GROUP BY status
  `).all();

  const byUrgency = db.prepare(`
    SELECT urgency, COUNT(*) AS total
    FROM reports
    GROUP BY urgency
  `).all();

  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'Cerrado' THEN 1 ELSE 0 END) AS closed,
      SUM(CASE WHEN owner IS NULL OR owner = '' THEN 1 ELSE 0 END) AS withoutOwner
    FROM reports
  `).get();

  res.json({ totals, byStatus, byUrgency });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email);

  if (!user || !verifyPassword(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Credenciales invalidas' });
  }

  const token = createToken();
  db.prepare(`
    INSERT INTO sessions (token, user_id, expires_at)
    VALUES (?, ?, datetime('now', '+8 hours'))
  `).run(token, user.id);

  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role }
  });
});

app.post('/api/auth/logout', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(getSessionToken(req));
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAdmin, (req, res) => {
  res.json({ user: req.user });
});

app.patch('/api/admin/reports/:publicId', requireAdmin, (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE public_id = ?').get(req.params.publicId);
  if (!report) return res.status(404).json({ error: 'Hallazgo no encontrado' });

  const patch = {
    sgc_type: req.body.sgcType ?? report.sgc_type,
    status: req.body.status ?? report.status,
    owner: req.body.owner ?? report.owner,
    due_date: req.body.dueDate ?? report.due_date,
    required_action: req.body.requiredAction ?? report.required_action,
    efficacy: req.body.efficacy ?? report.efficacy,
    closed_at: req.body.closedAt ?? report.closed_at,
    observations: req.body.observations ?? report.observations
  };

  if (!ESTADOS.includes(patch.status)) {
    return res.status(400).json({ error: 'Estado invalido' });
  }

  db.prepare(`
    UPDATE reports
    SET sgc_type = ?, status = ?, owner = ?, due_date = ?, required_action = ?,
        efficacy = ?, closed_at = ?, observations = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    patch.sgc_type || null,
    patch.status,
    patch.owner || null,
    patch.due_date || null,
    patch.required_action || null,
    patch.efficacy || 'Pendiente',
    patch.closed_at || null,
    patch.observations || null,
    report.id
  );

  const changed = [];
  if (report.status !== patch.status) changed.push(`estado: ${report.status} -> ${patch.status}`);
  if ((report.owner || '') !== (patch.owner || '')) changed.push(`responsable: ${patch.owner || 'sin asignar'}`);
  addEvent(report.id, req.user.id, 'updated', changed.length ? changed.join('; ') : 'Seguimiento actualizado');

  const updated = db.prepare('SELECT * FROM reports WHERE id = ?').get(report.id);
  res.json(reportToPublic(updated));
});

app.post('/api/admin/reports/:publicId/events', requireAdmin, (req, res) => {
  const message = String(req.body.message || '').trim();
  if (!message) return res.status(400).json({ error: 'El comentario es obligatorio' });

  const report = db.prepare('SELECT id FROM reports WHERE public_id = ?').get(req.params.publicId);
  if (!report) return res.status(404).json({ error: 'Hallazgo no encontrado' });

  addEvent(report.id, req.user.id, 'comment', message);
  res.status(201).json({ ok: true });
});

if (!process.env.VERCEL) {
  app.listen(config.port, () => {
    console.log(`API Hallazgos SGC escuchando en http://127.0.0.1:${config.port}`);
  });
}

export default app;
