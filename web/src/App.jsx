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
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aiProvider, setAiProvider] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('crm_token');
    if (token) {
      api('/auth/me')
        .then((res) => {
          setUser(res.user);
          // Fetch overview since user is now verified
          return api('/overview');
        })
        .then((o) => {
          if (o) setAiProvider(o.ai_enabled ? o.ai_provider : 'fallback');
        })
        .catch(() => {
          localStorage.removeItem('crm_token');
          setUser(null);
        })
        .finally(() => {
          setLoading(false);
        });
    } else {
      setLoading(false);
    }
  }, []);

  // Listen for unauthorized 401 events globally to boot the user back to login page
  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null);
    };
    window.addEventListener('unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('unauthorized', handleUnauthorized);
    };
  }, []);

  // Fetch overview after login if it hasn't been fetched yet
  useEffect(() => {
    if (user && aiProvider === null) {
      api('/overview')
        .then((o) => setAiProvider(o.ai_enabled ? o.ai_provider : 'fallback'))
        .catch(() => {});
    }
  }, [user, aiProvider]);

  const handleLogout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch (e) {
      // ignore, clean local session anyway
    } finally {
      localStorage.removeItem('crm_token');
      setUser(null);
      setAiProvider(null);
    }
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner"></div>
        <div className="loading-text">loading relay...</div>
      </div>
    );
  }

  if (!user) {
    return <Auth onLoginSuccess={setUser} />;
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
          <div className="user-avatar">
            {user.name ? user.name.charAt(0).toUpperCase() : 'U'}
          </div>
          <div className="user-info">
            <div className="user-name">{user.name}</div>
            <div className="user-email">{user.email}</div>
          </div>
          <button onClick={handleLogout} className="btn-logout" title="Log out">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
          </button>
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
