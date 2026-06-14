import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, inr, pct } from '../lib/api.js';

export default function Analytics() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // Table search and filter state
  const [search, setSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState('ALL');
  
  // Donut chart type state
  const [donutType, setDonutType] = useState('STATUS'); // 'STATUS' or 'CHANNEL'

  // Tooltip state
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, title: '', label: '', value: '', color: '' });

  useEffect(() => {
    api('/analytics')
      .then((res) => {
        setData(res);
        setLoading(false);
      })
      .catch((e) => {
        setErr(e.message);
        setLoading(false);
      });
  }, []);

  const showTooltip = (e, title, label, value, color) => {
    const card = e.target.closest('.card.dark-analytics');
    if (!card) return;
    const cardRect = card.getBoundingClientRect();
    const targetRect = e.target.getBoundingClientRect();
    
    // Position tooltip relative to the dark-analytics card container
    const x = targetRect.left - cardRect.left + targetRect.width / 2;
    const y = targetRect.top - cardRect.top;
    
    setTooltip({
      visible: true,
      x,
      y,
      title,
      label,
      value: typeof value === 'number' && label.includes('Revenue') ? inr(value) : value.toLocaleString(),
      color
    });
  };

  const moveTooltip = (e) => {
    // Left empty since we center it on the element
  };

  const hideTooltip = () => {
    setTooltip((prev) => ({ ...prev, visible: false }));
  };

  if (loading) return <div className="empty">Loading analytics…</div>;
  if (err) return <div className="error">{err}</div>;
  if (!data) return <div className="empty">No data returned.</div>;

  const { summary, dailyActivity, channelBreakdown, campaignStatusBreakdown, campaigns } = data;

  // Filter campaigns list
  const filteredCampaigns = campaigns.filter((c) => {
    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase()) || 
                          c.segment_name.toLowerCase().includes(search.toLowerCase());
    const matchesChannel = channelFilter === 'ALL' || c.channel === channelFilter;
    return matchesSearch && matchesChannel;
  });

  // Calculate standard conversion rate
  const overallConversionRate = pct(summary.totalConverted, summary.totalSent);

  // Donut Segment Config
  let donutTitle = 'Campaigns';
  let donutTotal = summary.totalCampaigns;
  let donutSegments = [];

  if (donutType === 'STATUS') {
    donutTitle = 'Campaigns';
    donutTotal = summary.totalCampaigns;
    donutSegments = [
      { label: 'Draft', value: campaignStatusBreakdown.DRAFT || 0, color: '#64748b' },
      { label: 'Sending', value: campaignStatusBreakdown.SENDING || 0, color: '#e89b1c' },
      { label: 'Active', value: campaignStatusBreakdown.ACTIVE || 0, color: '#3b82f6' },
      { label: 'Done', value: campaignStatusBreakdown.DONE || 0, color: '#10b981' }
    ];
  } else {
    // Channel breakdown
    donutTitle = 'Revenue';
    donutTotal = summary.totalRevenue;
    donutSegments = [
      { label: 'Email', value: channelBreakdown.EMAIL?.revenue || 0, color: '#3e7bd6' },
      { label: 'SMS', value: channelBreakdown.SMS?.revenue || 0, color: '#8a5bd6' },
      { label: 'WhatsApp', value: channelBreakdown.WHATSAPP?.revenue || 0, color: '#2c8c6b' }
    ];
  }

  // Bar chart mathematics
  const maxVal = Math.max(...dailyActivity.map((d) => Math.max(d.sent, d.converted)), 1);
  const roundedMax = Math.ceil(maxVal * 1.15 / 5) * 5 || 5;

  const gridTicks = [0, roundedMax * 0.25, roundedMax * 0.5, roundedMax * 0.75, roundedMax];
  const chartHeight = 130;
  const plotYEnd = 160;
  const plotXStart = 40;
  const plotXEnd = 430;

  // Donut chart math
  const radius = 50;
  const C = 2 * Math.PI * radius; // ~314.16
  let accumulatedVal = 0;
  
  const slices = donutSegments.map((s) => {
    if (s.value === 0 || donutTotal === 0) return null;
    const fraction = s.value / donutTotal;
    const dashArray = `${fraction * C} ${C}`;
    const dashOffset = -((accumulatedVal / donutTotal) * C);
    accumulatedVal += s.value;
    return {
      ...s,
      dashArray,
      dashOffset,
      percentage: Math.round(fraction * 100) + '%'
    };
  }).filter(Boolean);

  return (
    <>
      <h1 className="page-title">Campaign Analytics</h1>
      <p className="page-sub">Performance dashboards and channel metrics across Brew &amp; Bloom.</p>

      {/* KPI Cards Grid */}
      <div className="kpis">
        <div className="kpi">
          <div className="label">Total Campaigns</div>
          <div className="value">{summary.totalCampaigns}</div>
        </div>
        <div className="kpi">
          <div className="label">Messages Sent</div>
          <div className="value">{summary.totalSent.toLocaleString()}</div>
        </div>
        <div className="kpi">
          <div className="label">Overall Conv. Rate</div>
          <div className="value">{overallConversionRate}</div>
        </div>
        <div className="kpi signal">
          <div className="label">Attributed Revenue</div>
          <div className="value">{inr(summary.totalRevenue)}</div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="charts-row">
        {/* Left Chart: Sent vs Converted over 7 days */}
        <div className="card dark-analytics">
          <div className="dark-card-header">
            <div className="dark-card-title-group">
              <span className="dark-card-subtitle">Last 7 Days</span>
              <h3>Sends vs. Conversions</h3>
            </div>
            <div style={{ display: 'flex', gap: 12, fontSize: 11, fontFamily: 'var(--mono)', color: '#94a3b8' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, background: '#3b82f6', borderRadius: '50%' }}></span> Sent
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, background: '#10b981', borderRadius: '50%' }}></span> Converted
              </div>
            </div>
          </div>

          <div style={{ position: 'relative', height: 185 }}>
            <svg viewBox="0 0 450 185" className="chart-svg">
              <defs>
                <linearGradient id="blueGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" />
                  <stop offset="100%" stopColor="#1d4ed8" />
                </linearGradient>
                <linearGradient id="greenGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" />
                  <stop offset="100%" stopColor="#047857" />
                </linearGradient>
              </defs>

              {/* Grid Lines & Y Labels */}
              {gridTicks.map((tick, idx) => {
                const y = plotYEnd - (tick / roundedMax) * chartHeight;
                return (
                  <g key={idx}>
                    <line x1={plotXStart} y1={y} x2={plotXEnd} y2={y} className="chart-grid-line" />
                    <text x={plotXStart - 8} y={y + 3.5} className="chart-text y-label">{Math.round(tick)}</text>
                  </g>
                );
              })}

              {/* Bottom X-axis border */}
              <line x1={plotXStart} y1={plotYEnd} x2={plotXEnd} y2={plotYEnd} className="chart-axis-line" />

              {/* Daily Activity Bars */}
              {dailyActivity.map((day, idx) => {
                const xGroup = plotXStart + 22 + idx * 53;
                const sentH = (day.sent / roundedMax) * chartHeight;
                const convH = (day.converted / roundedMax) * chartHeight;
                
                const sentY = plotYEnd - sentH;
                const convY = plotYEnd - convH;

                return (
                  <g key={day.date}>
                    {/* Sent Bar */}
                    <rect
                      x={xGroup}
                      y={sentY}
                      width={15}
                      height={Math.max(sentH, 2)}
                      rx={3}
                      ry={3}
                      className="chart-bar-sent"
                      onMouseEnter={(e) => showTooltip(e, day.label, 'Sent Messages', day.sent, '#3b82f6')}
                      onMouseMove={moveTooltip}
                      onMouseLeave={hideTooltip}
                    />

                    {/* Converted Bar */}
                    <rect
                      x={xGroup + 18}
                      y={convY}
                      width={15}
                      height={Math.max(convH, 2)}
                      rx={3}
                      ry={3}
                      className="chart-bar-converted"
                      onMouseEnter={(e) => showTooltip(e, day.label, 'Conversions', day.converted, '#10b981')}
                      onMouseMove={moveTooltip}
                      onMouseLeave={hideTooltip}
                    />

                    {/* Day Label */}
                    <text x={xGroup + 16.5} y={plotYEnd + 16} className="chart-text x-label">{day.label}</text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* Right Chart: Status breakdown or Channel distribution */}
        <div className="card dark-analytics">
          <div className="dark-card-header">
            <div className="dark-card-title-group">
              <span className="dark-card-subtitle">Overview Breakdown</span>
              <h3>{donutType === 'STATUS' ? 'Campaign Statuses' : 'Revenue by Channel'}</h3>
            </div>
            <select
              className="dark-card-selector"
              value={donutType}
              onChange={(e) => setDonutType(e.target.value)}
            >
              <option value="STATUS">By Status</option>
              <option value="CHANNEL">By Revenue</option>
            </select>
          </div>

          <div className="donut-container">
            <div className="donut-svg-wrapper">
              <svg width="150" height="150" viewBox="0 0 150 150">
                <circle cx="75" cy="75" r="50" fill="transparent" stroke="rgba(255,255,255,0.05)" strokeWidth="11" />
                {donutTotal === 0 ? (
                  <circle cx="75" cy="75" r="50" fill="transparent" stroke="#334155" strokeWidth="11" />
                ) : (
                  slices.map((slice, idx) => (
                    <circle
                      key={idx}
                      cx="75"
                      cy="75"
                      r="50"
                      className="donut-segment"
                      stroke={slice.color}
                      strokeWidth="11"
                      strokeDasharray={slice.dashArray}
                      strokeDashoffset={slice.dashOffset}
                      transform="rotate(-90 75 75)"
                      onMouseEnter={(e) => showTooltip(e, slice.label, donutType === 'STATUS' ? 'Campaigns' : 'Revenue', slice.value, slice.color)}
                      onMouseMove={moveTooltip}
                      onMouseLeave={hideTooltip}
                    />
                  ))
                )}
              </svg>
              <div className="donut-center-text">
                <div className="donut-center-val">
                  {donutType === 'STATUS' ? donutTotal : inr(donutTotal)}
                </div>
                <div className="donut-center-lbl">{donutTitle}</div>
              </div>
            </div>

            <div className="donut-legend">
              {donutSegments.map((seg, idx) => {
                const fraction = donutTotal > 0 ? seg.value / donutTotal : 0;
                const percentage = Math.round(fraction * 100) + '%';
                return (
                  <div className="donut-legend-item" key={idx}>
                    <div className="donut-legend-left">
                      <span className="donut-dot" style={{ background: seg.color }}></span>
                      <span>{seg.label}</span>
                    </div>
                    <span className="donut-legend-val">
                      {donutType === 'STATUS' ? `${seg.value} (${percentage})` : inr(seg.value)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Floating tooltip */}
      <div
        className={`chart-tooltip ${tooltip.visible ? 'visible' : ''}`}
        style={{ left: tooltip.x, top: tooltip.y }}
      >
        <div className="chart-tooltip-title" style={{ color: tooltip.color }}>
          {tooltip.title}
        </div>
        <div className="chart-tooltip-row">
          <span>{tooltip.label}:</span>
          <span>{tooltip.value}</span>
        </div>
      </div>

      {/* Detailed Table Section */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <h3>Campaigns Breakdown</h3>
          <div className="filter-bar">
            <div>
              <span className="filter-label">Search</span>
              <input
                type="text"
                placeholder="Search campaigns..."
                className="search-input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div>
              <span className="filter-label">Channel</span>
              <select
                className="select-input"
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value)}
              >
                <option value="ALL">All Channels</option>
                <option value="EMAIL">Email</option>
                <option value="SMS">SMS</option>
                <option value="WHATSAPP">WhatsApp</option>
              </select>
            </div>
          </div>
        </div>

        {filteredCampaigns.length === 0 ? (
          <p className="empty">No campaigns match your filters.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Audience</th>
                <th>Channel</th>
                <th>Status</th>
                <th className="num">Sent</th>
                <th className="num">Delivered</th>
                <th className="num">Opened</th>
                <th className="num">Clicked</th>
                <th className="num">Conv. Rate</th>
                <th className="num">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {filteredCampaigns.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/campaigns/${c.id}`} style={{ fontWeight: 600 }}>{c.name}</Link>
                  </td>
                  <td className="muted">{c.segment_name}</td>
                  <td className="mono">{c.channel}</td>
                  <td>
                    <span className={`status ${c.status}`}>{c.status}</span>
                  </td>
                  <td className="num">{c.sent}</td>
                  <td className="num">{c.delivered} <span className="muted">({pct(c.delivered, c.sent)})</span></td>
                  <td className="num">{c.opened} <span className="muted">({pct(c.opened, c.delivered)})</span></td>
                  <td className="num">{c.clicked} <span className="muted">({pct(c.clicked, c.opened)})</span></td>
                  <td className="num">{pct(c.converted, c.sent)}</td>
                  <td className="num" style={{ fontWeight: c.revenue > 0 ? 600 : 'normal' }}>{inr(c.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
