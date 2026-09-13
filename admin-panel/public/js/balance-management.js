// Balance Management JavaScript

let currentPage = 1;
let currentSearch = '';
let currentUser = null;

// API helper
const api = {
    async request(url, options = {}) {
        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch(url, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    ...options.headers
                }
            });

            if (response.status === 401) {
                localStorage.removeItem('adminToken');
                window.location.href = '/login.html';
                return;
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error('API request failed:', error);
            throw error;
        }
    },

    async getBalances(page = 1, search = '') {
        return this.request(`/api/balances?page=${page}&limit=20&search=${encodeURIComponent(search)}`);
    },

    async topUpBalance(userId, amount, reason = '') {
        return this.request('/api/balances/topup', {
            method: 'POST',
            body: JSON.stringify({ userId, amount, reason })
        });
    },

    async updateRefillSettings(userId, settings) {
        return this.request('/api/balances/refill-settings', {
            method: 'PUT',
            body: JSON.stringify({ userId, ...settings })
        });
    },

    async createBalance(userId) {
        return this.request('/api/balances/create', {
            method: 'POST',
            body: JSON.stringify({ userId })
        });
    }
};

// Load balances
async function loadBalances() {
    try {
        const tbody = document.getElementById('balances-tbody');
        tbody.innerHTML = '<tr><td colspan="7" class="loading">Loading...</td></tr>';

        const data = await api.getBalances(currentPage, currentSearch);

        if (data.documents.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-secondary)">No balances found</td></tr>';
            return;
        }

        tbody.innerHTML = data.documents.map(doc => {
            const balance = parseFloat(doc.tokenCredits || 0).toFixed(2);
            const autoRefill = doc.autoRefillEnabled ? '✅ Enabled' : '❌ Disabled';
            const refillAmount = doc.refillAmount ? (parseFloat(doc.refillAmount) / 1000000).toFixed(2) : 'N/A';
            const lastRefill = doc.lastRefill ? new Date(doc.lastRefill).toLocaleDateString() : 'Never';

            return `
                <tr>
                    <td>${escapeHtml(doc.userName || 'Unknown')}</td>
                    <td>${escapeHtml(doc.userEmail || 'N/A')}</td>
                    <td><strong>${balance}</strong> <small>($${(balance / 1000000).toFixed(4)})</small></td>
                    <td>${autoRefill}</td>
                    <td>$${refillAmount}</td>
                    <td>${lastRefill}</td>
                    <td>
                        <button onclick='openTopUpModal(${JSON.stringify(doc)})' class="btn-sm btn-primary">💵 Top Up</button>
                        <button onclick='openRefillModal(${JSON.stringify(doc)})' class="btn-sm btn-secondary">⚙️ Settings</button>
                    </td>
                </tr>
            `;
        }).join('');

        // Update pagination
        updatePagination(data.pagination);
    } catch (error) {
        console.error('Error loading balances:', error);
        document.getElementById('balances-tbody').innerHTML = 
            '<tr><td colspan="7" style="text-align:center;padding:2rem;color:red;">Error loading balances</td></tr>';
    }
}

// Update pagination controls
function updatePagination(pagination) {
    const controls = document.getElementById('pagination-controls');
    const { page, totalPages, total } = pagination;

    controls.innerHTML = `
        <span>Page ${page} of ${totalPages} (${total} total)</span>
        <div>
            <button onclick="goToPage(1)" ${page === 1 ? 'disabled' : ''}>First</button>
            <button onclick="goToPage(${page - 1})" ${page === 1 ? 'disabled' : ''}>Previous</button>
            <button onclick="goToPage(${page + 1})" ${page === totalPages ? 'disabled' : ''}>Next</button>
            <button onclick="goToPage(${totalPages})" ${page === totalPages ? 'disabled' : ''}>Last</button>
        </div>
    `;
}

function goToPage(page) {
    currentPage = page;
    loadBalances();
}

// Search functionality
function searchUsers() {
    currentSearch = document.getElementById('search-input').value;
    currentPage = 1;
    loadBalances();
}

// Allow Enter key for search
document.getElementById('search-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        searchUsers();
    }
});

function refreshBalances() {
    loadBalances();
}

// Top-Up Modal Functions
function openTopUpModal(user) {
    currentUser = user;
    document.getElementById('topup-user-name').textContent = user.userName || 'Unknown';
    document.getElementById('topup-user-email').textContent = user.userEmail || 'N/A';
    document.getElementById('topup-current-balance').textContent = 
        `${parseFloat(user.tokenCredits || 0).toFixed(2)} ($${(user.tokenCredits / 1000000).toFixed(4)})`;
    document.getElementById('topup-amount').value = '';
    document.getElementById('topup-reason').value = '';
    document.getElementById('topup-modal').style.display = 'block';
}

function closeTopUpModal() {
    document.getElementById('topup-modal').style.display = 'none';
    currentUser = null;
}

async function executeTopUp() {
    if (!currentUser) return;

    const amount = parseFloat(document.getElementById('topup-amount').value);
    const reason = document.getElementById('topup-reason').value;

    if (!amount || amount <= 0) {
        alert('Please enter a valid top-up amount');
        return;
    }

    try {
        await api.topUpBalance(currentUser.userId, amount, reason);
        alert(`Successfully added ${amount.toLocaleString()} tokenCredits ($${(amount / 1000000).toFixed(2)}) to ${currentUser.userName}`);
        closeTopUpModal();
        loadBalances();
    } catch (error) {
        alert(`Error topping up balance: ${error.message}`);
    }
}

// Refill Settings Modal Functions
function openRefillModal(user) {
    currentUser = user;
    document.getElementById('refill-user-name').textContent = user.userName || 'Unknown';
    document.getElementById('refill-enabled').checked = user.autoRefillEnabled || false;
    document.getElementById('refill-amount').value = user.refillAmount || 6000000;
    document.getElementById('refill-interval-value').value = user.refillIntervalValue || 30;
    document.getElementById('refill-interval-unit').value = user.refillIntervalUnit || 'days';
    document.getElementById('refill-modal').style.display = 'block';
}

function closeRefillModal() {
    document.getElementById('refill-modal').style.display = 'none';
    currentUser = null;
}

async function saveRefillSettings() {
    if (!currentUser) return;

    const settings = {
        autoRefillEnabled: document.getElementById('refill-enabled').checked,
        refillAmount: parseFloat(document.getElementById('refill-amount').value),
        refillIntervalValue: parseInt(document.getElementById('refill-interval-value').value),
        refillIntervalUnit: document.getElementById('refill-interval-unit').value
    };

    if (settings.refillAmount <= 0) {
        alert('Please enter a valid refill amount');
        return;
    }

    if (settings.refillIntervalValue <= 0) {
        alert('Please enter a valid refill interval');
        return;
    }

    try {
        await api.updateRefillSettings(currentUser.userId, settings);
        alert(`Auto-refill settings updated for ${currentUser.userName}`);
        closeRefillModal();
        loadBalances();
    } catch (error) {
        alert(`Error updating settings: ${error.message}`);
    }
}

// Utility functions
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

function logout() {
    localStorage.removeItem('adminToken');
    window.location.href = '/login.html';
}

// Close modals when clicking outside
window.onclick = function(event) {
    const topupModal = document.getElementById('topup-modal');
    const refillModal = document.getElementById('refill-modal');
    if (event.target === topupModal) {
        closeTopUpModal();
    }
    if (event.target === refillModal) {
        closeRefillModal();
    }
};

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    // Check authentication
    const token = localStorage.getItem('adminToken');
    if (!token) {
        window.location.href = '/login.html';
        return;
    }

    loadBalances();
});
