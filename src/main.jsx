import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ClipboardCheck,
  Eye,
  Filter,
  Lock,
  LogOut,
  MessageSquarePlus,
  Plus,
  RefreshCcw,
  Save,
  Search,
  ShieldCheck
} from 'lucide-react';
import { api, setToken } from './lib/api';
import './styles.css';

const emptyReport = {
  reporterName: '',
  area: '',
  locationType: '',
  concreteLocation: '',
  description: '',
  urgency: '',
  evidenceUrl: '',
  evidenceFile: null
};

function App() {
  const [catalogs, setCatalogs] = useState(null);
  const [reports, setReports] = useState([]);
  const [stats, setStats] = useState(null);
  const [selected, setSelected] = useState(null);
  const [events, setEvents] = useState([]);
  const [admin, setAdmin] = useState(null);
  const [mode, setMode] = useState('report');
  const [filters, setFilters] = useState({ search: '', status: '' });
  const [notice, setNotice] = useState('');

  async function loadData(nextFilters = filters) {
    const params = new URLSearchParams();
    if (nextFilters.search) params.set('search', nextFilters.search);
    if (nextFilters.status) params.set('status', nextFilters.status);

    const [catalogData, reportData, statData] = await Promise.all([
      api('/catalogs'),
      api(`/reports?${params.toString()}`),
      api('/stats')
    ]);
    setCatalogs(catalogData);
    setReports(reportData);
    setStats(statData);
  }

  useEffect(() => {
    loadData().catch((error) => setNotice(error.message));
    api('/auth/me').then(({ user }) => setAdmin(user)).catch(() => {});
  }, []);

  async function openReport(report) {
    setSelected(report);
    setMode('detail');
    setEvents(await api(`/reports/${report.id}/events`));
  }

  async function refreshSelected(report) {
    await loadData();
    await openReport(report);
  }

  const statusCounts = useMemo(() => {
    const map = new Map((stats?.byStatus || []).map((item) => [item.status, item.total]));
    return catalogs?.statuses?.map((status) => ({ status, total: map.get(status) || 0 })) || [];
  }, [stats, catalogs]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">OFIJU Multifuero Jachal | SGC</p>
          <h1>Hallazgos y oportunidades de mejora</h1>
        </div>
        <div className="top-actions">
          <button className="ghost" onClick={() => setMode('list')}>
            <Eye size={18} /> Ver solicitudes
          </button>
          <button className="primary" onClick={() => setMode('report')}>
            <Plus size={18} /> Nuevo reporte
          </button>
          <AdminAccess admin={admin} setAdmin={setAdmin} />
        </div>
      </header>

      {notice && <div className="notice">{notice}</div>}

      <section className="metrics" aria-label="Indicadores">
        <Metric label="Total" value={stats?.totals?.total || 0} />
        <Metric label="Cerrados" value={stats?.totals?.closed || 0} />
        <Metric label="Sin responsable" value={stats?.totals?.withoutOwner || 0} />
        {statusCounts.slice(0, 3).map((item) => (
          <Metric key={item.status} label={item.status} value={item.total} />
        ))}
      </section>

      {mode === 'report' && catalogs && (
        <ReportForm
          catalogs={catalogs}
          onCreated={(report) => {
            setNotice(`Hallazgo registrado con ID ${report.id}`);
            loadData();
            openReport(report);
          }}
        />
      )}

      {mode === 'list' && catalogs && (
        <ReportList
          catalogs={catalogs}
          reports={reports}
          filters={filters}
          setFilters={setFilters}
          onFilter={(nextFilters) => loadData(nextFilters)}
          onOpen={openReport}
        />
      )}

      {mode === 'detail' && selected && catalogs && (
        <ReportDetail
          catalogs={catalogs}
          report={selected}
          events={events}
          admin={admin}
          onBack={() => setMode('list')}
          onRefresh={refreshSelected}
        />
      )}
    </main>
  );
}

function Metric({ label, value }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function AdminAccess({ admin, setAdmin }) {
  const [open, setOpen] = useState(false);
  const [credentials, setCredentials] = useState({ email: 'admin@ofiju.local', password: 'Cambiar123!' });
  const [error, setError] = useState('');

  async function login(event) {
    event.preventDefault();
    setError('');
    try {
      const data = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify(credentials)
      });
      setToken(data.token);
      setAdmin(data.user);
      setOpen(false);
    } catch (err) {
      setError(err.message);
    }
  }

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setToken(null);
    setAdmin(null);
  }

  if (admin) {
    return (
      <button className="ghost" onClick={logout} title="Cerrar sesion">
        <LogOut size={18} /> {admin.name}
      </button>
    );
  }

  return (
    <div className="admin-popover">
      <button className="ghost" onClick={() => setOpen((value) => !value)}>
        <Lock size={18} /> Admin
      </button>
      {open && (
        <form className="login-box" onSubmit={login}>
          <label>
            Email
            <input
              value={credentials.email}
              onChange={(event) => setCredentials({ ...credentials, email: event.target.value })}
            />
          </label>
          <label>
            Clave
            <input
              type="password"
              value={credentials.password}
              onChange={(event) => setCredentials({ ...credentials, password: event.target.value })}
            />
          </label>
          {error && <small className="error">{error}</small>}
          <button className="primary" type="submit">
            <ShieldCheck size={16} /> Ingresar
          </button>
        </form>
      )}
    </div>
  );
}

function ReportForm({ catalogs, onCreated }) {
  const [form, setForm] = useState({ ...emptyReport });
  const [fileName, setFileName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateEvidenceFile(file) {
    if (!file) {
      update('evidenceFile', null);
      setFileName('');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      update('evidenceFile', {
        name: file.name,
        type: file.type,
        data: reader.result
      });
      setFileName(file.name);
    };
    reader.readAsDataURL(file);
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const report = await api('/reports', {
        method: 'POST',
        body: JSON.stringify(form)
      });
      setForm({ ...emptyReport });
      setFileName('');
      onCreated(report);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel">
      <div className="section-title">
        <ClipboardCheck size={22} />
        <div>
          <h2>Registrar hallazgo</h2>
          <p>Cargue solo la informacion necesaria para ubicar y tratar el problema.</p>
        </div>
      </div>

      <form className="grid-form" onSubmit={submit}>
        <Field label="Nombre y apellido">
          <input value={form.reporterName} onChange={(event) => update('reporterName', event.target.value)} required />
        </Field>
        <div className="auto-date">
          <span>Fecha de registro</span>
          <strong>{formatDate(new Date().toISOString())}</strong>
        </div>
        <Field label="Area o proceso">
          <select value={form.area} onChange={(event) => update('area', event.target.value)} required>
            <option value="">Seleccionar</option>
            {catalogs.areas.map((item) => <option key={item}>{item}</option>)}
          </select>
        </Field>
        <Field label="Sistema o lugar">
          <select value={form.locationType} onChange={(event) => update('locationType', event.target.value)} required>
            <option value="">Seleccionar</option>
            {catalogs.locations.map((item) => <option key={item}>{item}</option>)}
          </select>
        </Field>
        <Field label="Ubicacion concreta" wide>
          <input
            value={form.concreteLocation}
            onChange={(event) => update('concreteLocation', event.target.value)}
            placeholder="SAE > tramite X, escritorio, planilla o pantalla especifica"
            required
          />
        </Field>
        <Field label="Descripcion breve" wide>
          <textarea
            rows="5"
            value={form.description}
            onChange={(event) => update('description', event.target.value)}
            placeholder="Que se esperaba y que ocurrio"
            required
          />
        </Field>
        <Field label="Urgencia aparente">
          <select value={form.urgency} onChange={(event) => update('urgency', event.target.value)} required>
            <option value="">Seleccionar</option>
            {catalogs.priorities.map((item) => <option key={item}>{item}</option>)}
          </select>
        </Field>
        <Field label="Link de evidencia">
          <input type="url" value={form.evidenceUrl} onChange={(event) => update('evidenceUrl', event.target.value)} placeholder="https://..." />
        </Field>
        <Field label="Captura de pantalla opcional">
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => updateEvidenceFile(event.target.files?.[0])} />
          {fileName && <small className="hint">Archivo seleccionado: {fileName}</small>}
        </Field>

        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button className="primary" disabled={saving}>
            <Save size={18} /> {saving ? 'Guardando...' : 'Registrar'}
          </button>
        </div>
      </form>
    </section>
  );
}

function Field({ label, children, wide }) {
  return (
    <label className={wide ? 'field wide' : 'field'}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function ReportList({ catalogs, reports, filters, setFilters, onFilter, onOpen }) {
  function change(next) {
    setFilters(next);
    onFilter(next);
  }

  return (
    <section className="panel">
      <div className="toolbar">
        <div className="search">
          <Search size={18} />
          <input
            value={filters.search}
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onFilter(filters);
            }}
            placeholder="Buscar por ID, area, sistema o descripcion"
          />
        </div>
        <select value={filters.status} onChange={(event) => change({ ...filters, status: event.target.value })}>
          <option value="">Todos los estados</option>
          {catalogs.statuses.map((status) => <option key={status}>{status}</option>)}
        </select>
        <button className="ghost" onClick={() => onFilter(filters)}>
          <Filter size={18} /> Filtrar
        </button>
        <button className="ghost" onClick={() => change({ search: '', status: '' })}>
          <RefreshCcw size={18} /> Limpiar
        </button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Estado</th>
              <th>Urgencia</th>
              <th>Area</th>
              <th>Sistema/lugar</th>
              <th>Responsable</th>
              <th>Creado</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((report) => (
              <tr key={report.id} onClick={() => onOpen(report)}>
                <td>{report.id}</td>
                <td><StatusBadge status={report.status} /></td>
                <td>{report.urgency}</td>
                <td>{report.area}</td>
                <td>{report.locationType}</td>
                <td>{report.owner || 'Sin asignar'}</td>
                <td>{formatDate(report.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReportDetail({ catalogs, report, events, admin, onBack, onRefresh }) {
  const [edit, setEdit] = useState(report);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');

  useEffect(() => setEdit(report), [report]);

  function update(field, value) {
    setEdit((current) => ({ ...current, [field]: value }));
  }

  async function save() {
    setError('');
    try {
      const updated = await api(`/admin/reports/${report.id}`, {
        method: 'PATCH',
        body: JSON.stringify(edit)
      });
      onRefresh(updated);
    } catch (err) {
      setError(err.message);
    }
  }

  async function addComment() {
    if (!comment.trim()) return;
    await api(`/admin/reports/${report.id}/events`, {
      method: 'POST',
      body: JSON.stringify({ message: comment })
    });
    setComment('');
    onRefresh(report);
  }

  return (
    <section className="detail-layout">
      <article className="panel">
        <div className="detail-header">
          <button className="ghost" onClick={onBack}>Volver</button>
          <StatusBadge status={report.status} />
        </div>
        <h2>{report.id}</h2>
        <dl className="details">
          <div><dt>Reporta</dt><dd>{report.reporterName}</dd></div>
          <div><dt>Fecha hallazgo</dt><dd>{formatDate(report.findingDate)}</dd></div>
          <div><dt>Area</dt><dd>{report.area}</dd></div>
          <div><dt>Sistema o lugar</dt><dd>{report.locationType}</dd></div>
          <div><dt>Ubicacion</dt><dd>{report.concreteLocation}</dd></div>
          <div className="wide"><dt>Descripcion</dt><dd>{report.description}</dd></div>
          {(report.evidenceUrl || report.evidenceFile) && (
            <div className="wide">
              <dt>Evidencia</dt>
              <dd className="evidence-links">
                {report.evidenceUrl && <a href={report.evidenceUrl} target="_blank">Abrir link</a>}
                {report.evidenceFile && <a href={report.evidenceFile} target="_blank">Abrir captura</a>}
              </dd>
            </div>
          )}
        </dl>
      </article>

      <article className="panel admin-panel">
        <div className="section-title">
          <ShieldCheck size={22} />
          <div>
            <h2>Seguimiento</h2>
            <p>{admin ? 'Edicion habilitada para administradores.' : 'Solo lectura para usuarios generales.'}</p>
          </div>
        </div>

        <div className="grid-form compact">
          <Field label="Tipo SGC">
            <select value={edit.sgcType || ''} onChange={(event) => update('sgcType', event.target.value)} disabled={!admin}>
              <option value="">Sin clasificar</option>
              {catalogs.sgcTypes.map((item) => <option key={item}>{item}</option>)}
            </select>
          </Field>
          <Field label="Estado">
            <select value={edit.status} onChange={(event) => update('status', event.target.value)} disabled={!admin}>
              {catalogs.statuses.map((item) => <option key={item}>{item}</option>)}
            </select>
          </Field>
          <Field label="Responsable">
            <input value={edit.owner || ''} onChange={(event) => update('owner', event.target.value)} disabled={!admin} />
          </Field>
          <Field label="Plazo">
            <input type="date" value={edit.dueDate || ''} onChange={(event) => update('dueDate', event.target.value)} disabled={!admin} />
          </Field>
          <Field label="Accion requerida" wide>
            <textarea rows="3" value={edit.requiredAction || ''} onChange={(event) => update('requiredAction', event.target.value)} disabled={!admin} />
          </Field>
          <Field label="Eficacia">
            <select value={edit.efficacy || 'Pendiente'} onChange={(event) => update('efficacy', event.target.value)} disabled={!admin}>
              {catalogs.efficacies.map((item) => <option key={item}>{item}</option>)}
            </select>
          </Field>
          <Field label="Fecha cierre">
            <input type="date" value={edit.closedAt || ''} onChange={(event) => update('closedAt', event.target.value)} disabled={!admin} />
          </Field>
          <Field label="Observaciones" wide>
            <textarea rows="3" value={edit.observations || ''} onChange={(event) => update('observations', event.target.value)} disabled={!admin} />
          </Field>
        </div>

        {error && <p className="form-error">{error}</p>}
        {admin && (
          <div className="form-actions">
            <button className="primary" onClick={save}><Save size={18} /> Guardar seguimiento</button>
          </div>
        )}
      </article>

      <article className="panel timeline">
        <div className="section-title">
          <MessageSquarePlus size={22} />
          <div>
            <h2>Historial</h2>
            <p>Eventos y comentarios del seguimiento.</p>
          </div>
        </div>
        {events.map((event, index) => (
          <div className="event" key={`${event.createdAt}-${index}`}>
            <strong>{event.userName || 'Sistema'}</strong>
            <span>{formatDateTime(event.createdAt)}</span>
            <p>{event.message}</p>
          </div>
        ))}
        {admin && (
          <div className="comment-box">
            <textarea rows="3" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Agregar comentario interno" />
            <button className="ghost" onClick={addComment}><MessageSquarePlus size={18} /> Agregar</button>
          </div>
        )}
      </article>
    </section>
  );
}

function StatusBadge({ status }) {
  return <span className={`status ${status.toLowerCase().replaceAll(' ', '-')}`}>{status}</span>;
}

function formatDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('es-AR').format(new Date(value));
}

function formatDateTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

createRoot(document.getElementById('root')).render(<App />);
