const state = {
  authenticated: false,
  view: 'overview',
  collection: null,
  page: 1,
  limit: 20,
  totalPages: 1,
  search: '',
  userId: '',
  sortBy: 'createdAt',
  sortOrder: 'desc',
  rows: new Map(),
  users: [],
  collections: [],
  pendingConfirm: null,
  loadSequence: 0,
  dailyUsage: [],
  hotModels: [],
  pinnedChartIndex: null,
  sidebarCollapsed: false,
  collectionsExpanded: true,
};

const primaryViews = new Set([
  'overview', 'users', 'balances', 'conversations', 'messages',
  'files', 'transactions', 'maintenance',
]);

const configs = {
  users: {
    endpoint: '/api/users/enhanced',
    title: 'Users',
    eyebrow: 'People and usage',
    description: 'Billed usage comes directly from transactions, including full context and title calls.',
    fields: [
      ['name', 'User', 'name'],
      ['email', 'Email', 'email'],
      ['role', 'Role'],
      ['costUsd', 'Billed cost', 'currency'],
      ['currentBalance', 'Current balance', 'credits'],
      ['createdAt', 'Created', 'date'],
    ],
    actions: ['view', 'delete-user'],
  },
  conversations: {
    endpoint: '/api/conversations/enhanced',
    title: 'Conversations',
    eyebrow: 'Chat activity',
    description: 'Costs are grouped from billed transactions by conversation, not estimated from messages.',
    userFilter: true,
    fields: [
      ['title', 'Conversation', 'title'],
      ['userName', 'User'],
      ['model', 'Model'],
      ['messageCount', 'Messages', 'number'],
      ['promptTokens', 'Prompt tokens', 'number'],
      ['completionTokens', 'Completion tokens', 'number'],
      ['costUsd', 'Billed cost', 'currency'],
      ['createdAt', 'Created', 'date'],
    ],
    actions: ['view'],
  },
  messages: {
    endpoint: '/api/messages/enhanced',
    title: 'Messages',
    eyebrow: 'Message records',
    description: 'Recorded tokens are informational; authoritative billing is shown under Users and Transactions.',
    userFilter: true,
    fields: [
      ['userName', 'User'],
      ['sender', 'Sender'],
      ['model', 'Model'],
      ['text', 'Message', 'text'],
      ['recordedTokens', 'Recorded tokens', 'number'],
      ['createdAt', 'Created', 'date'],
    ],
    actions: ['view', 'transcript'],
  },
  balances: {
    endpoint: '/api/balances',
    title: 'Balances',
    eyebrow: 'Credits',
    description: 'Only balances linked to active users are shown. Orphans are managed under Maintenance.',
    defaultSort: 'lastRefill',
    fields: [
      ['userName', 'User', 'name'],
      ['userEmail', 'Email'],
      ['tokenCredits', 'Current balance', 'credits'],
      ['autoRefillEnabled', 'Auto refill', 'boolean'],
      ['refillAmount', 'Refill amount', 'credits'],
      ['lastRefill', 'Last refill', 'date'],
    ],
    actions: ['topup', 'refill'],
  },
  files: {
    endpoint: '/api/files',
    title: 'Files',
    eyebrow: 'Stored assets',
    description: 'Preview images, PDFs and text-based files without leaving the dashboard.',
    userFilter: true,
    fields: [
      ['filename', 'File', 'file'],
      ['userName', 'User'],
      ['type', 'Type'],
      ['bytes', 'Size', 'bytes'],
      ['source', 'Source'],
      ['usage', 'Usage', 'number'],
      ['createdAt', 'Created', 'date'],
    ],
    actions: ['preview', 'view'],
  },
  transactions: {
    endpoint: '/api/transactions',
    title: 'Transactions',
    eyebrow: 'Billing ledger',
    description: 'The source of truth for charged tokens, rates, credits and usage cost.',
    userFilter: true,
    fields: [
      ['userName', 'User'],
      ['context', 'Context'],
      ['tokenType', 'Token type'],
      ['model', 'Model'],
      ['rawAmount', 'Raw amount', 'number'],
      ['tokenValue', 'Credit change', 'number'],
      ['costUsd', 'Value', 'currency'],
      ['createdAt', 'Created', 'date'],
    ],
    actions: ['view'],
  },
};

const dom = {};

function cacheDom() {
  [
    'login-screen', 'app-screen', 'login-form', 'login-error', 'admin-username',
    'logout-button', 'theme-button', 'menu-button', 'sidebar', 'collections-list',
    'collections-toggle',
    'overview-view', 'data-view', 'maintenance-view', 'data-title', 'data-eyebrow',
    'data-description', 'search-input', 'user-filter', 'result-count', 'table-head',
    'table-body', 'previous-page', 'next-page', 'page-info', 'page-size', 'kpi-grid', 'usage-chart',
    'hot-models',
    'overview-range', 'overview-start', 'overview-end', 'overview-apply', 'data-range',
    'data-start', 'data-end', 'data-apply', 'modal', 'modal-title', 'modal-body',
    'modal-footer', 'confirm-modal', 'confirm-message', 'confirm-action',
    'toast-region', 'orphan-report', 'rescan-orphans', 'cleanup-orphans',
    'cleanup-confirmation', 'keep-transactions',
  ].forEach((id) => { dom[id] = document.getElementById(id); });
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  let payload = null;
  const type = response.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    payload = await response.json();
  }

  if (response.status === 401) {
    showLogin();
    throw new Error('Your session expired. Please sign in again.');
  }
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }
  return payload;
}

function showLogin() {
  state.authenticated = false;
  dom['app-screen'].classList.add('hidden');
  dom['login-screen'].classList.remove('hidden');
}

function showApp(username) {
  state.authenticated = true;
  dom['login-screen'].classList.add('hidden');
  dom['app-screen'].classList.remove('hidden');
  dom['admin-username'].textContent = username || '';
}

function toast(message, isError = false) {
  const element = document.createElement('div');
  element.className = `toast${isError ? ' toast-error' : ''}`;
  element.textContent = message;
  dom['toast-region'].appendChild(element);
  window.setTimeout(() => element.remove(), 4500);
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
}

function renderMarkdown(value) {
  const lines = escapeHtml(value).split('\n');
  const html = [];
  let listOpen = false;
  let codeOpen = false;
  const inline = (text) => text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  const closeList = () => {
    if (listOpen) {
      html.push('</ul>');
      listOpen = false;
    }
  };

  lines.forEach((line) => {
    if (/^```/.test(line)) {
      closeList();
      html.push(codeOpen ? '</code></pre>' : '<pre><code>');
      codeOpen = !codeOpen;
      return;
    }
    if (codeOpen) {
      html.push(`${line}\n`);
      return;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const item = line.match(/^\s*[-*]\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (item) {
      if (!listOpen) {
        html.push('<ul>');
        listOpen = true;
      }
      html.push(`<li>${inline(item[1])}</li>`);
    } else if (line.trim()) {
      closeList();
      html.push(`<p>${inline(line)}</p>`);
    } else {
      closeList();
    }
  });
  closeList();
  if (codeOpen) html.push('</code></pre>');
  return html.join('');
}

function number(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function currency(value) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(Number(value) || 0);
}

function dateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function bytes(value) {
  const amount = Number(value) || 0;
  if (!amount) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(amount) / Math.log(1024)));
  return `${(amount / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function isoDate(daysAgo = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function setPreset(scope, preset) {
  const start = dom[`${scope}-start`];
  const end = dom[`${scope}-end`];
  if (preset === 'custom') return;
  if (preset === 'all') {
    start.value = '';
    end.value = '';
    return;
  }
  end.value = isoDate(0);
  start.value = isoDate(Number(preset) - 1);
}

function dateParams(scope) {
  return {
    startDate: dom[`${scope}-start`].value,
    endDate: dom[`${scope}-end`].value,
  };
}

function queryString(params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== '' && value !== undefined && value !== null) query.set(key, value);
  });
  return query.toString();
}

function setActiveNav(view) {
  document.querySelectorAll('.nav-link').forEach((link) => {
    link.classList.toggle('active', link.dataset.view === view);
  });
}

function showOnly(viewId) {
  [dom['overview-view'], dom['data-view'], dom['maintenance-view']].forEach((view) => {
    view.classList.add('hidden');
  });
  dom[viewId].classList.remove('hidden');
}

async function navigate(view) {
  state.loadSequence += 1;
  state.view = view;
  state.collection = primaryViews.has(view) ? null : view;
  state.page = 1;
  state.search = '';
  state.userId = '';
  state.sortOrder = 'desc';
  state.sortBy = configs[view]?.defaultSort || 'createdAt';
  setActiveNav(view);
  dom.sidebar.classList.remove('open');

  if (view === 'overview') {
    showOnly('overview-view');
    await loadOverview();
    return;
  }
  if (view === 'maintenance') {
    showOnly('maintenance-view');
    await loadMaintenance();
    return;
  }

  showOnly('data-view');
  const defaultRange = view === 'balances' || !primaryViews.has(view) ? 'all' : '30';
  dom['data-range'].value = defaultRange;
  setPreset('data', defaultRange);
  const config = getConfig();
  dom['data-title'].textContent = config.title;
  dom['data-eyebrow'].textContent = config.eyebrow;
  dom['data-description'].textContent = config.description;
  dom['search-input'].value = '';
  dom['user-filter'].value = '';
  dom['user-filter'].classList.toggle('hidden', !config.userFilter);
  await loadData();
}

function getConfig() {
  if (configs[state.view]) return configs[state.view];
  return {
    endpoint: `/api/collection/${encodeURIComponent(state.view)}`,
    title: state.view.replace(/(^|[-_])(\w)/g, (_all, _prefix, letter) => ` ${letter.toUpperCase()}`).trim(),
    eyebrow: 'Database collection',
    description: 'Raw collection records. Newest records are shown first.',
    fields: null,
    actions: ['view'],
  };
}

async function loadCollections() {
  const collections = await apiRequest('/api/collections');
  state.collections = collections;
  const excluded = new Set([...primaryViews, 'users', 'balances', 'conversations', 'messages', 'files', 'transactions']);
  dom['collections-list'].innerHTML = collections
    .filter((collection) => !excluded.has(collection.name))
    .map((collection) => `
      <button class="nav-link collection-link" type="button" data-view="${escapeHtml(collection.name)}" title="${escapeHtml(collection.name)}">
        <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3"></ellipse><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"></path></svg>
        <span class="nav-text">${escapeHtml(collection.name)}</span>
        <span class="nav-count">${number(collection.count)}</span>
      </button>
    `).join('');
}

async function loadUsers() {
  state.users = await apiRequest('/api/users/names');
  dom['user-filter'].innerHTML = [
    '<option value="">All users</option>',
    ...state.users.map((user) => (
      `<option value="${escapeHtml(user._id)}">${escapeHtml(user.name || user.email || 'Unnamed user')}</option>`
    )),
  ].join('');
}

function skeletonTable(columns = 8) {
  dom['table-head'].innerHTML = Array.from({ length: columns }, () => '<th>&nbsp;</th>').join('');
  dom['table-body'].innerHTML = Array.from({ length: 8 }, () => (
    `<tr>${Array.from({ length: columns }, () => '<td><span class="skeleton"></span></td>').join('')}</tr>`
  )).join('');
}

async function loadData() {
  const sequence = ++state.loadSequence;
  const config = getConfig();
  skeletonTable((config.fields?.length || 7) + 1);
  const params = {
    page: state.page,
    limit: state.limit,
    search: state.search,
    userId: config.userFilter ? state.userId : '',
    sortBy: state.sortBy,
    sortOrder: state.sortOrder,
    ...dateParams('data'),
  };
  try {
    const data = await apiRequest(`${config.endpoint}?${queryString(params)}`);
    if (sequence !== state.loadSequence) return;
    state.totalPages = data.pagination.totalPages;
    state.rows = new Map(data.documents.map((row) => [String(row._id), row]));
    renderTable(data.documents, config);
    renderPagination(data.pagination);
  } catch (error) {
    if (sequence !== state.loadSequence) return;
    dom['table-body'].innerHTML = `<tr><td class="empty-state">${escapeHtml(error.message)}</td></tr>`;
    toast(error.message, true);
  }
}

function genericFields(rows) {
  if (!rows.length) return [['_id', 'ID']];
  const priority = ['_id', 'name', 'email', 'title', 'type', 'createdAt', 'updatedAt'];
  const keys = Object.keys(rows[0]);
  return [...priority.filter((key) => keys.includes(key)), ...keys.filter((key) => !priority.includes(key))]
    .slice(0, 9)
    .map((key) => [key, key.replace(/([a-z])([A-Z])/g, '$1 $2')]);
}

function renderTable(rows, config) {
  const fields = config.fields || genericFields(rows);
  dom['table-head'].innerHTML = [
    ...fields.map(([key, label]) => {
      const sortable = ['createdAt', 'updatedAt', 'name', 'email', 'title', 'filename', 'tokenCredits', 'lastRefill', 'rawAmount', 'model'].includes(key)
        || (state.view === 'users' && ['spentCredits', 'currentBalance', 'promptTokens'].includes(key));
      const indicator = state.sortBy === key
        ? `<span class="sort-indicator">${state.sortOrder === 'asc' ? '↑' : '↓'}</span>`
        : '';
      return `<th class="${sortable ? 'sortable' : ''}" ${sortable ? `data-sort="${key}"` : ''}>${escapeHtml(label)}${indicator}</th>`;
    }),
    '<th>Actions</th>',
  ].join('');

  if (!rows.length) {
    dom['table-body'].innerHTML = `<tr><td colspan="${fields.length + 1}" class="empty-state">No records match these filters.</td></tr>`;
    return;
  }

  dom['table-body'].innerHTML = rows.map((row) => `
    <tr>
      ${fields.map(([key, _label, type]) => `<td>${renderCell(row, key, type)}</td>`).join('')}
      <td>${renderActions(row, config.actions)}</td>
    </tr>
  `).join('');
  document.querySelector('.table-scroll').scrollLeft = 0;
}

function renderCell(row, key, type) {
  const value = row[key];
  if (type === 'currency') return `<span class="cell-primary">${currency(value)}</span>`;
  if (type === 'credits') return `<span class="cell-primary">${number(value)}</span><span class="cell-secondary"> (${currency((Number(value) || 0) / 1_000_000)})</span>`;
  if (type === 'number') return number(value);
  if (type === 'bytes') return bytes(value);
  if (type === 'date') return dateTime(value);
  if (type === 'boolean') {
    return value
      ? '<span class="badge badge-success">Enabled</span>'
      : '<span class="badge badge-muted">Disabled</span>';
  }
  if (type === 'name' || type === 'title') return `<span class="cell-primary">${escapeHtml(value || '—')}</span>`;
  if (type === 'email') return `<span class="cell-secondary">${escapeHtml(value || '—')}</span>`;
  if (type === 'text') {
    const text = String(value || '');
    return `<span title="${escapeHtml(text)}">${escapeHtml(text.slice(0, 110))}${text.length > 110 ? '…' : ''}</span>`;
  }
  if (type === 'file') {
    const image = String(row.type || '').startsWith('image/') && row.canPreview
      ? `<img src="/api/files/${encodeURIComponent(row._id)}/raw" alt="">`
      : escapeHtml((String(row.type || 'file').split('/')[1] || 'file').slice(0, 5));
    return `<span class="file-cell"><span class="file-thumb">${image}</span><span class="cell-primary">${escapeHtml(value || 'Unnamed file')}</span></span>`;
  }
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return `<span class="cell-mono">${escapeHtml(JSON.stringify(value))}</span>`;
  const output = String(value);
  return `<span class="${key === '_id' || key.toLowerCase().includes('id') ? 'cell-mono' : ''}" title="${escapeHtml(output)}">${escapeHtml(output.slice(0, 90))}${output.length > 90 ? '…' : ''}</span>`;
}

function renderActions(row, actions = []) {
  return `<div class="action-group">${actions.map((action) => {
    const labels = {
      view: 'View',
      transcript: 'Transcript',
      preview: 'Preview',
      topup: 'Top up',
      refill: 'Settings',
      'delete-user': 'Delete',
    };
    const dangerous = action === 'delete-user';
    const disabled = action === 'preview' && !row.canPreview;
    return `<button class="button button-small ${dangerous ? 'button-danger' : 'button-secondary'}" type="button" data-action="${action}" data-id="${escapeHtml(row._id)}" ${disabled ? 'disabled' : ''}>${labels[action]}</button>`;
  }).join('')}</div>`;
}

function renderPagination(page) {
  dom['page-info'].textContent = `Page ${page.page} of ${page.totalPages} · ${number(page.total)} records`;
  dom['result-count'].textContent = `${number(page.total)} results`;
  dom['page-size'].value = String(state.limit);
  dom['previous-page'].disabled = page.page <= 1;
  dom['next-page'].disabled = page.page >= page.totalPages;
}

async function loadOverview() {
  dom['kpi-grid'].innerHTML = Array.from({ length: 5 }, () => (
    '<div class="kpi-card"><span class="skeleton"></span></div>'
  )).join('');
  dom['usage-chart'].innerHTML = '<span class="skeleton"></span>';
  dom['hot-models'].innerHTML = Array.from({ length: 5 }, () => '<span class="skeleton"></span>').join('');
  try {
    const data = await apiRequest(`/api/overview?${queryString(dateParams('overview'))}`);
    const cards = [
      ['Total users', number(data.users), `${number(data.activeUsers)} active in range`],
      ['Billed cost', currency(data.costUsd), `${number(data.spentCredits)} credits`],
      ['Conversations', number(data.conversations), 'Created in range'],
      ['Files uploaded', number(data.files), 'Created in range'],
      ['Billable entries', number(data.transactions), 'Prompt and completion'],
    ];
    dom['kpi-grid'].innerHTML = cards.map(([label, value, note]) => `
      <article class="kpi-card"><span class="kpi-label">${label}</span><strong class="kpi-value">${value}</strong><small class="kpi-note">${note}</small></article>
    `).join('');
    state.dailyUsage = data.daily;
    state.hotModels = data.hotModels;
    state.pinnedChartIndex = null;
    renderChart(data.daily);
    renderHotModels(data.hotModels);
  } catch (error) {
    toast(error.message, true);
  }
}

function renderChart(points) {
  if (!points.length) {
    dom['usage-chart'].innerHTML = '<div class="empty-state">No billed usage in this date range.</div>';
    return;
  }
  const width = 1000;
  const height = 250;
  const padding = { top: 15, right: 20, bottom: 30, left: 52 };
  const max = Math.max(...points.map((point) => point.costUsd), 0.01);
  const x = (index) => padding.left + (index * (width - padding.left - padding.right) / Math.max(points.length - 1, 1));
  const y = (value) => padding.top + (height - padding.top - padding.bottom) * (1 - value / max);
  const coords = points.map((point, index) => `${x(index)},${y(point.costUsd)}`).join(' ');
  const area = `M ${x(0)} ${height - padding.bottom} L ${coords.replaceAll(',', ' ')} L ${x(points.length - 1)} ${height - padding.bottom} Z`;
  const labels = points.filter((_point, index) => (
    index === 0 || index === points.length - 1 || index % Math.max(1, Math.ceil(points.length / 5)) === 0
  ));
  const grids = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const gridY = y(max * ratio);
    return `<line class="chart-grid" x1="${padding.left}" y1="${gridY}" x2="${width - padding.right}" y2="${gridY}"></line>
      <text class="chart-label" x="2" y="${gridY + 4}">${currency(max * ratio)}</text>`;
  }).join('');
  dom['usage-chart'].innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily billed usage cost chart">
      ${grids}
      <path class="chart-area" d="${area}"></path>
      <polyline class="chart-line" points="${coords}"></polyline>
      ${points.map((point, index) => `
        <g class="chart-point-group" data-chart-group="${index}">
          <circle class="chart-hit" data-chart-index="${index}" tabindex="0" role="button" aria-label="${escapeHtml(`${point.date}, ${currency(point.costUsd)}. Show details`)}" cx="${x(index)}" cy="${y(point.costUsd)}" r="10"></circle>
          <circle class="chart-dot" cx="${x(index)}" cy="${y(point.costUsd)}" r="3"></circle>
        </g>
      `).join('')}
      ${labels.map((point) => {
        const index = points.indexOf(point);
        return `<text class="chart-label" x="${x(index)}" y="${height - 7}" text-anchor="${index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}">${point.date.slice(5)}</text>`;
      }).join('')}
    </svg>
    <div id="chart-tooltip" class="chart-tooltip hidden" role="status"></div>
    <p class="chart-help">Hover a point for contributors and models. Click for the full breakdown.</p>`;
}

function aggregateUsageDetails(details, key) {
  const grouped = new Map();
  details.forEach((detail) => {
    const name = detail[key] || 'Unknown';
    const current = grouped.get(name) || {
      name,
      costUsd: 0,
      promptTokens: 0,
      completionTokens: 0,
      calls: 0,
    };
    current.costUsd += Number(detail.costUsd) || 0;
    current.promptTokens += Number(detail.promptTokens) || 0;
    current.completionTokens += Number(detail.completionTokens) || 0;
    current.calls += Number(detail.transactionEntries) || Number(detail.calls) || 0;
    grouped.set(name, current);
  });
  return [...grouped.values()].sort((a, b) => b.costUsd - a.costUsd);
}

function showChartTooltip(index, target = null) {
  const point = state.dailyUsage[index];
  const tooltip = document.getElementById('chart-tooltip');
  if (!point || !tooltip) return;
  const users = aggregateUsageDetails(point.details, 'userName').slice(0, 3);
  const models = aggregateUsageDetails(point.details, 'model').slice(0, 3);
  tooltip.innerHTML = `
    <strong>${escapeHtml(point.date)} · ${currency(point.costUsd)}</strong>
    <small>${number(point.details.reduce((sum, item) => sum + item.transactionEntries, 0))} billing entries</small>
    <div class="tooltip-section">
      <small>Top users</small>
      ${users.map((user) => `<span class="tooltip-row"><span>${escapeHtml(user.name)}</span><strong>${currency(user.costUsd)}</strong></span>`).join('')}
    </div>
    <div class="tooltip-section">
      <small>Top models</small>
      ${models.map((model) => `<span class="tooltip-row"><span>${escapeHtml(model.name)}</span><strong>${currency(model.costUsd)}</strong></span>`).join('')}
    </div>`;
  tooltip.classList.remove('hidden');
  const hit = target || dom['usage-chart'].querySelector(`[data-chart-index="${index}"]`);
  if (hit) {
    const chartRect = dom['usage-chart'].getBoundingClientRect();
    const hitRect = hit.getBoundingClientRect();
    const center = hitRect.left - chartRect.left + (hitRect.width / 2);
    const left = Math.max(8, Math.min(
      center - (tooltip.offsetWidth / 2),
      chartRect.width - tooltip.offsetWidth - 8,
    ));
    const above = hitRect.top - chartRect.top - tooltip.offsetHeight - 12;
    const top = above >= 8
      ? above
      : hitRect.bottom - chartRect.top + 12;
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  }
}

function hideChartTooltip() {
  if (state.pinnedChartIndex !== null) return;
  document.getElementById('chart-tooltip')?.classList.add('hidden');
}

function dailyBreakdownHtml(point) {
  const users = aggregateUsageDetails(point.details, 'userName');
  const models = aggregateUsageDetails(point.details, 'model');
  const promptTokens = point.details.reduce((sum, item) => sum + item.promptTokens, 0);
  const completionTokens = point.details.reduce((sum, item) => sum + item.completionTokens, 0);
  const rows = [...point.details].sort((a, b) => b.costUsd - a.costUsd);
  return `
    <div class="usage-detail-summary">
      <div><strong>${currency(point.costUsd)}</strong><span>Billed cost</span></div>
      <div><strong>${number(users.length)}</strong><span>Users</span></div>
      <div><strong>${number(models.length)}</strong><span>Models</span></div>
      <div><strong>${number(promptTokens + completionTokens)}</strong><span>Billed tokens</span></div>
    </div>
    <div class="table-scroll">
      <table class="usage-detail-table">
        <thead><tr><th>User</th><th>Model</th><th>Context</th><th>Prompt</th><th>Completion</th><th>Related chats</th><th>Cost</th></tr></thead>
        <tbody>${rows.map((item) => `
          <tr>
            <td>${escapeHtml(item.userName)}</td>
            <td>${escapeHtml(item.model)}</td>
            <td><span class="badge badge-muted">${escapeHtml(item.context)}</span></td>
            <td>${number(item.promptTokens)}</td>
            <td>${number(item.completionTokens)}</td>
            <td>${number(item.conversationCount)}</td>
            <td>${currency(item.costUsd)}</td>
          </tr>
        `).join('')}</tbody>
      </table>
    </div>`;
}

function openDailyBreakdown(index) {
  const point = state.dailyUsage[index];
  if (!point) return;
  state.pinnedChartIndex = index;
  document.querySelectorAll('.chart-point-group').forEach((group) => {
    group.classList.toggle('is-pinned', Number(group.dataset.chartGroup) === index);
  });
  showChartTooltip(index);
  openModal(`Usage breakdown · ${point.date}`, dailyBreakdownHtml(point));
}

function renderHotModels(models) {
  if (!models.length) {
    dom['hot-models'].innerHTML = '<div class="empty-state">No models were used in this date range.</div>';
    return;
  }
  const maxCalls = Math.max(...models.map((model) => model.calls), 1);
  dom['hot-models'].innerHTML = `
    <div class="hot-model-header"><span>Rank</span><span>Model</span><span>Activity</span><span>Calls</span><span>Users</span><span>Cost</span></div>
    ${models.map((model, index) => `
      <button class="hot-model-row" type="button" data-model-index="${index}" aria-label="${escapeHtml(`${model.model}: ${number(model.calls)} calls, ${currency(model.costUsd)}. Show details`)}">
        <span class="model-rank">#${index + 1}</span>
        <span class="model-name" title="${escapeHtml(model.model)}">${escapeHtml(model.model)}</span>
        <progress class="model-usage" max="${maxCalls}" value="${model.calls}">${model.calls}</progress>
        <span class="model-metric">${number(model.calls)}</span>
        <span class="model-metric model-users">${number(model.activeUsers)}</span>
        <span class="model-cost">${currency(model.costUsd)}</span>
      </button>
    `).join('')}`;
}

function openModelBreakdown(index) {
  const model = state.hotModels[index];
  if (!model) return;
  const contributors = [...model.contributors].sort((a, b) => b.calls - a.calls);
  openModal(
    `Model usage · ${model.model}`,
    `<div class="usage-detail-summary">
      <div><strong>${number(model.calls)}</strong><span>Chat calls</span></div>
      <div><strong>${currency(model.costUsd)}</strong><span>Billed cost</span></div>
      <div><strong>${number(model.activeUsers)}</strong><span>Team members</span></div>
      <div><strong>${number(model.promptTokens + model.completionTokens)}</strong><span>Billed tokens</span></div>
    </div>
    <table class="usage-detail-table">
      <thead><tr><th>User</th><th>Calls</th><th>Share</th><th>Cost</th></tr></thead>
      <tbody>${contributors.map((user) => `
        <tr>
          <td>${escapeHtml(user.userName)}</td>
          <td>${number(user.calls)}</td>
          <td>${model.calls ? ((user.calls / model.calls) * 100).toFixed(1) : '0.0'}%</td>
          <td>${currency(user.costUsd)}</td>
        </tr>
      `).join('')}</tbody>
    </table>`,
  );
}

async function loadMaintenance() {
  dom['orphan-report'].innerHTML = '<span class="skeleton"></span>';
  try {
    const report = await apiRequest('/api/maintenance/orphans');
    renderOrphanReport(report);
  } catch (error) {
    dom['orphan-report'].textContent = error.message;
    toast(error.message, true);
  }
}

function renderOrphanReport(report) {
  dom['orphan-report'].innerHTML = `
    <div class="orphan-summary">
      <div><strong>${number(report.activeUsers)}</strong><span>Active users</span></div>
      <div><strong>${number(report.totalOrphans)}</strong><span>Orphaned records</span></div>
      <div><strong>${bytes(report.orphanFileBytes)}</strong><span>Orphaned file data</span></div>
    </div>
    <div class="orphan-list">
      ${Object.entries(report.collections).map(([name, item]) => `
        <div class="orphan-row"><span>${escapeHtml(name)}</span><strong>${number(item.count)}</strong></div>
      `).join('')}
    </div>
    <p class="muted">Last scanned ${dateTime(report.scannedAt)}</p>`;
}

function openModal(title, body, footer = '<button class="button button-secondary" data-close-modal type="button">Close</button>') {
  dom['modal-title'].textContent = title;
  dom['modal-body'].innerHTML = body;
  dom['modal-footer'].innerHTML = footer;
  dom.modal.classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function closeModal() {
  dom.modal.classList.add('hidden');
  dom['modal-body'].innerHTML = '';
  document.body.classList.remove('modal-open');
  if (state.pinnedChartIndex !== null) {
    state.pinnedChartIndex = null;
    document.querySelectorAll('.chart-point-group').forEach((group) => group.classList.remove('is-pinned'));
    document.getElementById('chart-tooltip')?.classList.add('hidden');
  }
}

function detailsHtml(row) {
  return `<dl class="detail-grid">${Object.entries(row).map(([key, value]) => {
    const formatted = key.toLowerCase().includes('cost') && typeof value === 'number'
      ? currency(value)
      : key.toLowerCase().includes('at')
        ? dateTime(value)
        : typeof value === 'object'
          ? JSON.stringify(value, null, 2)
          : String(value ?? '—');
    return `<dt>${escapeHtml(key.replace(/([a-z])([A-Z])/g, '$1 $2'))}</dt><dd>${escapeHtml(formatted)}</dd>`;
  }).join('')}</dl>`;
}

async function viewRow(row) {
  if (state.view === 'conversations') {
    await viewConversation(row);
    return;
  }
  if (state.view === 'messages') {
    openModal(
      `${row.sender || 'Message'} · ${dateTime(row.createdAt)}`,
      `<article class="single-message-view ${row.kind === 'error' ? 'transcript-error' : ''}">
        <div class="single-message-meta">${escapeHtml(row.userName || 'Deleted user')}${row.model && row.model !== '-' ? ` · ${escapeHtml(row.model)}` : ''}</div>
        <div class="transcript-message-content markdown-content">${renderMarkdown(row.text || '_No displayable text was stored for this message._')}</div>
      </article>`,
    );
    return;
  }
  if (!configs[state.view] && row._id) {
    try {
      const full = await apiRequest(`/api/collection/${encodeURIComponent(state.view)}/${encodeURIComponent(row._id)}`);
      openModal(`${getConfig().title} details`, detailsHtml(full));
      return;
    } catch (error) {
      toast(error.message, true);
      return;
    }
  }
  openModal(`${getConfig().title} details`, detailsHtml(row));
}

function conversationTranscriptHtml(transcript, userName) {
  const messages = transcript.messages.map((message) => {
    const sender = message.isCreatedByUser ? (userName || 'User') : (message.sender || 'Assistant');
    const model = message.model ? `<span>${escapeHtml(message.model)}</span>` : '';
    const text = message.text || '_No displayable text was stored for this message._';
    const attachments = (message.attachments || []).map((attachment) => {
      const url = attachment.id ? `/api/files/${encodeURIComponent(attachment.id)}/raw` : '';
      const isImage = String(attachment.type).startsWith('image/');
      const preview = attachment.available && isImage
        ? `<img src="${url}" alt="${escapeHtml(attachment.filename)}" loading="lazy">`
        : `<span class="attachment-file-icon">${isImage ? 'Image' : 'File'}</span>`;
      const content = attachment.available
        ? `<a href="${url}" target="_blank" rel="noopener">${preview}<span>${escapeHtml(attachment.filename)}</span></a>`
        : `<span class="attachment-unavailable">${preview}<span>${escapeHtml(attachment.filename)} (unavailable)</span></span>`;
      return `<div class="transcript-attachment">${content}</div>`;
    }).join('');
    return `<article class="transcript-message ${message.isCreatedByUser ? 'transcript-user' : 'transcript-assistant'} ${message.kind === 'error' ? 'transcript-error' : ''}">
      <header class="transcript-message-header">
        <strong>${escapeHtml(sender)}</strong>
        <div class="transcript-message-meta">${model}<time>${escapeHtml(dateTime(message.createdAt))}</time></div>
      </header>
      <div class="transcript-message-content markdown-content">${renderMarkdown(text)}</div>
      ${attachments ? `<div class="transcript-attachments">${attachments}</div>` : ''}
    </article>`;
  }).join('');

  return `<div class="transcript-summary">
      <span>${number(transcript.messages.length)} messages</span>
      <span>Read-only · oldest first</span>
    </div>
    ${transcript.truncated ? '<p class="transcript-warning">Only the first 2,000 messages are displayed for performance.</p>' : ''}
    <div class="conversation-transcript">${messages || '<p class="empty-state">No messages were found for this conversation.</p>'}</div>`;
}

async function viewConversation(row) {
  openModal(
    row.title || 'Conversation',
    '<div class="transcript-loading">Loading conversation transcript…</div>',
  );
  try {
    const transcript = await apiRequest(`/api/conversations/${encodeURIComponent(row.conversationId)}/messages`);
    openModal(transcript.conversation.title, conversationTranscriptHtml(transcript, row.userName));
    requestAnimationFrame(() => {
      dom['modal-body'].scrollTop = dom['modal-body'].scrollHeight;
    });
  } catch (error) {
    closeModal();
    toast(error.message, true);
  }
}

function previewFile(row) {
  const url = `/api/files/${encodeURIComponent(row._id)}/raw`;
  let preview;
  if (String(row.type).startsWith('image/')) {
    preview = `<img class="preview-image" src="${url}" alt="${escapeHtml(row.filename)}">`;
  } else if (row.type === 'application/pdf' || String(row.type).startsWith('text/')) {
    preview = `<iframe class="preview-frame" src="${url}" title="${escapeHtml(row.filename)}" sandbox></iframe>`;
  } else {
    preview = '<div class="preview-fallback">This file type cannot be previewed in the browser. Open it in a new tab instead.</div>';
  }
  openModal(
    row.filename,
    preview,
    `<a class="button button-primary" href="${url}" target="_blank" rel="noopener">Open file</a><button class="button button-secondary" data-close-modal type="button">Close</button>`,
  );
}

function topUpModal(row) {
  openModal(
    `Top up ${row.userName}`,
    `<form id="topup-form" class="modal-form">
      <p class="muted">Current balance: ${number(row.tokenCredits)} credits (${currency(row.tokenCredits / 1_000_000)})</p>
      <label for="topup-amount">Credits to add</label>
      <input id="topup-amount" type="number" min="1" max="1000000000" step="1000" required>
      <small class="muted">1,000,000 credits = $1.00</small>
      <label for="topup-reason">Reason</label>
      <input id="topup-reason" type="text" maxlength="300" placeholder="Monthly allowance">
    </form>`,
    '<button class="button button-secondary" data-close-modal type="button">Cancel</button><button class="button button-primary" data-modal-action="topup" type="button">Add credits</button>',
  );
  dom.modal.dataset.rowId = row._id;
}

function refillModal(row) {
  openModal(
    `Auto-refill for ${row.userName}`,
    `<form id="refill-form" class="modal-form">
      <label class="checkbox-row"><input id="refill-enabled" type="checkbox" ${row.autoRefillEnabled ? 'checked' : ''}> Enable auto-refill</label>
      <label for="refill-amount">Refill amount in credits</label>
      <input id="refill-amount" type="number" min="1" max="1000000000" value="${Number(row.refillAmount) || 6000000}" required>
      <label for="refill-value">Refill every</label>
      <input id="refill-value" type="number" min="1" max="365" value="${Number(row.refillIntervalValue) || 30}" required>
      <label for="refill-unit">Interval unit</label>
      <select id="refill-unit">
        ${['days', 'weeks', 'months'].map((unit) => `<option value="${unit}" ${row.refillIntervalUnit === unit ? 'selected' : ''}>${unit}</option>`).join('')}
      </select>
    </form>`,
    '<button class="button button-secondary" data-close-modal type="button">Cancel</button><button class="button button-primary" data-modal-action="refill" type="button">Save settings</button>',
  );
  dom.modal.dataset.rowId = row._id;
}

function confirmAction(message, callback) {
  dom['confirm-message'].textContent = message;
  state.pendingConfirm = callback;
  dom['confirm-modal'].classList.remove('hidden');
}

function closeConfirm() {
  dom['confirm-modal'].classList.add('hidden');
  state.pendingConfirm = null;
}

async function deleteUser(row) {
  confirmAction(
    `Delete ${row.name} (${row.email}) and all related balances, usage, conversations, messages and stored files? This cannot be undone.`,
    async () => {
      await apiRequest(`/api/users/${encodeURIComponent(row._id)}`, { method: 'DELETE' });
      toast(`${row.name} and related data were deleted.`);
      await Promise.all([loadData(), loadCollections(), loadUsers()]);
    },
  );
}

async function runModalAction(action) {
  const row = state.rows.get(dom.modal.dataset.rowId);
  if (!row) return;
  try {
    if (action === 'topup') {
      const amount = Number(document.getElementById('topup-amount').value);
      const reason = document.getElementById('topup-reason').value;
      await apiRequest('/api/balances/topup', {
        method: 'POST',
        body: JSON.stringify({ userId: row.userId, amount, reason }),
      });
      toast(`Added ${number(amount)} credits to ${row.userName}.`);
    } else if (action === 'refill') {
      await apiRequest('/api/balances/refill-settings', {
        method: 'PUT',
        body: JSON.stringify({
          userId: row.userId,
          autoRefillEnabled: document.getElementById('refill-enabled').checked,
          refillAmount: Number(document.getElementById('refill-amount').value),
          refillIntervalValue: Number(document.getElementById('refill-value').value),
          refillIntervalUnit: document.getElementById('refill-unit').value,
        }),
      });
      toast(`Updated auto-refill for ${row.userName}.`);
    }
    closeModal();
    await loadData();
  } catch (error) {
    toast(error.message, true);
  }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('admin-theme-v2', theme);
  dom['theme-button'].textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
}

function setSidebarCollapsed(collapsed) {
  state.sidebarCollapsed = collapsed;
  dom['app-screen'].classList.toggle('sidebar-collapsed', collapsed);
  const mobile = window.matchMedia('(max-width: 800px)').matches;
  dom['menu-button'].setAttribute('aria-expanded', String(mobile ? dom.sidebar.classList.contains('open') : !collapsed));
  dom['menu-button'].setAttribute('aria-label', mobile ? 'Open navigation' : collapsed ? 'Expand navigation' : 'Collapse navigation');
  localStorage.setItem('admin-sidebar-collapsed', String(collapsed));
}

function setCollectionsExpanded(expanded) {
  state.collectionsExpanded = expanded;
  dom['collections-list'].classList.toggle('collapsed', !expanded);
  dom['collections-toggle'].classList.toggle('collapsed', !expanded);
  dom['collections-toggle'].setAttribute('aria-expanded', String(expanded));
  localStorage.setItem('admin-collections-expanded', String(expanded));
}

function bindEvents() {
  dom['login-form'].addEventListener('submit', async (event) => {
    event.preventDefault();
    dom['login-error'].textContent = '';
    const form = new FormData(event.currentTarget);
    try {
      const result = await apiRequest('/api/login', {
        method: 'POST',
        body: JSON.stringify({
          username: form.get('username'),
          password: form.get('password'),
        }),
      });
      showApp(result.username);
      await initializeDashboard();
    } catch (error) {
      dom['login-error'].textContent = error.message;
    }
  });

  dom['logout-button'].addEventListener('click', async () => {
    try {
      await apiRequest('/api/logout', { method: 'POST' });
    } finally {
      showLogin();
    }
  });

  document.addEventListener('click', (event) => {
    const nav = event.target.closest('[data-view]');
    if (nav) navigate(nav.dataset.view);
  });

  dom['menu-button'].addEventListener('click', () => {
    if (window.matchMedia('(max-width: 800px)').matches) {
      dom.sidebar.classList.toggle('open');
      const open = dom.sidebar.classList.contains('open');
      dom['menu-button'].setAttribute('aria-expanded', String(open));
      dom['menu-button'].setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    } else {
      setSidebarCollapsed(!state.sidebarCollapsed);
    }
  });
  dom['collections-toggle'].addEventListener('click', () => {
    setCollectionsExpanded(!state.collectionsExpanded);
  });
  dom['theme-button'].addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });

  dom['overview-range'].addEventListener('change', (event) => setPreset('overview', event.target.value));
  dom['data-range'].addEventListener('change', (event) => setPreset('data', event.target.value));
  dom['overview-apply'].addEventListener('click', loadOverview);
  dom['data-apply'].addEventListener('click', () => { state.page = 1; loadData(); });

  const chartIndex = (event) => {
    const point = event.target.closest?.('[data-chart-index]');
    return point ? Number(point.dataset.chartIndex) : null;
  };
  dom['usage-chart'].addEventListener('pointerover', (event) => {
    const index = chartIndex(event);
    if (index !== null) showChartTooltip(index, event.target);
  });
  dom['usage-chart'].addEventListener('pointerout', (event) => {
    if (chartIndex(event) !== null) hideChartTooltip();
  });
  dom['usage-chart'].addEventListener('focusin', (event) => {
    const index = chartIndex(event);
    if (index !== null) showChartTooltip(index, event.target);
  });
  dom['usage-chart'].addEventListener('focusout', hideChartTooltip);
  dom['usage-chart'].addEventListener('click', (event) => {
    const index = chartIndex(event);
    if (index !== null) openDailyBreakdown(index);
  });
  dom['usage-chart'].addEventListener('keydown', (event) => {
    const index = chartIndex(event);
    if (index !== null && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openDailyBreakdown(index);
    }
  });
  dom['hot-models'].addEventListener('click', (event) => {
    const row = event.target.closest('[data-model-index]');
    if (row) openModelBreakdown(Number(row.dataset.modelIndex));
  });

  let searchTimer;
  dom['search-input'].addEventListener('input', (event) => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      state.search = event.target.value.trim();
      state.page = 1;
      loadData();
    }, 350);
  });

  dom['user-filter'].addEventListener('change', (event) => {
    state.userId = event.target.value;
    state.page = 1;
    loadData();
  });
  dom['previous-page'].addEventListener('click', () => {
    if (state.page > 1) {
      state.page -= 1;
      loadData();
    }
  });
  dom['next-page'].addEventListener('click', () => {
    if (state.page < state.totalPages) {
      state.page += 1;
      loadData();
    }
  });
  dom['page-size'].addEventListener('change', (event) => {
    state.limit = Number(event.target.value);
    state.page = 1;
    loadData();
  });

  dom['table-head'].addEventListener('click', (event) => {
    const header = event.target.closest('[data-sort]');
    if (!header) return;
    if (state.sortBy === header.dataset.sort) {
      state.sortOrder = state.sortOrder === 'desc' ? 'asc' : 'desc';
    } else {
      state.sortBy = header.dataset.sort;
      state.sortOrder = 'desc';
    }
    state.page = 1;
    loadData();
  });

  dom['table-body'].addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const row = state.rows.get(button.dataset.id);
    if (!row) return;
    const action = button.dataset.action;
    if (action === 'view') viewRow(row);
    if (action === 'transcript') viewConversation(row);
    if (action === 'preview') previewFile(row);
    if (action === 'topup') topUpModal(row);
    if (action === 'refill') refillModal(row);
    if (action === 'delete-user') deleteUser(row);
  });

  dom.modal.addEventListener('click', (event) => {
    if (event.target === dom.modal || event.target.closest('[data-close-modal]')) closeModal();
    const action = event.target.closest('[data-modal-action]');
    if (action) runModalAction(action.dataset.modalAction);
  });
  dom['confirm-modal'].addEventListener('click', (event) => {
    if (event.target === dom['confirm-modal'] || event.target.closest('[data-close-confirm]')) closeConfirm();
  });
  dom['confirm-action'].addEventListener('click', async () => {
    const callback = state.pendingConfirm;
    closeConfirm();
    if (!callback) return;
    try {
      await callback();
    } catch (error) {
      toast(error.message, true);
    }
  });

  dom['rescan-orphans'].addEventListener('click', loadMaintenance);
  dom['cleanup-orphans'].addEventListener('click', async () => {
    const confirmation = dom['cleanup-confirmation'].value;
    if (confirmation !== 'DELETE ORPHANED DATA') {
      toast('Enter the confirmation phrase exactly as shown.', true);
      return;
    }
    confirmAction('Create a backup and permanently remove all currently orphaned records?', async () => {
      const result = await apiRequest('/api/maintenance/orphans/cleanup', {
        method: 'POST',
        body: JSON.stringify({
          confirmation,
          keepTransactions: dom['keep-transactions'].checked,
        }),
      });
      dom['cleanup-confirmation'].value = '';
      toast(`Cleanup completed. Backup: ${result.backupPath}`);
      renderOrphanReport(result.after);
      await loadCollections();
    });
  });
}

async function initializeDashboard() {
  await Promise.all([loadCollections(), loadUsers()]);
  await navigate('overview');
}

async function start() {
  cacheDom();
  bindEvents();
  setPreset('overview', '30');
  setPreset('data', '30');
  const preferredTheme = localStorage.getItem('admin-theme-v2')
    || 'light';
  applyTheme(preferredTheme);
  setSidebarCollapsed(localStorage.getItem('admin-sidebar-collapsed') === 'true');
  setCollectionsExpanded(localStorage.getItem('admin-collections-expanded') !== 'false');

  try {
    const status = await apiRequest('/api/auth/status');
    if (status.authenticated) {
      showApp(status.username);
      await initializeDashboard();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
}

start();
