import React, { useState } from 'react';
import { api } from '../lib/api.js';

export default function Auth({ onLoginSuccess }) {
  const [isLogin, setIsLogin] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const endpoint = isLogin ? '/auth/login' : '/auth/signup';
    const payload = isLogin ? { email, password } : { name, email, password };

    try {
      const data = await api(endpoint, {
        method: 'POST',
        body: payload,
      });
      localStorage.setItem('crm_token', data.token);
      onLoginSuccess(data.user);
    } catch (err) {
      setError(err.message || 'An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-brand">
          relay<span className="dot">.</span>
        </div>
        <div className="auth-brand-sub">AI-NATIVE MINI CRM</div>
        
        <h2 className="auth-title">{isLogin ? 'Welcome back' : 'Create an account'}</h2>
        <p className="auth-sub">
          {isLogin ? 'Sign in to access your CRM dashboard' : 'Get started with your smart CRM account'}
        </p>

        {error && <div className="error auth-error">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-form stack">
          {!isLogin && (
            <div className="field">
              <label htmlFor="auth-name">Full Name</label>
              <input
                id="auth-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="John Doe"
                required
              />
            </div>
          )}

          <div className="field">
            <label htmlFor="auth-email">Email Address</label>
            <input
              id="auth-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          <button type="submit" className="btn big auth-btn" disabled={loading}>
            {loading ? 'Processing...' : isLogin ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div className="auth-toggle">
          {isLogin ? (
            <>
              New to relay?{' '}
              <button
                type="button"
                className="auth-toggle-link"
                onClick={() => {
                  setIsLogin(false);
                  setError('');
                }}
              >
                Create an account
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                type="button"
                className="auth-toggle-link"
                onClick={() => {
                  setIsLogin(true);
                  setError('');
                }}
              >
                Sign in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
