import React, { useState, useMemo } from 'react';

/**
 * Company Hierarchy Filter Component
 * Displays companies in a hierarchical structure (Grandparent > Parent > Child)
 * with multi-select checkboxes and search functionality
 */
const CompanyHierarchyFilter = ({ companies, selectedCompanyIds, onSelectionChange }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  // Build hierarchical structure
  const hierarchy = useMemo(() => {
    if (!companies || companies.length === 0) return [];

    // Find top-level companies (CORP type or no parent)
    const topLevel = companies.filter(c => c.type === 'CORP' || !c.parentId);
    
    // Build tree structure
    const buildTree = (parentId) => {
      return companies
        .filter(c => c.parentId === parentId)
        .map(company => ({
          ...company,
          children: buildTree(company.id)
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    };

    return topLevel
      .map(company => ({
        ...company,
        children: buildTree(company.id)
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [companies]);

  // Filter hierarchy based on search
  const filteredHierarchy = useMemo(() => {
    if (!searchQuery.trim()) return hierarchy;

    const searchLower = searchQuery.toLowerCase();
    const filterCompany = (company) => {
      const matches = 
        company.name.toLowerCase().includes(searchLower) ||
        company.referenceNo?.toString().toLowerCase().includes(searchLower) ||
        company.code?.toLowerCase().includes(searchLower);

      const filteredChildren = company.children
        ? company.children.map(filterCompany).filter(c => c !== null)
        : [];

      if (matches || filteredChildren.length > 0) {
        return {
          ...company,
          children: filteredChildren
        };
      }
      return null;
    };

    return hierarchy.map(filterCompany).filter(c => c !== null);
  }, [hierarchy, searchQuery]);

  const handleToggleCompany = (companyId) => {
    const newSelection = selectedCompanyIds.includes(companyId)
      ? selectedCompanyIds.filter(id => id !== companyId)
      : [...selectedCompanyIds, companyId];
    onSelectionChange(newSelection);
  };

  const handleSelectAll = () => {
    const allIds = companies.map(c => c.id);
    onSelectionChange(allIds);
  };

  const handleClearAll = () => {
    onSelectionChange([]);
  };

  const getDisplayName = (company) => {
    const ref = company.referenceNo || company.code || '';
    return `${company.name}${ref ? ` (${ref})` : ''}`;
  };

  const renderCompany = (company, level = 0) => {
    const indent = level * 20;
    const isSelected = selectedCompanyIds.includes(company.id);
    const hasChildren = company.children && company.children.length > 0;

    return (
      <div key={company.id}>
        <div 
          className="d-flex align-items-center py-1 px-2 hover-bg"
          style={{ 
            paddingLeft: `${8 + indent}px`,
            cursor: 'pointer'
          }}
          onClick={() => handleToggleCompany(company.id)}
        >
          <input
            type="checkbox"
            className="form-check-input me-2"
            checked={isSelected}
            onChange={() => handleToggleCompany(company.id)}
            onClick={(e) => e.stopPropagation()}
          />
          <span className="flex-fill">
            {getDisplayName(company)}
            {company.type && (
              <span className="badge bg-secondary-lt ms-2" style={{ fontSize: '0.7rem' }}>
                {company.type}
              </span>
            )}
          </span>
        </div>
        {hasChildren && company.children.map(child => renderCompany(child, level + 1))}
      </div>
    );
  };

  const selectedCount = selectedCompanyIds.length;
  const buttonText = selectedCount === 0 
    ? 'All Companies' 
    : selectedCount === 1
    ? '1 Company'
    : `${selectedCount} Companies`;

  return (
    <div className="dropdown w-auto" style={{ position: 'relative' }}>
      <button
        className="btn btn-outline dropdown-toggle"
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        aria-expanded={isOpen}
      >
        {buttonText}
      </button>
      {isOpen && (
        <>
          <div 
            className="dropdown-menu show"
            style={{ 
              position: 'absolute',
              top: '100%',
              left: 0,
              minWidth: '300px', 
              maxHeight: '400px', 
              overflowY: 'auto',
              padding: '0',
              zIndex: 1050,
              marginTop: '4px'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-2 border-bottom">
              <input
                type="text"
                className="form-control form-control-sm"
                placeholder="Search companies..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                autoFocus
              />
            </div>
            <div className="p-2 border-bottom d-flex gap-2">
              <button
                className="btn btn-sm btn-outline-primary flex-fill"
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelectAll();
                }}
              >
                Select All
              </button>
              <button
                className="btn btn-sm btn-outline-secondary flex-fill"
                onClick={(e) => {
                  e.stopPropagation();
                  handleClearAll();
                }}
              >
                Clear
              </button>
            </div>
            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
              {filteredHierarchy.length === 0 ? (
                <div className="p-3 text-center text-muted">
                  {searchQuery ? 'No companies found' : 'No companies available'}
                </div>
              ) : (
                filteredHierarchy.map(company => renderCompany(company))
              )}
            </div>
          </div>
          <div 
            className="position-fixed top-0 start-0 w-100 h-100"
            style={{ zIndex: 1040 }}
            onClick={() => setIsOpen(false)}
          />
        </>
      )}
    </div>
  );
};

export default CompanyHierarchyFilter;

