import React, { useState, useEffect } from 'react';
import api from '../services/api';
import toast from '../utils/toast';
import { getAvailableFields, getColumnConfiguration, updateColumnConfiguration } from '../utils/fieldDiscovery';

const ColumnCustomizer = ({ pageType, onClose, onSave }) => {
  const [availableFields, setAvailableFields] = useState([]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draggedField, setDraggedField] = useState(null);

  useEffect(() => {
    loadData();
  }, [pageType]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [fields, columnConfig] = await Promise.all([
        getAvailableFields(pageType),
        getColumnConfiguration(pageType)
      ]);
      
      setAvailableFields(fields);
      setConfig(columnConfig);
    } catch (error) {
      console.error('Error loading column customization data:', error);
      toast.error('Failed to load column configuration');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleColumn = (fieldName) => {
    if (!config) return;

    const isVisible = config.visibleColumns.includes(fieldName);
    let newVisibleColumns;
    let newColumnOrder;

    if (isVisible) {
      // Remove from visible columns and order
      newVisibleColumns = config.visibleColumns.filter(f => f !== fieldName);
      newColumnOrder = config.columnOrder.filter(f => f !== fieldName);
    } else {
      // Add to visible columns and order (at the end)
      newVisibleColumns = [...config.visibleColumns, fieldName];
      newColumnOrder = [...config.columnOrder, fieldName];
    }

    setConfig({
      ...config,
      visibleColumns: newVisibleColumns,
      columnOrder: newColumnOrder
    });
  };

  const handleDragStart = (e, fieldName) => {
    setDraggedField(fieldName);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e, targetFieldName) => {
    e.preventDefault();
    if (!draggedField || draggedField === targetFieldName || !config) return;

    const order = [...config.columnOrder];
    const draggedIndex = order.indexOf(draggedField);
    const targetIndex = order.indexOf(targetFieldName);

    if (draggedIndex === -1 || targetIndex === -1) return;

    // Remove dragged field
    order.splice(draggedIndex, 1);
    // Insert at target position
    order.splice(targetIndex, 0, draggedField);

    setConfig({
      ...config,
      columnOrder: order
    });
    setDraggedField(null);
  };

  const handleSave = async () => {
    if (!config) return;

    try {
      setSaving(true);
      await updateColumnConfiguration(pageType, {
        visibleColumns: config.visibleColumns,
        columnOrder: config.columnOrder,
        columnWidths: config.columnWidths || {}
      });
      toast.success('Column configuration saved successfully');
      if (onSave) onSave();
      if (onClose) onClose();
    } catch (error) {
      console.error('Error saving column configuration:', error);
      toast.error('Failed to save column configuration: ' + (error.response?.data?.message || error.message));
    } finally {
      setSaving(false);
    }
  };

  const getVisibleFields = () => {
    if (!config) return [];
    return config.columnOrder
      .map(fieldName => availableFields.find(f => f.fieldName === fieldName))
      .filter(Boolean);
  };

  const getHiddenFields = () => {
    if (!config) return [];
    return availableFields.filter(f => !config.visibleColumns.includes(f.fieldName));
  };

  if (loading) {
    return (
      <div className="modal modal-blur fade show" style={{ display: 'block' }} tabIndex="-1">
        <div className="modal-dialog modal-dialog-centered modal-lg">
          <div className="modal-content">
            <div className="modal-body text-center py-4">
              <div className="spinner-border" role="status">
                <span className="visually-hidden">Loading...</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const visibleFields = getVisibleFields();
  const hiddenFields = getHiddenFields();

  return (
    <div className="modal modal-blur fade show" style={{ display: 'block' }} tabIndex="-1">
      <div className="modal-dialog modal-dialog-centered modal-lg">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Customise Columns</h5>
            <button type="button" className="btn-close" onClick={onClose}></button>
          </div>
          <div className="modal-body">
            <p className="text-muted mb-3">
              Select which columns to display and drag to reorder them.
            </p>

            {/* Visible Columns */}
            <div className="mb-4">
              <h6 className="mb-2">Visible Columns (drag to reorder)</h6>
              <div className="list-group">
                {visibleFields.length === 0 ? (
                  <div className="list-group-item text-muted text-center">
                    No columns selected
                  </div>
                ) : (
                  visibleFields.map((field, index) => (
                    <div
                      key={field.fieldName}
                      className="list-group-item d-flex align-items-center"
                      draggable
                      onDragStart={(e) => handleDragStart(e, field.fieldName)}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, field.fieldName)}
                      style={{ cursor: 'move' }}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="icon me-2"
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        strokeWidth="2"
                        stroke="currentColor"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                        <path d="M10 4l-6 6l6 6" />
                        <path d="M14 4l6 6l-6 6" />
                      </svg>
                      <div className="form-check form-check-inline ms-2 flex-grow-1">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          checked={true}
                          onChange={() => handleToggleColumn(field.fieldName)}
                        />
                        <label className="form-check-label">
                          {field.displayName}
                          {field.isCustom && (
                            <span className="badge bg-info-lt ms-2">Custom</span>
                          )}
                        </label>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Hidden Columns */}
            {hiddenFields.length > 0 && (
              <div>
                <h6 className="mb-2">Hidden Columns</h6>
                <div className="list-group">
                  {hiddenFields.map(field => (
                    <div
                      key={field.fieldName}
                      className="list-group-item d-flex align-items-center"
                    >
                      <div className="form-check form-check-inline flex-grow-1">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          checked={false}
                          onChange={() => handleToggleColumn(field.fieldName)}
                        />
                        <label className="form-check-label">
                          {field.displayName}
                          {field.isCustom && (
                            <span className="badge bg-info-lt ms-2">Custom</span>
                          )}
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                  Saving...
                </>
              ) : (
                'Save'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ColumnCustomizer;

