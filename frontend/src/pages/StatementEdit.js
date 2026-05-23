import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import api from '../services/api';
import toast from '../utils/toast';

const StatementEdit = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statement, setStatement] = useState(null);
  const [form, setForm] = useState({
    periodStart: '',
    periodEnd: '',
    openingBalance: '',
    closingBalance: '',
    totalDebits: '',
    totalCredits: '',
    status: 'draft',
    notes: '',
    editReason: ''
  });

  const returnQueryRef = useRef(null);
  if (returnQueryRef.current === null && typeof window !== 'undefined') {
    const q = new URLSearchParams(window.location.search).get('returnQuery');
    if (q) returnQueryRef.current = decodeURIComponent(q);
  }
  const returnQuery = (() => {
    const fromState = location.state?.returnQuery;
    if (fromState) return fromState;
    if (returnQueryRef.current) return returnQueryRef.current;
    try {
      const fromStorage = sessionStorage.getItem('statementsReturnQuery');
      if (fromStorage) return fromStorage;
    } catch (_) {}
    return 'page=1';
  })();

  useEffect(() => {
    const fetchStatement = async () => {
      try {
        setLoading(true);
        const response = await api.get(`/api/statements/${id}`);
        const data = response.data;
        setStatement(data);
        setForm({
          periodStart: data.periodStart ? new Date(data.periodStart).toISOString().split('T')[0] : '',
          periodEnd: data.periodEnd ? new Date(data.periodEnd).toISOString().split('T')[0] : '',
          openingBalance: data.openingBalance != null ? String(data.openingBalance) : '',
          closingBalance: data.closingBalance != null ? String(data.closingBalance) : '',
          totalDebits: data.totalDebits != null ? String(data.totalDebits) : '',
          totalCredits: data.totalCredits != null ? String(data.totalCredits) : '',
          status: data.status || 'draft',
          notes: data.notes || '',
          editReason: ''
        });
      } catch (error) {
        console.error('Error fetching statement:', error);
        toast.error(`Error loading statement: ${error.response?.data?.message || error.message}`);
        navigate(`/statements?${returnQuery}`);
      } finally {
        setLoading(false);
      }
    };
    fetchStatement();
  }, [id, navigate, returnQuery]);

  const handleSave = async () => {
    if (!form.editReason.trim()) {
      toast.error('Please provide an edit reason');
      return;
    }
    try {
      setSaving(true);
      await api.put(`/api/statements/${id}`, {
        periodStart: form.periodStart || null,
        periodEnd: form.periodEnd || null,
        openingBalance: form.openingBalance === '' ? null : Number(form.openingBalance),
        closingBalance: form.closingBalance === '' ? null : Number(form.closingBalance),
        totalDebits: form.totalDebits === '' ? null : Number(form.totalDebits),
        totalCredits: form.totalCredits === '' ? null : Number(form.totalCredits),
        status: form.status,
        notes: form.notes || null,
        editReason: form.editReason.trim()
      });
      toast.success('Statement updated successfully');
      navigate(`/statements/${id}/view?returnQuery=${encodeURIComponent(returnQuery)}`, { state: { returnQuery } });
    } catch (error) {
      console.error('Error updating statement:', error);
      toast.error(`Error updating statement: ${error.response?.data?.message || error.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <div className="page-body">
          <div className="container-xl">
            <div className="text-center py-5">
              <div className="spinner-border" role="status"><span className="visually-hidden">Loading...</span></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!statement) return null;

  return (
    <div className="page">
      <div className="page-header">
        <div className="container-xl">
          <div className="row g-2 align-items-center">
            <div className="col">
              <h2 className="page-title">Edit Statement {statement.statementNumber || statement.id}</h2>
            </div>
            <div className="col-auto d-flex gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => navigate(`/statements/${id}/view?returnQuery=${encodeURIComponent(returnQuery)}`, { state: { returnQuery } })}
                disabled={saving}
              >
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || !form.editReason.trim()}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="page-body">
        <div className="container-xl">
          <div className="card">
            <div className="card-body">
              <div className="row g-3">
                <div className="col-md-6">
                  <label className="form-label">Period Start</label>
                  <input type="date" className="form-control" value={form.periodStart} onChange={(e) => setForm((p) => ({ ...p, periodStart: e.target.value }))} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Period End</label>
                  <input type="date" className="form-control" value={form.periodEnd} onChange={(e) => setForm((p) => ({ ...p, periodEnd: e.target.value }))} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Opening Balance</label>
                  <input type="number" step="0.01" className="form-control" value={form.openingBalance} onChange={(e) => setForm((p) => ({ ...p, openingBalance: e.target.value }))} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Closing Balance</label>
                  <input type="number" step="0.01" className="form-control" value={form.closingBalance} onChange={(e) => setForm((p) => ({ ...p, closingBalance: e.target.value }))} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Total Debits</label>
                  <input type="number" step="0.01" className="form-control" value={form.totalDebits} onChange={(e) => setForm((p) => ({ ...p, totalDebits: e.target.value }))} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Total Credits</label>
                  <input type="number" step="0.01" className="form-control" value={form.totalCredits} onChange={(e) => setForm((p) => ({ ...p, totalCredits: e.target.value }))} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Status</label>
                  <select className="form-select" value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}>
                    <option value="draft">Draft</option>
                    <option value="sent">Sent</option>
                    <option value="acknowledged">Acknowledged</option>
                    <option value="disputed">Disputed</option>
                  </select>
                </div>
                <div className="col-12">
                  <label className="form-label">Notes</label>
                  <textarea className="form-control" rows="3" value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
                </div>
                <div className="col-12">
                  <label className="form-label required">Edit Reason</label>
                  <textarea
                    className="form-control"
                    rows="2"
                    placeholder="Why are you editing this statement? (required for audit trail)"
                    value={form.editReason}
                    onChange={(e) => setForm((p) => ({ ...p, editReason: e.target.value }))}
                    required
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StatementEdit;

