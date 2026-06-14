import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';

const CHANNELS = ['WHATSAPP', 'SMS', 'EMAIL', 'RCS'];
const SAMPLE = { first_name: 'Meera', city: 'Pune', total_spend: '₹6,420', last_order_days: '112' };
const renderPreview = (t) => t.replace(/\{\{(\w+)\}\}/g, (_, k) => SAMPLE[k] || `{{${k}}}`);export default function NewCampaign() {
  const nav = useNavigate();
  const [segments, setSegments] = useState([]);
  const [segId, setSegId] = useState('');
  const [channel, setChannel] = useState('WHATSAPP');
  const [brand, setBrand] = useState('Brew & Bloom');
  const [objective, setObjective] = useState('');
  const [name, setName] = useState('');
  const [variants, setVariants] = useState(null);
  const [selected, setSelected] = useState(0);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api('/segments').then((s) => { setSegments(s); if (s[0]) setSegId(String(s[0].id)); }).catch(() => {});
  }, []);

  const draft = async () => {
    setBusy(true); setErr(null);
    try {
      const d = await api('/ai/draft', { method: 'POST', body: { objective, segment_id: segId, channel, brand } });
      setVariants(d.variants);
      setSelected(0);
      setMessage(d.variants[0].text);
      if (!name) setName(objective.length > 40 ? objective.slice(0, 40) + '…' : objective);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const launch = async () => {
    setBusy(true); setErr(null);
    try {
      const c = await api('/campaigns', {
        method: 'POST',
        body: { name, objective, segment_id: segId, channel, message_template: message, brand },
      });
      nav(`/campaigns/${c.id}`);
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  const seg = segments.find((s) => String(s.id) === segId);

  return (
    <>
      <div className="crumbs"><Link to="/campaigns">campaigns</Link> / new</div>
      <h1 className="page-title">New campaign</h1>
      <p className="page-sub">Pick who, say what you want to achieve, and let Relay draft the message.</p>

      <div className="stack">
        <div className="card">
          <h3>1 · Audience &amp; channel</h3>
          {segments.length === 0 ? (
            <p className="empty">No segments yet — <Link to="/audiences" style={{ textDecoration: 'underline' }}>create one first</Link>.</p>
          ) : (
            <div className="row" style={{ marginTop: 10 }}>
              <div className="field">
                <label htmlFor="c-brand">Brand Name</label>
                <input
                  id="c-brand"
                  type="text"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  placeholder="e.g. Brew & Bloom"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="c-seg">Audience</label>
                <select id="c-seg" value={segId} onChange={(e) => setSegId(e.target.value)}>
                  {segments.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.live_size} shoppers)</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="c-channel">Channel</label>
                <select id="c-channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
                  {CHANNELS.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
          )}
          {seg && <p className="hint" style={{ marginTop: 8 }}>{seg.description} · consent for {channel.toLowerCase()} is applied at launch.</p>}
        </div>

        <div className="card">
          <h3>2 · What's the goal?</h3>
          <div className="field" style={{ marginTop: 10 }}>
            <label htmlFor="c-objective">Campaign objective</label>
            <textarea
              id="c-objective"
              placeholder='e.g. "win back lapsed high spenders with a 20% offer, warm tone, mention their favourite drinks"'
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
            />
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="btn" onClick={draft} disabled={busy || !objective.trim() || !segId || !brand.trim()}>
              {busy && !variants ? 'Drafting…' : variants ? 'Draft again' : 'Draft with AI'}
            </button>
          </div>
        </div>

        {variants && (
          <div className="card">
            <h3>3 · Pick an angle, make it yours</h3>
            <div className="variants" style={{ marginTop: 12 }}>
              {variants.map((v, i) => (
                <button
                  key={i}
                  className={`variant ${selected === i ? 'sel' : ''}`}
                  onClick={() => { setSelected(i); setMessage(v.text); }}
                >
                  <div className="vlabel">{v.label}</div>
                  {v.text}
                </button>
              ))}
            </div>
            <div className="field" style={{ marginTop: 16 }}>
              <label htmlFor="c-message">Message — edit freely; tokens like {'{{first_name}}'} personalize per shopper</label>
              <textarea id="c-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={4} />
            </div>
            <p className="hint" style={{ margin: '12px 0 6px' }}>How Meera in Pune will see it:</p>
            <div className="preview-bubble">{renderPreview(message)}</div>

            <div className="row" style={{ marginTop: 18 }}>
              <div className="field">
                <label htmlFor="c-name">Campaign name</label>
                <input id="c-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <button className="btn big" onClick={launch} disabled={busy || !name.trim() || !message.trim()}>
                {busy ? 'Launching…' : `Launch to ${seg ? seg.live_size : ''} shoppers`}
              </button>
            </div>
          </div>
        )}

        {err && <div className="error">{err}</div>}
      </div>
    </>
  );
}
