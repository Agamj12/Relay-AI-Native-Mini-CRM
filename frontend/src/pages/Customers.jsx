import React, { useEffect, useState } from 'react';
import { api, inr } from '../lib/api.js';

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [file, setFile] = useState(null);

  const fetchCustomers = () => {
    api('/customers?limit=200')
      .then((data) => {
        setCustomers(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Failed to fetch customers');
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchCustomers();
  }, []);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      if (selectedFile.type !== 'text/csv' && !selectedFile.name.endsWith('.csv')) {
        setError('Please select a valid CSV file.');
        setFile(null);
        return;
      }
      setFile(selectedFile);
      setError(null);
      setSuccess(null);
    }
  };

  const parseCSV = (text) => {
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length < 2) {
      throw new Error('CSV file must contain a header row and at least one customer row.');
    }

    // Parse headers helper (handles quotes if present)
    const splitCSVRow = (row) => {
      const result = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < row.length; i++) {
        const char = row[i];
        if (char === '"' || char === "'") {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    };

    const headers = splitCSVRow(lines[0]).map(h => h.toLowerCase().replace(/[\s_-]/g, ''));
    
    // Find column indexes
    const idxFirstName = headers.findIndex(h => h === 'firstname' || h === 'first' || h === 'name');
    const idxLastName = headers.findIndex(h => h === 'lastname' || h === 'last');
    const idxEmail = headers.findIndex(h => h === 'email' || h === 'emailaddress');
    const idxPhone = headers.findIndex(h => h === 'phone' || h === 'phonenumber' || h === 'mobile');
    const idxCity = headers.findIndex(h => h === 'city');
    const idxConsentEmail = headers.findIndex(h => h === 'consentemail' || h === 'emailconsent');
    const idxConsentSms = headers.findIndex(h => h === 'consentsms' || h === 'smsconsent');
    const idxConsentWhatsapp = headers.findIndex(h => h === 'consentwhatsapp' || h === 'whatsappconsent');

    if (idxFirstName === -1 || idxEmail === -1) {
      throw new Error('CSV must contain at least "first_name" (or "name") and "email" columns.');
    }

    const customersList = [];

    for (let i = 1; i < lines.length; i++) {
      const row = splitCSVRow(lines[i]);
      if (row.length < headers.length) continue; // skip incomplete rows

      const email = row[idxEmail];
      const firstName = row[idxFirstName];

      if (!firstName || !email || !email.includes('@')) {
        continue; // skip rows missing required fields or having invalid emails
      }

      // Helper to parse consent boolean values
      const parseConsent = (val) => {
        if (val === undefined || val === '') return 1; // default to opted-in
        const lower = val.toLowerCase();
        if (lower === 'no' || lower === 'false' || lower === '0' || lower === 'optout') return 0;
        return 1;
      };

      customersList.push({
        first_name: firstName,
        last_name: idxLastName !== -1 ? row[idxLastName] : '',
        email: email,
        phone: idxPhone !== -1 ? row[idxPhone] : '',
        city: idxCity !== -1 ? row[idxCity] : '',
        consent_email: idxConsentEmail !== -1 ? parseConsent(row[idxConsentEmail]) : 1,
        consent_sms: idxConsentSms !== -1 ? parseConsent(row[idxConsentSms]) : 1,
        consent_whatsapp: idxConsentWhatsapp !== -1 ? parseConsent(row[idxConsentWhatsapp]) : 1,
      });
    }

    if (customersList.length === 0) {
      throw new Error('No valid customer rows could be parsed from the CSV file.');
    }

    return customersList;
  };

  const handleUpload = () => {
    if (!file) return;

    setUploading(true);
    setError(null);
    setSuccess(null);

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target.result;
        const parsedCustomers = parseCSV(text);

        const response = await api('/ingest', {
          method: 'POST',
          body: { customers: parsedCustomers },
        });

        setSuccess(`Successfully uploaded ${response.ingested_customers} customers!`);
        setFile(null);
        
        // Reset file input element
        const fileInput = document.getElementById('csv-file-input');
        if (fileInput) fileInput.value = '';

        // Reload customer list
        fetchCustomers();
      } catch (err) {
        setError(err.message || 'Error processing CSV file.');
        setUploading(false);
      }
    };

    reader.onerror = () => {
      setError('Failed to read CSV file.');
      setUploading(false);
    };

    reader.readAsText(file);
  };

  const filteredCustomers = customers.filter(c => {
    const term = search.toLowerCase();
    const fullName = `${c.first_name} ${c.last_name}`.toLowerCase();
    return (
      fullName.includes(term) ||
      c.email.toLowerCase().includes(term) ||
      c.city.toLowerCase().includes(term)
    );
  });

  return (
    <>
      <h1 className="page-title">Customers</h1>
      <p className="page-sub">Manage your customer database and upload bulk lists.</p>

      <div className="grid-2-col" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '24px', alignItems: 'start' }}>
        
        {/* CSV Import Card */}
        <div className="card" style={{ position: 'sticky', top: '24px' }}>
          <h3>Import Dataset</h3>
          <p className="hint" style={{ margin: '8px 0 16px 0' }}>
            Upload a CSV file with your shopper data. Required columns: <code>first_name</code>, <code>email</code>.
          </p>

          <div className="field" style={{ marginBottom: '16px' }}>
            <label htmlFor="csv-file-input" className="file-upload-label" style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              border: '2px dashed var(--border)',
              borderRadius: '8px',
              padding: '24px',
              cursor: 'pointer',
              background: 'var(--card-bg)',
              textAlign: 'center',
              transition: 'border-color 0.2s ease-in-out'
            }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--persimmon)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '8px' }}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
              <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--pine-ink)' }}>
                {file ? file.name : 'Choose CSV file'}
              </span>
              <span className="hint" style={{ marginTop: '4px', fontSize: '12px' }}>
                {file ? `${(file.size / 1024).toFixed(1)} KB` : 'or drag and drop here'}
              </span>
            </label>
            <input
              id="csv-file-input"
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
          </div>

          <button
            className="btn big"
            style={{ width: '100%' }}
            onClick={handleUpload}
            disabled={!file || uploading}
          >
            {uploading ? 'Importing...' : 'Upload & Ingest'}
          </button>

          {error && <div className="error" style={{ marginTop: '16px' }}>{error}</div>}
          {success && <div className="chip" style={{ marginTop: '16px', display: 'block', backgroundColor: '#eef8ee', color: '#2e7d32', borderColor: '#c8e6c9' }}>{success}</div>}
        </div>

        {/* Customers Table Card */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3>Shoppers ({filteredCustomers.length})</h3>
            <input
              type="text"
              placeholder="Search by name, email or city..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: '220px', padding: '6px 12px', fontSize: '13px' }}
            />
          </div>

          {loading ? (
            <div className="empty">Loading shoppers...</div>
          ) : filteredCustomers.length === 0 ? (
            <div className="empty">No shoppers found.</div>
          ) : (
            <div style={{ maxHeight: '650px', overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Shopper</th>
                    <th>Location</th>
                    <th className="num">Spend</th>
                    <th className="num">Orders</th>
                    <th>Consent</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCustomers.map((c) => (
                    <tr key={c.id || c.email}>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--pine-ink)' }}>
                          {c.first_name} {c.last_name}
                        </div>
                        <div className="mono muted" style={{ fontSize: '11px' }}>{c.email}</div>
                        {c.phone && <div className="mono muted" style={{ fontSize: '11px' }}>{c.phone}</div>}
                      </td>
                      <td>
                        <div>{c.city || '—'}</div>
                      </td>
                      <td className="num">
                        {inr(c.total_spend || 0)}
                      </td>
                      <td className="num">
                        {c.order_count || 0}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                          <span className={`ai-pill ${c.consent_email === 1 ? 'on' : ''}`} style={{ fontSize: '10px', padding: '2px 6px' }}>Email</span>
                          <span className={`ai-pill ${c.consent_sms === 1 ? 'on' : ''}`} style={{ fontSize: '10px', padding: '2px 6px' }}>SMS</span>
                          <span className={`ai-pill ${c.consent_whatsapp === 1 ? 'on' : ''}`} style={{ fontSize: '10px', padding: '2px 6px' }}>WA</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </>
  );
}
