import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, inr, pct } from '../lib/api.js';

export default function Campaigns() {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    const load = () => api('/campaigns').then(setRows).catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Campaigns</h1>
          <p className="page-sub">Every send, and what came back.</p>
        </div>
        <Link to="/campaigns/new"><button className="btn">New campaign</button></Link>
      </div>

      <div className="card">
        {!rows ? <p className="empty">Loading…</p> : rows.length === 0 ? (
          <p className="empty">No campaigns yet. Create one to see the full send → receipt loop in action.</p>
        ) : (
          <table>
            <thead><tr><th>Campaign</th><th>Audience</th><th>Channel</th><th>Status</th><th className="num">Sent</th><th className="num">Delivered</th><th className="num">Opened</th><th className="num">Clicked</th><th className="num">Revenue</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td><Link to={`/campaigns/${c.id}`} style={{ fontWeight: 600 }}>{c.name}</Link></td>
                  <td className="muted">{c.segment_name}</td>
                  <td className="mono">{c.channel}</td>
                  <td><span className={`status ${c.status}`}>{c.status}</span></td>
                  <td className="num">{c.sent}</td>
                  <td className="num">{c.delivered} <span className="muted">({pct(c.delivered, c.sent)})</span></td>
                  <td className="num">{c.opened}</td>
                  <td className="num">{c.clicked}</td>
                  <td className="num">{inr(c.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
