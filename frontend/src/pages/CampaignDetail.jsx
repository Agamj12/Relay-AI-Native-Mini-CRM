import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, inr, pct } from '../lib/api.js';

const STEPS = [
  { key: 'sent', label: 'Sent', color: 'var(--st-sent)', of: 'audience_size' },
  { key: 'delivered', label: 'Delivered', color: 'var(--st-delivered)', of: 'sent' },
  { key: 'opened', label: 'Opened', color: 'var(--st-opened)', of: 'delivered' },
  { key: 'clicked', label: 'Clicked', color: 'var(--st-clicked)', of: 'opened' },
  { key: 'converted', label: 'Ordered', color: 'var(--st-converted)', of: 'clicked' },
];

export default function CampaignDetail() {
  const { id } = useParams();
  const [c, setC] = useState(null);
  const [err, setErr] = useState(null);
  const [insight, setInsight] = useState(null);
  const [insightBusy, setInsightBusy] = useState(false);
  const liveRef = useRef(true);

  useEffect(() => {
    let timer;
    const load = async () => {
      try {
        const data = await api(`/campaigns/${id}`);
        setC(data);
        // Stop polling once the funnel has clearly settled.
        const settled = data.status === 'ACTIVE' && data.sent > 0 &&
          data.delivered + data.failed >= data.sent && Date.now() - new Date(data.launched_at).getTime() > 90000;
        liveRef.current = !settled;
      } catch (e) { setErr(e.message); }
      timer = setTimeout(load, liveRef.current ? 2000 : 10000);
    };
    load();
    return () => clearTimeout(timer);
  }, [id]);

  const getInsight = async () => {
    setInsightBusy(true);
    try { setInsight((await api(`/campaigns/${id}/insight`, { method: 'POST' })).text); }
    catch (e) { setInsight(`Could not generate insight: ${e.message}`); }
    setInsightBusy(false);
  };

  if (err) return <div className="error">{err}</div>;
  if (!c) return <div className="empty">Loading…</div>;

  const max = Math.max(c.audience_size, 1);

  return (
    <>
      <div className="crumbs"><Link to="/campaigns">campaigns</Link> / {c.name}</div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 className="page-title">{c.name}</h1>
        <span className={`status ${c.status}`}>{c.status}</span>
      </div>
      <p className="page-sub">
        {c.channel} · {c.segment_name} ({c.segment_description}) · {c.audience_size} shoppers
      </p>

      <div className="kpis">
        <div className="kpi"><div className="label">Delivery rate</div><div className="value">{pct(c.delivered, c.sent)}</div></div>
        <div className="kpi"><div className="label">Open rate</div><div className="value">{pct(c.opened, c.delivered)}</div></div>
        <div className="kpi"><div className="label">Click rate</div><div className="value">{pct(c.clicked, c.opened)}</div></div>
        <div className="kpi signal"><div className="label">Attributed revenue</div><div className="value">{inr(c.revenue)}</div></div>
      </div>

      <div className="stack">
        <div className="card">
          <h3>Funnel</h3>
          <div className="funnel" style={{ marginTop: 14 }}>
            {STEPS.map((s) => (
              <div className="fstep" key={s.key}>
                <div className="flabel">{s.label}</div>
                <div className="fbar-track"><div className="fbar" style={{ width: `${(c[s.key] / max) * 100}%`, background: s.color }} /></div>
                <div className="fnum">{c[s.key]}<span className="pct">{pct(c[s.key], c[s.of])}</span></div>
              </div>
            ))}
            <div className="fstep">
              <div className="flabel">Failed</div>
              <div className="fbar-track"><div className="fbar" style={{ width: `${(c.failed / max) * 100}%`, background: 'var(--st-failed)' }} /></div>
              <div className="fnum">{c.failed}<span className="pct">{pct(c.failed, c.sent)}</span></div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="pulse-head">
            {liveRef.current && <span className="pulse-dot" />}
            <h3>Receipt stream</h3>
            <span className="hint">— callbacks from the channel service, as they land</span>
          </div>
          <div className="pulse">
            {c.recent_events.length === 0 && <span className="empty">Waiting for the first receipts…</span>}
            {c.recent_events.map((e, i) => (
              <span className="pev" key={`${e.communication_id}-${e.type}-${i}`} title={e.received_at}>
                {e.type.toLowerCase()} · {e.first_name}
              </span>
            ))}
          </div>
        </div>

        <div className="card">
          <h3>What happened here?</h3>
          {insight
            ? <p className="insight" style={{ marginTop: 10 }}>{insight}</p>
            : <p className="hint" style={{ marginTop: 4 }}>Ask Relay to read the funnel and tell you what matters.</p>}
          <div style={{ marginTop: 12 }}>
            <button className="btn ghost" onClick={getInsight} disabled={insightBusy}>
              {insightBusy ? 'Reading the numbers…' : insight ? 'Refresh insight' : 'Generate insight'}
            </button>
          </div>
        </div>

        <div className="card">
          <h3>Messages (sample)</h3>
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>Shopper</th><th>Message as sent</th><th>State</th></tr></thead>
            <tbody>
              {c.sample_comms.map((m) => (
                <tr key={m.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{m.first_name} {m.last_name}</td>
                  <td className="muted">{m.rendered_message}</td>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                    {m.status === 'FAILED' ? <span title={m.failure_reason} style={{ color: 'var(--st-failed)' }}>failed</span> : m.status.toLowerCase()}
                    {m.opened_at && ' · opened'}{m.clicked_at && ' · clicked'}{m.converted_at && ' · ordered'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
