// State management
const state = {
    authenticated: false,
    currentCollection: null,
    currentPage: 1,
    currentView: 'overview',
    collections: [],
    searchTerm: ''
};

// API helper
const api = {
    async request(url, options = {}) {
        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Request failed');
            }
            
            return await response.json();
        } catch (error) {
            throw error;
        }
    },

    async login(username, password) {
        return this.request('/api/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
    },

    async logout() {
        return this.request('/api/logout', { method: 'POST' });
    },

    async checkAuth() {
        return this.request('/api/auth/status');
    },

    async getCollections() {
        return this.request('/api/collections');
    },

    async getCollection(name, page = 1, limit = 20, search = '') {
        return this.request(`/api/collection/${name}?page=${page}&limit=${limit}&search=${search}`);
    },

    async getDocument(collection, id) {
        return this.request(`/api/collection/${collection}/${id}`);
    },

    async createDocument(collection, data) {
        return this.request(`/api/collection/${collection}`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async updateDocument(collection, id, data) {
        return this.request(`/api/collection/${collection}/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },

    async deleteDocument(collection, id) {
        return this.request(`/api/collection/${collection}/${id}`, {
            method: 'DELETE'
        });
    },

    async getStats() {
        return this.request('/api/stats');
    }
};

// UI helper
const ui = {
    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        document.getElementById(screenId).classList.add('active');
    },

    showView(viewId) {
        document.querySelectorAll('.view').forEach(view => {
            view.classList.remove('active');
        });
        document.getElementById(viewId).classList.add('active');
        state.currentView = viewId.replace('-view', '');
    },

    showError(elementId, message) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = message;
            element.classList.add('active');
            setTimeout(() => {
                element.classList.remove('active');
            }, 5000);
        }
    },

    showModal(modalId) {
        document.getElementById(modalId).classList.add('active');
    },

    hideModal(modalId) {
        document.getElementById(modalId).classList.remove('active');
    },

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    },

    formatNumber(num) {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    },

    setActiveNav(element) {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelectorAll('.collection-item').forEach(item => {
            item.classList.remove('active');
        });
        if (element) {
            element.classList.add('active');
        }
    }
};

// Login handler
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    try {
        await api.login(username, password);
        state.authenticated = true;
        document.getElementById('admin-username').textContent = username;
        ui.showScreen('dashboard-screen');
        loadDashboard();
    } catch (error) {
        ui.showError('login-error', error.message);
    }
});

// Logout handler
document.getElementById('logout-btn').addEventListener('click', async () => {
    try {
        await api.logout();
        state.authenticated = false;
        ui.showScreen('login-screen');
        document.getElementById('login-form').reset();
    } catch (error) {
        console.error('Logout error:', error);
    }
});

// Load dashboard data
async function loadDashboard() {
    try {
        const collections = await api.getCollections();
        state.collections = collections;
        renderCollectionsList(collections);
        
        // Auto-select first collection
        if (collections.length > 0) {
            viewCollection(collections[0].name);
        }
    } catch (error) {
        console.error('Error loading dashboard:', error);
    }
}

// Render collections list in sidebar
function renderCollectionsList(collections) {
    const container = document.getElementById('collections-list');
    container.innerHTML = collections.map(col => `
        <div class="collection-item" data-collection="${col.name}">
            <span>${col.name}</span>
            <span class="collection-count">${col.count}</span>
        </div>
    `).join('');
    
    // Add click handlers
    document.querySelectorAll('.collection-item').forEach(item => {
        item.addEventListener('click', function() {
            const collectionName = this.getAttribute('data-collection');
            ui.setActiveNav(this);
            viewCollection(collectionName);
        });
    });
}

// View collection
async function viewCollection(collectionName) {
    state.currentCollection = collectionName;
    state.currentPage = 1;
    state.searchTerm = '';
    
    document.getElementById('collection-title').textContent = collectionName;
    document.getElementById('search-input').value = '';
    
    ui.showView('collection-view');
    await loadCollectionData();
}

// Get display fields for different collection types
function getCollectionFields(collectionName) {
    const fieldMap = {
        users: ['_id', 'name', 'username', 'email', 'role', 'createdAt'],
        conversations: ['_id', 'title', 'userName', 'endpoint', 'model', 'createdAt', 'updatedAt'],
        messages: ['_id', 'sender', 'text', 'userName', 'conversationId', 'createdAt', 'tokenCount'],
        sessions: ['_id', 'userName', 'userEmail', 'expiration'],
        balances: ['_id', 'userName', 'userEmail', 'tokenCredits', 'autoRefillEnabled', 'lastRefill'],
        transactions: ['_id', 'userName', 'conversationId', 'tokenType', 'model', 'rawAmount', 'createdAt'],
        roles: ['_id', 'name'],
        accessroles: ['_id', 'accessRoleId', 'name', 'resourceType', 'permBits'],
        agentcategories: ['_id', 'value', 'label', 'order', 'isActive'],
        projects: ['_id', 'name', 'createdAt', 'updatedAt'],
        agents: ['_id', 'name', 'description', 'createdAt'],
        promptgroups: ['_id', 'name', 'createdAt'],
        groups: ['_id', 'name', 'members'],
        tokens: ['_id', 'userName', 'token', 'createdAt'],
        aclentries: ['_id', 'resource', 'permission']
    };
    
    return fieldMap[collectionName] || ['_id'];
}

// Format field value for display
function formatFieldValue(value, fieldName) {
    if (value === null || value === undefined) return '-';
    
    // Format dates
    if (fieldName.includes('At') || fieldName.includes('expiration')) {
        try {
            const date = new Date(value);
            if (!isNaN(date.getTime())) {
                return date.toLocaleString();
            }
        } catch (e) {
            return value;
        }
    }
    
    // Format booleans
    if (typeof value === 'boolean') {
        return value ? '✓ Yes' : '✗ No';
    }
    
    // Format numbers
    if (typeof value === 'number') {
        return ui.formatNumber(value);
    }
    
    // Format arrays
    if (Array.isArray(value)) {
        return `[${value.length} items]`;
    }
    
    // Format objects
    if (typeof value === 'object') {
        return '[Object]';
    }
    
    // Truncate long strings
    const str = String(value);
    if (str.length > 100) {
        return str.substring(0, 97) + '...';
    }
    
    return str;
}

// Load collection data
async function loadCollectionData() {
    try {
        const tbody = document.getElementById('documents-tbody');
        const thead = document.getElementById('table-headers');
        tbody.innerHTML = '<tr><td colspan="10" class="loading">Loading...</td></tr>';
        
        const data = await api.getCollection(
            state.currentCollection,
            state.currentPage,
            20,
            state.searchTerm
        );
        
        if (data.documents.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:2rem;color:var(--text-secondary)">No documents found</td></tr>';
            return;
        }
        
        // Get fields to display for this collection
        const fields = getCollectionFields(state.currentCollection);
        
        // Update table headers with friendly names
        const friendlyHeaders = {
            '_id': 'ID',
            'userName': 'User Name',
            'userEmail': 'User Email',
            'userUsername': 'Username',
            'tokenCredits': 'Token Credits',
            'autoRefillEnabled': 'Auto Refill',
            'lastRefill': 'Last Refill',
            'createdAt': 'Created',
            'updatedAt': 'Updated',
            'conversationId': 'Conversation',
            'tokenType': 'Token Type',
            'rawAmount': 'Amount',
            'tokenCount': 'Tokens',
            'expiration': 'Expires',
            'accessRoleId': 'Role ID',
            'resourceType': 'Resource',
            'permBits': 'Permissions'
        };
        
        thead.innerHTML = `
            ${fields.map(field => `<th>${friendlyHeaders[field] || field}</th>`).join('')}
            <th>Actions</th>
        `;
        
        // Build table rows
        tbody.innerHTML = data.documents.map(doc => {
            const id = doc._id;
            
            return `
                <tr>
                    ${fields.map(field => {
                        const value = doc[field];
                        const displayValue = formatFieldValue(value, field);
                        return `<td>${escapeHtml(displayValue)}</td>`;
                    }).join('')}
                    <td>
                        <div class="action-buttons">
                            <button class="btn btn-small btn-primary" onclick="viewDocument('${id}')">
                                View
                            </button>
                            <button class="btn btn-small btn-secondary" onclick="editDocument('${id}')">
                                Edit
                            </button>
                            <button class="btn btn-small btn-danger" onclick="confirmDelete('${id}')">
                                Delete
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
        
        // Update pagination
        updatePagination(data.pagination);
    } catch (error) {
        console.error('Error loading collection data:', error);
        const tbody = document.getElementById('documents-tbody');
        tbody.innerHTML = `<tr><td colspan="10" class="error-message active">Error: ${error.message}</td></tr>`;
    }
}

// Update pagination
function updatePagination(pagination) {
    document.getElementById('page-info').textContent = 
        `Page ${pagination.page} of ${pagination.totalPages} (${ui.formatNumber(pagination.total)} total)`;
    
    document.getElementById('prev-page').disabled = pagination.page === 1;
    document.getElementById('next-page').disabled = pagination.page === pagination.totalPages;
}

// Search handler
let searchTimeout;
document.getElementById('search-input').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        state.searchTerm = e.target.value;
        state.currentPage = 1;
        loadCollectionData();
    }, 500);
});

// Pagination handlers
document.getElementById('prev-page').addEventListener('click', () => {
    if (state.currentPage > 1) {
        state.currentPage--;
        loadCollectionData();
    }
});

document.getElementById('next-page').addEventListener('click', () => {
    state.currentPage++;
    loadCollectionData();
});

// Add document
document.getElementById('add-document-btn').addEventListener('click', () => {
    document.getElementById('modal-title').textContent = 'Add New Document';
    document.getElementById('document-editor').value = '{\n  \n}';
    document.getElementById('save-btn').onclick = createNewDocument;
    document.getElementById('delete-btn').style.display = 'none';
    ui.showModal('document-modal');
});

// View document
async function viewDocument(id) {
    try {
        const doc = await api.getDocument(state.currentCollection, id);
        document.getElementById('modal-title').textContent = 'View Document';
        document.getElementById('document-editor').value = JSON.stringify(doc, null, 2);
        document.getElementById('document-editor').readOnly = true;
        document.getElementById('save-btn').style.display = 'none';
        document.getElementById('delete-btn').style.display = 'none';
        ui.showModal('document-modal');
    } catch (error) {
        ui.showError('modal-error', error.message);
    }
}

// Edit document
async function editDocument(id) {
    try {
        const doc = await api.getDocument(state.currentCollection, id);
        document.getElementById('modal-title').textContent = 'Edit Document';
        document.getElementById('document-editor').value = JSON.stringify(doc, null, 2);
        document.getElementById('document-editor').readOnly = false;
        document.getElementById('save-btn').style.display = 'block';
        document.getElementById('save-btn').onclick = () => updateExistingDocument(id);
        document.getElementById('delete-btn').style.display = 'block';
        document.getElementById('delete-btn').onclick = () => {
            ui.hideModal('document-modal');
            confirmDelete(id);
        };
        ui.showModal('document-modal');
    } catch (error) {
        ui.showError('modal-error', error.message);
    }
}

// Create new document
async function createNewDocument() {
    try {
        const jsonText = document.getElementById('document-editor').value;
        const data = JSON.parse(jsonText);
        
        await api.createDocument(state.currentCollection, data);
        ui.hideModal('document-modal');
        loadCollectionData();
    } catch (error) {
        ui.showError('modal-error', error.message);
    }
}

// Update existing document
async function updateExistingDocument(id) {
    try {
        const jsonText = document.getElementById('document-editor').value;
        const data = JSON.parse(jsonText);
        
        await api.updateDocument(state.currentCollection, id, data);
        ui.hideModal('document-modal');
        loadCollectionData();
    } catch (error) {
        ui.showError('modal-error', error.message);
    }
}

// Confirm delete
function confirmDelete(id) {
    document.getElementById('confirm-message').textContent = 
        'Are you sure you want to delete this document? This action cannot be undone.';
    document.getElementById('confirm-ok').onclick = () => deleteDocument(id);
    ui.showModal('confirm-modal');
}

// Delete document
async function deleteDocument(id) {
    try {
        await api.deleteDocument(state.currentCollection, id);
        ui.hideModal('confirm-modal');
        loadCollectionData();
    } catch (error) {
        console.error('Error deleting document:', error);
        ui.hideModal('confirm-modal');
        alert('Error deleting document: ' + error.message);
    }
}

// Modal close handlers
document.getElementById('close-modal').addEventListener('click', () => {
    ui.hideModal('document-modal');
    document.getElementById('document-editor').readOnly = false;
    document.getElementById('save-btn').style.display = 'block';
});

document.getElementById('cancel-btn').addEventListener('click', () => {
    ui.hideModal('document-modal');
    document.getElementById('document-editor').readOnly = false;
    document.getElementById('save-btn').style.display = 'block';
});

document.getElementById('confirm-cancel').addEventListener('click', () => {
    ui.hideModal('confirm-modal');
});

// Close modal on outside click
document.getElementById('document-modal').addEventListener('click', (e) => {
    if (e.target.id === 'document-modal') {
        ui.hideModal('document-modal');
    }
});

document.getElementById('confirm-modal').addEventListener('click', (e) => {
    if (e.target.id === 'confirm-modal') {
        ui.hideModal('confirm-modal');
    }
});

// Utility function
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Make functions global for onclick handlers
window.viewCollection = viewCollection;
window.viewDocument = viewDocument;
window.editDocument = editDocument;
window.confirmDelete = confirmDelete;

// Check auth on load
(async () => {
    try {
        const authStatus = await api.checkAuth();
        if (authStatus.authenticated) {
            state.authenticated = true;
            ui.showScreen('dashboard-screen');
            loadDashboard();
        }
    } catch (error) {
        console.log('Not authenticated');
    }
})();

