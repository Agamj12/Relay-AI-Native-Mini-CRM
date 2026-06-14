import React, { useEffect, useState } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import { api } from './lib/api.js';
import Dashboard from './pages/Dashboard.jsx';
import Audiences from './pages/Audiences.jsx';
import Campaigns from './pages/Campaigns.jsx';
import NewCampaign from './pages/NewCampaign.jsx';
import CampaignDetail from './pages/CampaignDetail.jsx';
import Auth from './pages/Auth.jsx';

export default function App() {
  const [user] = useState({ name: 'Admin', email: 'admin@relay.com' });
  const [loading, setLoading] = useState(true);
  const [aiProvider, setAiProvider] = useState(null);

  useEffect(() => {
    api('/overview')
      .then((o) => {
        if (o) setAiProvider(o.ai_enabled ? o.ai_provider : 'fallback');
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner"></div>
        <div className="loading-text">loading relay...</div>
      </div>
    );
  }

  return (
    <div className="shell">
      <nav className="rail">
        <div className="brand">relay<span className="dot">.</span></div>
        <div className="brand-sub">AI-NATIVE MINI CRM</div>
        <NavLink to="/" end>Dashboard</NavLink>
        <NavLink to="/audiences">Audiences</NavLink>
        <NavLink to="/campaigns">Campaigns</NavLink>
        
        <div className="rail-user-profile">
          <div className="user-avatar">A</div>
          <div className="user-info">
            <div className="user-name">Admin</div>
            <div className="user-email">admin@relay.com</div>
          </div>
        </div>

        <div className="rail-foot">
          demo brand: Brew &amp; Bloom<br />
          {aiProvider === null ? '' : (
            <span className={`ai-pill ${aiProvider !== 'fallback' ? 'on' : ''}`}>
              {aiProvider !== 'fallback' ? `AI · ${aiProvider}` : 'AI · fallback mode'}
            </span>
          )}
        </div>
      </nav>
      <main className="content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/audiences" element={<Audiences />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/campaigns/new" element={<NewCampaign />} />
          <Route path="/campaigns/:id" element={<CampaignDetail />} />
        </Routes>
      </main>
    </div>
  );
}
