import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import api from '../services/api';

/**
 * Hierarchical Company Filter Component
 * Displays companies in a tree structure with expand/collapse and cascade selection
 */
const HierarchicalCompanyFilter = ({ 
  selectedCompanyIds = [], 
  onSelectionChange,
  onClose,
  onApply
}) => {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState(new Set());
  // Convert all IDs to strings for consistent comparison
  const [tempSelectedIds, setTempSelectedIds] = useState(new Set(selectedCompanyIds.map(id => String(id))));
  const searchInputRef = useRef(null);
  const [initialFetchDone, setInitialFetchDone] = useState(false);

  // Sync tempSelectedIds with prop when modal opens/reopens
  useEffect(() => {
    setTempSelectedIds(new Set(selectedCompanyIds.map(id => String(id))));
  }, [selectedCompanyIds]);

  // Fetch hierarchical company data
  const fetchHierarchy = useCallback(async (search = '') => {
    try {
      setLoading(true);
      const params = search ? { search } : {};
      const response = await api.get('/api/companies/hierarchy', { params });
      const companiesData = response.data.companies || [];
      setCompanies(companiesData);
      
      // Auto-expand all when searching, otherwise start collapsed
      if (search) {
        const allIds = new Set();
        const collectIds = (nodes) => {
          nodes.forEach(node => {
            if (node.children && node.children.length > 0) {
              allIds.add(String(node.id));
              collectIds(node.children);
            }
          });
        };
        collectIds(companiesData);
        setExpandedIds(allIds);
      } else if (!initialFetchDone) {
        // Start with all collapsed by default
        setExpandedIds(new Set());
        setInitialFetchDone(true);
      }
    } catch (error) {
      console.error('Error fetching company hierarchy:', error);
      setCompanies([]);
    } finally {
      setLoading(false);
    }
  }, [initialFetchDone]);

  // Initial fetch
  useEffect(() => {
    fetchHierarchy();
    // Focus search input on mount
    setTimeout(() => {
      if (searchInputRef.current) {
        searchInputRef.current.focus();
      }
    }, 100);
  }, []);

  // Apply selection (defined early so it can be used in keyboard handler)
  const handleApply = useCallback(() => {
    onSelectionChange(Array.from(tempSelectedIds));
    if (onApply) onApply();
  }, [tempSelectedIds, onSelectionChange, onApply]);

  // Attach keyboard handler to document to catch all key events
  useEffect(() => {
    const handleDocumentKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter') {
        // Let buttons handle Enter naturally (they will trigger onClick)
        // Only catch Enter when not in an interactive element
        const isInteractive = e.target.tagName === 'INPUT' || 
                             e.target.tagName === 'TEXTAREA' || 
                             e.target.tagName === 'BUTTON' ||
                             e.target.closest('button') !== null;
        
        if (!isInteractive) {
          e.preventDefault();
          handleApply();
        }
        // If in search input, let its own handler deal with it (already handled above)
      }
    };

    document.addEventListener('keydown', handleDocumentKeyDown);
    return () => {
      document.removeEventListener('keydown', handleDocumentKeyDown);
    };
  }, [onClose, handleApply]);

  // Debounced search - only trigger for actual search changes
  useEffect(() => {
    if (!initialFetchDone) return; // Skip during initial load
    
    const timer = setTimeout(() => {
      fetchHierarchy(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Get all descendant IDs for a company (as strings)
  const getDescendantIds = useCallback((node) => {
    const ids = [];
    const collect = (n) => {
      if (n.children) {
        n.children.forEach(child => {
          ids.push(String(child.id));
          collect(child);
        });
      }
    };
    collect(node);
    return ids;
  }, []);

  // Get all IDs in a subtree (including the node itself, as strings)
  const getSubtreeIds = useCallback((node) => {
    return [String(node.id), ...getDescendantIds(node)];
  }, [getDescendantIds]);

  // Check selection state for a node (simple check - no cascade logic for display)
  const getSelectionState = useCallback((node) => {
    const nodeIdStr = String(node.id);
    return tempSelectedIds.has(nodeIdStr) ? 'checked' : 'unchecked';
  }, [tempSelectedIds]);

  // Check if any children are selected (for showing indicator)
  const hasSelectedChildren = useCallback((node) => {
    if (!node.children || node.children.length === 0) return false;
    const descendantIds = getDescendantIds(node);
    return descendantIds.some(id => tempSelectedIds.has(id));
  }, [tempSelectedIds, getDescendantIds]);

  // Toggle a single company selection (no cascade)
  const toggleSelection = useCallback((node) => {
    const nodeIdStr = String(node.id);
    
    setTempSelectedIds(prev => {
      const next = new Set(prev);
      
      if (next.has(nodeIdStr)) {
        next.delete(nodeIdStr);
      } else {
        next.add(nodeIdStr);
      }
      
      return next;
    });
  }, []);

  // Toggle selection for node AND all its children (cascade)
  const toggleWithChildren = useCallback((node, e) => {
    e.stopPropagation();
    const subtreeIds = getSubtreeIds(node);
    const nodeIdStr = String(node.id);
    const isCurrentlySelected = tempSelectedIds.has(nodeIdStr);
    
    setTempSelectedIds(prev => {
      const next = new Set(prev);
      
      if (isCurrentlySelected) {
        // Uncheck all in subtree
        subtreeIds.forEach(id => next.delete(id));
      } else {
        // Check all in subtree
        subtreeIds.forEach(id => next.add(id));
      }
      
      return next;
    });
  }, [getSubtreeIds, tempSelectedIds]);

  // Toggle expand/collapse
  const toggleExpand = useCallback((nodeId, e) => {
    e.stopPropagation();
    const idStr = String(nodeId);
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(idStr)) {
        next.delete(idStr);
      } else {
        next.add(idStr);
      }
      return next;
    });
  }, []);

  // Expand all nodes
  const expandAll = useCallback(() => {
    const allIds = new Set();
    const collectIds = (nodes) => {
      nodes.forEach(node => {
        if (node.children && node.children.length > 0) {
          allIds.add(String(node.id));
          collectIds(node.children);
        }
      });
    };
    collectIds(companies);
    setExpandedIds(allIds);
  }, [companies]);

  // Collapse all nodes
  const collapseAll = useCallback(() => {
    setExpandedIds(new Set());
  }, []);

  // Select all visible companies
  const selectAll = useCallback(() => {
    const allIds = new Set();
    const collectIds = (nodes) => {
      nodes.forEach(node => {
        allIds.add(String(node.id));
        if (node.children) {
          collectIds(node.children);
        }
      });
    };
    collectIds(companies);
    setTempSelectedIds(allIds);
  }, [companies]);

  // Clear all selections
  const clearAll = useCallback(() => {
    setTempSelectedIds(new Set());
  }, []);

  // Get selected company names for display
  const selectedCompanyNames = useMemo(() => {
    const names = [];
    const findNames = (nodes) => {
      nodes.forEach(node => {
        if (tempSelectedIds.has(String(node.id))) {
          names.push({ id: node.id, name: node.name, referenceNo: node.referenceNo });
        }
        if (node.children) {
          findNames(node.children);
        }
      });
    };
    findNames(companies);
    return names;
  }, [companies, tempSelectedIds]);

  // Render a single tree node
  const renderNode = (node, level = 0) => {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expandedIds.has(String(node.id));
    const isSelected = getSelectionState(node) === 'checked';
    const childrenSelected = hasSelectedChildren(node);
    const indent = level * 16; // Indentation per level (left side only)
    const isChild = level > 0;
    
    // Type badge colors
    const typeBadgeClass = {
      'CORP': 'bg-blue-lt',
      'SUB': 'bg-purple-lt',
      'BRANCH': 'bg-cyan-lt'
    }[node.type] || 'bg-secondary-lt';

    return (
      <div key={node.id}>
        <div 
          className={`d-flex align-items-center py-2 px-2 border-bottom ${isSelected ? 'bg-primary-lt' : childrenSelected ? 'bg-azure-lt' : ''}`}
          style={{ 
            cursor: 'pointer',
            fontSize: isChild ? '0.85rem' : '0.925rem' // Slightly smaller for children
          }}
          onClick={() => toggleSelection(node)}
        >
          {/* Left indent spacer - only affects left side */}
          {indent > 0 && <div style={{ width: `${indent}px`, flexShrink: 0 }} />}
          
          {/* Expand/Collapse button */}
          <div style={{ width: '24px', flexShrink: 0 }}>
            {hasChildren && (
              <button
                type="button"
                className={`btn btn-sm p-0 border-0 ${isExpanded ? 'bg-primary' : ''}`}
                onClick={(e) => toggleExpand(node.id, e)}
                aria-label={isExpanded ? 'Collapse' : 'Expand'}
                aria-expanded={isExpanded}
                style={{ 
                  width: '20px', 
                  height: '20px', 
                  lineHeight: '20px', 
                  transition: 'background-color 0.2s',
                  outline: 'none'
                }}
                onFocus={(e) => {
                  e.target.style.outline = '2px solid var(--tblr-primary, #206bc4)';
                  e.target.style.outlineOffset = '2px';
                }}
                onBlur={(e) => {
                  e.target.style.outline = 'none';
                }}
              >
                <svg 
                  xmlns="http://www.w3.org/2000/svg" 
                  width="16" 
                  height="16" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke={isExpanded ? "white" : "currentColor"}
                  strokeWidth="2" 
                  strokeLinecap="round" 
                  strokeLinejoin="round"
                  style={{ 
                    transition: 'transform 0.2s, stroke 0.2s',
                    transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'
                  }}
                >
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </button>
            )}
          </div>
          
          {/* Checkbox */}
          <input
            type="checkbox"
            className="form-check-input me-2"
            checked={isSelected}
            onChange={() => toggleSelection(node)}
            onClick={(e) => e.stopPropagation()}
          />
          
          {/* Company name - normal weight for all */}
          <span className="flex-grow-1 text-truncate">
            {node.name}
          </span>
          
          {/* Reference number */}
          {node.referenceNo && (
            <small className="text-muted me-2">{node.referenceNo}</small>
          )}
          
          {/* Type badge */}
          <span className={`badge ${typeBadgeClass}`} style={{ fontSize: '0.65rem' }}>
            {node.type}
          </span>
          
          {/* Select all children button */}
          {hasChildren && (
            <button
              type="button"
              className="btn btn-sm btn-ghost-primary p-0 ms-2"
              onClick={(e) => toggleWithChildren(node, e)}
              title="Select/deselect with all children"
              style={{ width: '24px', height: '24px' }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
            </button>
          )}
          
          {/* Children count */}
          {hasChildren && (
            <small className="text-muted ms-1">({node.children.length})</small>
          )}
        </div>
        
        {/* Render children if expanded */}
        {hasChildren && isExpanded && (
          <div>
            {node.children.map(child => renderNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="modal-backdrop fade show" style={{ zIndex: 1050 }}></div>
      <div className="modal modal-blur fade show" style={{ display: 'block', zIndex: 1055 }} tabIndex="-1">
        <div className="modal-dialog modal-dialog-centered modal-lg">
          <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Filter by Company</h5>
            <button type="button" className="btn-close" onClick={onClose}></button>
          </div>
          
          <div className="modal-body">
            {/* Search */}
            <div className="mb-3">
              <input
                ref={searchInputRef}
                id="company-filter-search"
                name="company-filter-search"
                type="text"
                className="form-control"
                placeholder="Search companies by name or account number..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleApply();
                  }
                }}
              />
            </div>
            
            {/* Action buttons */}
            <div className="mb-3 d-flex gap-2 flex-wrap">
              <button type="button" className="btn btn-sm btn-outline-primary" onClick={selectAll}>
                Select All
              </button>
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={clearAll}>
                Clear All
              </button>
              <div className="vr"></div>
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={expandAll}>
                Expand All
              </button>
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={collapseAll}>
                Collapse All
              </button>
            </div>
            
            {/* Selected companies pills */}
            {selectedCompanyNames.length > 0 && selectedCompanyNames.length <= 10 && (
              <div className="mb-3 d-flex flex-wrap gap-1">
                {selectedCompanyNames.map((company) => (
                  <span 
                    key={company.id} 
                    className="badge bg-primary-lt d-inline-flex align-items-center gap-1"
                  >
                    {company.name}
                    {company.referenceNo && <small className="text-muted">({company.referenceNo})</small>}
                    <button
                      type="button"
                      className="btn-close ms-1"
                      style={{ fontSize: '0.5rem' }}
                      onClick={() => {
                        setTempSelectedIds(prev => {
                          const next = new Set(prev);
                          next.delete(String(company.id));
                          return next;
                        });
                      }}
                      aria-label="Remove"
                    ></button>
                  </span>
                ))}
              </div>
            )}
            
            {selectedCompanyNames.length > 10 && (
              <div className="mb-3">
                <span className="badge bg-primary-lt">
                  {selectedCompanyNames.length} companies selected
                </span>
              </div>
            )}
            
            {/* Tree view */}
            <div style={{ maxHeight: '400px', overflowY: 'auto', border: '1px solid var(--tblr-border-color)', borderRadius: '4px' }}>
              {loading ? (
                <div className="text-center py-4">
                  <div className="spinner-border" role="status">
                    <span className="visually-hidden">Loading...</span>
                  </div>
                </div>
              ) : companies.length === 0 ? (
                <div className="text-muted text-center py-4">
                  {searchQuery ? 'No companies match your search' : 'No companies available'}
                </div>
              ) : (
                companies.map(company => renderNode(company, 0))
              )}
            </div>
          </div>
          
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button 
              type="button" 
              className="btn btn-primary" 
              onClick={handleApply}
            >
              Apply Filter ({tempSelectedIds.size} selected)
            </button>
          </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default HierarchicalCompanyFilter;

