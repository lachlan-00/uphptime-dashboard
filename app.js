(() => {
  'use strict';

  const STORAGE_KEY = 'uphptime-dashboard:config';

  const el = (id) => document.getElementById(id);
  const settingsSection = el('settings');
  const settingsForm = el('settings-form');
  const nodeUrlInput = el('node-url');
  const apiKeyInput = el('api-key');
  const periodSelect = el('period');
  const monthField = el('month-field');
  const monthInput = el('month');
  const dateField = el('date-field');
  const dateInput = el('date');
  const groupSelect = el('group');
  const statusEl = el('status');
  const itemsBody = document.querySelector('#items tbody');
  const sortHeaders = document.querySelectorAll('#items .sort-header');

  let lastItems = [];
  let sortKey = null;
  let sortDirection = 'asc';

  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveConfig(config) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
      // Private browsing / blocked storage: the form still works for this page load.
    }
  }

  function setStatus(message, isError) {
    statusEl.textContent = message;
    if (isError) {
      statusEl.setAttribute('data-error', 'true');
    } else {
      statusEl.removeAttribute('data-error');
    }
  }

  function isConfigured() {
    const config = loadConfig();

    return Boolean(config && config.nodeUrl && config.apiKey);
  }

  function reportUrl(config) {
    const url = new URL('/report/v1/overview', config.nodeUrl);
    url.searchParams.set('period', periodSelect.value);
    if (periodSelect.value === 'month' && monthInput.value) {
      url.searchParams.set('month', monthInput.value);
    }
    if (periodSelect.value === 'day' && dateInput.value) {
      url.searchParams.set('date', dateInput.value);
    }

    return url.toString();
  }

  async function fetchReport() {
    const config = loadConfig();
    if (!config) {
      setStatus('Configure a node URL and API key first.', true);

      return;
    }

    setStatus('Loading...', false);

    let response;
    try {
      response = await fetch(reportUrl(config), {
        headers: { Authorization: 'Bearer ' + config.apiKey },
      });
    } catch {
      setStatus('Could not reach the node (network error or CORS).', true);

      return;
    }

    if (response.status === 401) {
      setStatus('Rejected: wrong report API key.', true);

      return;
    }
    if (response.status === 404) {
      setStatus('This node has no report API configured (report_api_key is empty).', true);

      return;
    }
    if (!response.ok) {
      setStatus('Unexpected response: HTTP ' + response.status, true);

      return;
    }

    const body = await response.json();
    lastItems = Array.isArray(body.items) ? body.items : [];
    populateGroups(lastItems);
    renderAll();
    setStatus('Updated ' + new Date().toLocaleTimeString(), false);
  }

  function populateGroups(items) {
    const current = groupSelect.value;
    const groups = new Set();
    for (const item of items) {
      for (const group of item.groups || []) {
        groups.add(group);
      }
    }

    groupSelect.innerHTML = '<option value="">All groups</option>';
    for (const group of [...groups].sort()) {
      const option = document.createElement('option');
      option.value = group;
      option.textContent = group;
      groupSelect.append(option);
    }
    if (groups.has(current)) {
      groupSelect.value = current;
    }
  }

  function visibleItems() {
    const group = groupSelect.value;

    return group === '' ? lastItems : lastItems.filter((item) => (item.groups || []).includes(group));
  }

  function compareItems(left, right) {
    let comparison;

    switch (sortKey) {
      case 'name':
        comparison = String(left.name || '').localeCompare(String(right.name || ''), undefined, { numeric: true, sensitivity: 'base' });
        break;
      case 'groups':
        comparison = (left.groups || []).join(', ').localeCompare((right.groups || []).join(', '), undefined, { numeric: true, sensitivity: 'base' });
        break;
      case 'state':
        comparison = String(left.state || '').localeCompare(String(right.state || ''), undefined, { numeric: true, sensitivity: 'base' });
        break;
      case 'uptime': {
        const leftUptime = left.uptime_percent;
        const rightUptime = right.uptime_percent;
        if (leftUptime === null || leftUptime === undefined) {
          return rightUptime === null || rightUptime === undefined ? 0 : 1;
        }
        if (rightUptime === null || rightUptime === undefined) {
          return -1;
        }
        comparison = leftUptime - rightUptime;
        break;
      }
      case 'checks':
        comparison = (left.checks_pass || 0) - (right.checks_pass || 0)
          || (left.checks_total || 0) - (right.checks_total || 0);
        break;
      default:
        return 0;
    }

    return sortDirection === 'asc' ? comparison : -comparison;
  }

  function updateSortHeaders() {
    for (const headerButton of sortHeaders) {
      const header = headerButton.closest('th');
      const active = headerButton.dataset.sort === sortKey;
      const direction = active ? sortDirection : null;
      header.setAttribute('aria-sort', direction === null ? 'none' : direction === 'asc' ? 'ascending' : 'descending');
      headerButton.setAttribute('aria-label', direction === null
        ? 'Sort by ' + headerButton.textContent
        : 'Sort by ' + headerButton.textContent + ', ' + direction);
      headerButton.dataset.direction = direction || '';
    }
  }

  // Mirrors UptimeReport::uptimePercent()/merge() on the server: not an average of per-site
  // percentages, but recomputed from the summed raw check counts of whatever's currently visible.
  function computeOverall(items) {
    const totals = { checks_total: 0, checks_pass: 0, checks_unknown: 0, checks_excluded_maintenance: 0 };
    for (const item of items) {
      totals.checks_total += item.checks_total || 0;
      totals.checks_pass += item.checks_pass || 0;
      totals.checks_unknown += item.checks_unknown || 0;
      totals.checks_excluded_maintenance += item.checks_excluded_maintenance || 0;
    }

    const denominator = totals.checks_total - totals.checks_unknown - totals.checks_excluded_maintenance;
    totals.uptime_percent = denominator > 0 ? Math.round((totals.checks_pass / denominator) * 10000) / 100 : null;

    return totals;
  }

  function renderAll() {
    const items = visibleItems().map((item, index) => ({ item, index }))
      .sort((left, right) => compareItems(left.item, right.item) || left.index - right.index)
      .map(({ item }) => item);
    const overall = computeOverall(items);

    el('summary-uptime').textContent = overall.uptime_percent === null ? 'n/a' : overall.uptime_percent + '%';
    el('summary-checks').textContent = overall.checks_pass + ' / ' + overall.checks_total;
    el('summary-count').textContent = String(items.length);
    el('summary-generated').textContent = new Date().toLocaleString();

    itemsBody.innerHTML = '';
    for (const item of items) {
      const row = document.createElement('tr');

      const name = document.createElement('td');
      name.dataset.label = 'Name';
      name.textContent = item.name;
      row.append(name);

      const groups = document.createElement('td');
      groups.dataset.label = 'Groups';
      groups.textContent = (item.groups || []).join(', ') || '-';
      row.append(groups);

      const state = document.createElement('td');
      state.dataset.label = 'State';
      const pill = document.createElement('span');
      pill.className = 'state-pill state-' + item.state;
      pill.textContent = item.state;
      state.append(pill);
      row.append(state);

      const uptime = document.createElement('td');
      uptime.dataset.label = 'Uptime %';
      uptime.textContent = item.uptime_percent === null || item.uptime_percent === undefined ? 'n/a' : item.uptime_percent + '%';
      row.append(uptime);

      const checks = document.createElement('td');
      checks.dataset.label = 'Checks (pass / total)';
      checks.textContent = item.checks_pass + ' / ' + item.checks_total;
      row.append(checks);

      itemsBody.append(row);
    }
  }

  function syncPeriodFields() {
    monthField.hidden = periodSelect.value !== 'month';
    dateField.hidden = periodSelect.value !== 'day';

    const today = new Date();
    if (periodSelect.value === 'month' && !monthInput.value) {
      monthInput.value = today.toISOString().slice(0, 7);
    }
    if (periodSelect.value === 'day' && !dateInput.value) {
      dateInput.value = today.toISOString().slice(0, 10);
    }
  }

  function openSettingsIfUnconfigured() {
    if (!isConfigured()) {
      settingsSection.hidden = false;
    }
  }

  el('toggle-settings').addEventListener('click', () => {
    settingsSection.hidden = !settingsSection.hidden;
  });

  settingsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    saveConfig({ nodeUrl: nodeUrlInput.value.trim(), apiKey: apiKeyInput.value.trim() });
    settingsSection.hidden = true;
    fetchReport();
  });

  periodSelect.addEventListener('change', () => {
    syncPeriodFields();
    fetchReport();
  });
  monthInput.addEventListener('change', fetchReport);
  dateInput.addEventListener('change', fetchReport);
  groupSelect.addEventListener('change', renderAll);
  el('refresh').addEventListener('click', fetchReport);
  for (const headerButton of sortHeaders) {
    headerButton.addEventListener('click', () => {
      if (sortKey === headerButton.dataset.sort) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        sortKey = headerButton.dataset.sort;
        sortDirection = 'asc';
      }
      updateSortHeaders();
      renderAll();
    });
  }

  const existing = loadConfig();
  if (existing) {
    nodeUrlInput.value = existing.nodeUrl;
    apiKeyInput.value = existing.apiKey;
  }

  syncPeriodFields();
  openSettingsIfUnconfigured();
  if (isConfigured()) {
    fetchReport();
  }
})();
