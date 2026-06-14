import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function Audiences() {
  const [prompt, setPrompt] = useState('');
  const [preview, setPreview] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [segments, setSegments] = useState([]);
  const [savedMsg, setSavedMsg] = useState(null);

  const loadSegments = () => { api('/segments').then(setSegments).catch(() => {}); };
  useEffect(() => { loadSegments(); }, []);

  const runPreview = async () => {
    setBusy(true); setErr(null); setPreview(null); setSavedMsg(null);
    try {
      const p = await api('/segments/preview', { method: 'POST', body: { prompt } });
      setPreview(p);
      if (!name) setName(prompt.length > 48 ? prompt.slice(0, 48) + '…' : prompt);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const s = await api('/segments', { method: 'POST', body: { name, prompt, rules: preview.rules } });
      setSavedMsg(`Saved "${s.name}" — ${s.size_snapshot} shoppers.`);
      setPreview(null); setPrompt(''); setName('');
      loadSegments();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <>
      <h1 className="page-title">Audiences</h1>
      <p className="page-sub">Describe who you want to reach. Relay turns it into rules you can read, check, and save.</p>

      <div className="card">
        <div className="field">
          <label htmlFor="aud-prompt">Who are we talking to?</label>
          <textarea
            id="aud-prompt"
            placeholder='e.g. "shoppers who spent over ₹5000 but have been inactive for 3 months" or "new customers in Mumbai with 2+ orders"'
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>
        <div style={{ marginTop: 12 }}>
          <button className="btn" onClick={runPreview} disabled={busy || !prompt.trim()}>
            {busy ? 'Thinking…' : 'Preview audience'}
          </button>
        </div>
        {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}
        {savedMsg && <div className="chip" style={{ marginTop: 12, display: 'inline-block' }}>{savedMsg}</div>}
      </div>

      {preview && (
        <div className="card">
          <h3>{preview.size.toLocaleString()} shoppers match</h3>
          <p className="hint" style={{ marginBottom: 10 }}>
            Understood as: <strong>{preview.description}</strong>
            <span className="mono muted"> · parsed by {preview.source === 'claude' ? 'Claude' : preview.source === 'gemini' ? 'Gemini' : 'rule parser'}</span>
          </p>
          <div className="chips" style={{ marginBottom: 16 }}>
            {preview.rules.conditions.map((c, i) => (
              <span className="chip" key={i}>{c.field} {c.op} {String(c.value)}</span>
            ))}
            <span className="chip" style={{ background: '#eef1ee', color: 'var(--muted)' }}>{preview.rules.logic}</span>
          </div>
          {preview.sample.length > 0 && (
            <table>
              <thead><tr><th>Shopper</th><th>City</th><th className="num">Spend</th><th className="num">Orders</th><th className="num">Last order</th></tr></thead>
              <tbody>
                {preview.sample.map((s) => (
                  <tr key={s.id}>
                    <td>{s.first_name} {s.last_name}<div className="mono muted">{s.email}</div></td>
                    <td>{s.city}</td>
                    <td className="num">₹{Math.round(s.total_spend).toLocaleString('en-IN')}</td>
                    <td className="num">{s.order_count}</td>
                    <td className="num">{s.last_order_days}d ago</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="row" style={{ marginTop: 16 }}>
            <div className="field">
              <label htmlFor="seg-name">Save as</label>
              <input id="seg-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Segment name" />
            </div>
            <button className="btn" onClick={save} disabled={busy || !name.trim() || preview.size === 0}>Save segment</button>
          </div>
          {preview.size === 0 && <p className="hint" style={{ marginTop: 8 }}>No one matches yet — loosen a condition and preview again.</p>}
        </div>
      )}

      <div className="card">
        <h3>Saved segments</h3>
        {segments.length === 0 ? <p className="empty">Nothing saved yet — your first audience starts above.</p> : (
          <table>
            <thead><tr><th>Name</th><th>Definition</th><th className="num">Size at save</th><th className="num">Size now</th></tr></thead>
            <tbody>
              {segments.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.name}</td>
                  <td className="muted">{s.description}</td>
                  <td className="num">{s.size_snapshot}</td>
                  <td className="num">{s.live_size}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
