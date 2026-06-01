import React, { useEffect, useMemo, useState } from 'react';

const UserMultiSelectFilter = ({
  users = [],
  selectedUserIds = [],
  onSelectionChange,
  onClose,
  onApply
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [tempSelectedIds, setTempSelectedIds] = useState(new Set(selectedUserIds.map(id => String(id))));

  useEffect(() => {
    setTempSelectedIds(new Set(selectedUserIds.map(id => String(id))));
  }, [selectedUserIds]);

  const normalizedUsers = useMemo(
    () => users.map(u => ({ ...u, id: String(u.id) })),
    [users]
  );

  const filteredUsers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return normalizedUsers;

    return normalizedUsers.filter(user => {
      const name = String(user.name || '').toLowerCase();
      const email = String(user.email || '').toLowerCase();
      return name.includes(query) || email.includes(query);
    });
  }, [normalizedUsers, searchQuery]);

  const selectedUsers = useMemo(() => {
    const selected = [];
    tempSelectedIds.forEach((id) => {
      const user = normalizedUsers.find(u => u.id === id);
      if (user) {
        selected.push(user);
      } else {
        selected.push({ id, name: `User ${id}`, email: '' });
      }
    });
    return selected;
  }, [tempSelectedIds, normalizedUsers]);

  const toggleUser = (userId) => {
    const id = String(userId);
    setTempSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleApply = () => {
    onSelectionChange(Array.from(tempSelectedIds));
    if (onApply) onApply();
  };

  const selectAllVisible = () => {
    setTempSelectedIds(prev => {
      const next = new Set(prev);
      filteredUsers.forEach(user => next.add(user.id));
      return next;
    });
  };

  const clearAll = () => {
    setTempSelectedIds(new Set());
    setSearchQuery('');
  };

  return (
    <>
      <div className="modal-backdrop fade show" style={{ zIndex: 1050 }}></div>
      <div className="modal modal-blur fade show" style={{ display: 'block', zIndex: 1055 }} tabIndex="-1">
        <div className="modal-dialog modal-dialog-centered modal-lg">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">Filter by User</h5>
              <button type="button" className="btn-close" onClick={onClose}></button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleApply();
              }}
            >
              <div className="modal-body">
                <div className="mb-3">
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Search users by name or email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    autoComplete="off"
                  />
                </div>

                <div className="mb-3 d-flex gap-2 flex-wrap">
                  <button type="button" className="btn btn-sm btn-outline-primary" onClick={selectAllVisible}>
                    Select Visible
                  </button>
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={clearAll}>
                    Clear All
                  </button>
                </div>

                {selectedUsers.length > 0 && selectedUsers.length <= 12 && (
                  <div className="mb-3 d-flex flex-wrap gap-1">
                    {selectedUsers.map((user) => (
                      <span key={user.id} className="badge bg-primary-lt d-inline-flex align-items-center gap-1">
                        {user.name || user.email || user.id}
                        {user.email ? <small className="text-muted">{user.email}</small> : null}
                        <button
                          type="button"
                          className="btn-close ms-1"
                          style={{ fontSize: '0.5rem' }}
                          onClick={() => toggleUser(user.id)}
                          aria-label="Remove"
                        ></button>
                      </span>
                    ))}
                  </div>
                )}

                {selectedUsers.length > 12 && (
                  <div className="mb-3">
                    <span className="badge bg-primary-lt">{selectedUsers.length} users selected</span>
                  </div>
                )}

                <div style={{ maxHeight: '420px', overflowY: 'auto', border: '1px solid var(--tblr-border-color)', borderRadius: '4px' }}>
                  {filteredUsers.length === 0 ? (
                    <div className="text-muted text-center py-4">No users match your search</div>
                  ) : (
                    filteredUsers.map((user) => (
                      <label key={user.id} className="d-flex align-items-center py-2 px-2 border-bottom" style={{ cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          className="form-check-input me-2"
                          checked={tempSelectedIds.has(user.id)}
                          onChange={() => toggleUser(user.id)}
                        />
                        <div className="flex-grow-1">
                          <div className="fw-semibold">{user.name || user.email || 'Unnamed User'}</div>
                          {user.email ? <small className="text-muted">{user.email}</small> : null}
                        </div>
                        {user.role ? (
                          <span className="badge bg-secondary-lt">{String(user.role).replace(/_/g, ' ').toUpperCase()}</span>
                        ) : null}
                      </label>
                    ))
                  )}
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={onClose}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Apply Filter ({tempSelectedIds.size} selected)
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
};

export default UserMultiSelectFilter;
