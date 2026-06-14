import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, inr, pct } from '../lib/api.js';

const MiniFunnel = ({ c }) => {
  const total = Math.max(c.audience_size, 1);
  const seg = (n, color) => <span style={{ width: `${(n / total) * 100}%`, background: color }} />;
  return (
    <div className="mini-funnel" title={`delivered ${c.delivered} · opened ${c.opened} · clicked ${c.clicked} · failed ${c.failed}`}>
      {seg(c.delivered - c.opened, 'var(--st-delivered)')}
      {seg(c.opened - c.clicked, 'var(--st-opened)')}
      {seg(c.clicked, 'var(--st-clicked)')}
      {seg(c.failed, 'var(--st-failed)')}
    </div>
  );
};

export default function Dashboard() {
  const [o, setO] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    const load = () => api('/overview').then(setO).catch((e) => setErr(e.message));
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  if (err) return <div className="error">{err}</div>;
  if (!o) return <div className="empty">Loading…</div>;

  return (
    <>
      <h1 className="page-title">Brew &amp; Bloom</h1>
      <p className="page-sub">Everything your shoppers are telling you, in one place.</p>

      <div className="kpis">
        <div className="kpi"><div className="label">Shoppers</div><div className="value">{o.customers.toLocaleString()}</div></div>
        <div className="kpi"><div className="label">Orders</div><div className="value">{o.orders.toLocaleString()}</div></div>
        <div className="kpi"><div className="label">Revenue</div><div className="value">{inr(o.revenue)}</div></div>
        <div className="kpi signal"><div className="label">Campaign-attributed revenue</div><div className="value">{inr(o.attributed_revenue)}</div></div>
      </div>

      <div className="card">
        <h3>Recent campaigns</h3>
        {o.recent_campaigns.length === 0 ? (
          <p className="empty">No campaigns yet. Start by carving an <Link to="/audiences" style={{ textDecoration: 'underline' }}>audience</Link>, then reach it.</p>
        ) : (
          <table>
            <thead><tr><th>Campaign</th><th>Channel</th><th>Status</th><th>Funnel</th><th className="num">Delivered</th><th className="num">Opened</th><th className="num">Revenue</th></tr></thead>
            <tbody>
              {o.recent_campaigns.map((c) => (
                <tr key={c.id}>
                  <td><Link to={`/campaigns/${c.id}`} style={{ fontWeight: 600 }}>{c.name}</Link><div className="mono muted">{c.segment_name}</div></td>
                  <td className="mono">{c.channel}</td>
                  <td><span className={`status ${c.status}`}>{c.status}</span></td>
                  <td><MiniFunnel c={c} /></td>
                  <td className="num">{pct(c.delivered, c.sent)}</td>
                  <td className="num">{pct(c.opened, c.delivered)}</td>
                  <td className="num">{inr(c.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ marginTop: 16 }}>
          <Link to="/campaigns/new"><button className="btn">New campaign</button></Link>
        </div>
      </div>
    </>
  );
}
