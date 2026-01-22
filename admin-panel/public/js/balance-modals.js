// Balance Management Modals

let currentBalanceUser = null;

// Top-Up Modal Functions
function openTopUpModal(user) {
    currentBalanceUser = user;
    
    // Create modal if it doesn't exist
    if (!document.getElementById('topup-modal')) {
        createTopUpModal();
    }
    
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
    currentBalanceUser = null;
}

async function executeTopUp() {
    if (!currentBalanceUser) return;

    const amount = parseFloat(document.getElementById('topup-amount').value);
    const reason = document.getElementById('topup-reason').value;

    if (!amount || amount <= 0) {
        alert('Please enter a valid top-up amount');
        return;
    }

    try {
        await api.topUpBalance(currentBalanceUser.userId, amount, reason);
        alert(`Successfully added ${amount.toLocaleString()} tokenCredits ($${(amount / 1000000).toFixed(2)}) to ${currentBalanceUser.userName}`);
        closeTopUpModal();
        loadCollectionData(); // Reload the balances view
    } catch (error) {
        alert(`Error topping up balance: ${error.message}`);
    }
}

// Refill Settings Modal Functions
function openRefillModal(user) {
    currentBalanceUser = user;
    
    // Create modal if it doesn't exist
    if (!document.getElementById('refill-modal')) {
        createRefillModal();
    }
    
    document.getElementById('refill-user-name').textContent = user.userName || 'Unknown';
    document.getElementById('refill-enabled').checked = user.autoRefillEnabled || false;
    document.getElementById('refill-amount').value = user.refillAmount || 6000000;
    document.getElementById('refill-interval-value').value = user.refillIntervalValue || 30;
    document.getElementById('refill-interval-unit').value = user.refillIntervalUnit || 'days';
    document.getElementById('refill-modal').style.display = 'block';
}

function closeRefillModal() {
    document.getElementById('refill-modal').style.display = 'none';
    currentBalanceUser = null;
}

async function saveRefillSettings() {
    if (!currentBalanceUser) return;

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
        await api.updateRefillSettings(currentBalanceUser.userId, settings);
        alert(`Auto-refill settings updated for ${currentBalanceUser.userName}`);
        closeRefillModal();
        loadCollectionData(); // Reload the balances view
    } catch (error) {
        alert(`Error updating settings: ${error.message}`);
    }
}

// Create Top-Up Modal HTML
function createTopUpModal() {
    const modal = document.createElement('div');
    modal.id = 'topup-modal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close" onclick="closeTopUpModal()">&times;</span>
            <h2>Top Up Balance</h2>
            <div id="topup-form">
                <p><strong>User:</strong> <span id="topup-user-name"></span></p>
                <p><strong>Email:</strong> <span id="topup-user-email"></span></p>
                <p><strong>Current Balance:</strong> <span id="topup-current-balance"></span></p>
                
                <div class="form-group">
                    <label for="topup-amount">Top-Up Amount (tokenCredits):</label>
                    <input type="number" id="topup-amount" placeholder="e.g., 1000000 for $1" step="1000" min="0">
                    <small>1,000,000 tokenCredits = $1 USD</small>
                </div>

                <div class="form-group">
                    <label for="topup-reason">Reason (optional):</label>
                    <input type="text" id="topup-reason" placeholder="e.g., Monthly refill, Special grant">
                </div>

                <div class="modal-actions">
                    <button onclick="executeTopUp()" class="btn btn-primary">Add Credits</button>
                    <button onclick="closeTopUpModal()" class="btn btn-secondary">Cancel</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

// Create Refill Settings Modal HTML
function createRefillModal() {
    const modal = document.createElement('div');
    modal.id = 'refill-modal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close" onclick="closeRefillModal()">&times;</span>
            <h2>Auto-Refill Settings</h2>
            <div id="refill-form">
                <p><strong>User:</strong> <span id="refill-user-name"></span></p>
                
                <div class="form-group">
                    <label>
                        <input type="checkbox" id="refill-enabled">
                        Enable Auto-Refill
                    </label>
                </div>

                <div class="form-group">
                    <label for="refill-amount">Refill Amount (tokenCredits):</label>
                    <input type="number" id="refill-amount" placeholder="e.g., 6000000" step="1000" min="0">
                </div>

                <div class="form-group">
                    <label for="refill-interval">Refill Every:</label>
                    <input type="number" id="refill-interval-value" placeholder="30" min="1" style="width: 80px;">
                    <select id="refill-interval-unit">
                        <option value="days">Days</option>
                        <option value="weeks">Weeks</option>
                        <option value="months">Months</option>
                    </select>
                </div>

                <div class="modal-actions">
                    <button onclick="saveRefillSettings()" class="btn btn-primary">Save Settings</button>
                    <button onclick="closeRefillModal()" class="btn btn-secondary">Cancel</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

// Close modals when clicking outside
window.addEventListener('click', function(event) {
    const topupModal = document.getElementById('topup-modal');
    const refillModal = document.getElementById('refill-modal');
    if (event.target === topupModal) {
        closeTopUpModal();
    }
    if (event.target === refillModal) {
        closeRefillModal();
    }
});
