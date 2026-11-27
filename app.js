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
  const rangeStartField = el('range-start-field');
  const rangeStartInput = el('range-start');
  const rangeEndField = el('range-end-field');
  const rangeEndInput = el('range-end');
  const groupSelect = el('group');
  const statusEl = el('status');
  const itemsBody = document.querySelector('#items tbody');
  const sortHeaders = document.querySelectorAll('#items .sort-header');

  let lastItems = [];
  let sortKey = null;
  let sortDirection = 'asc';

  function preferences() {
    return window.Capacitor?.Plugins?.Preferences || null;
  }

  async function loadConfig() {
    const prefs = preferences();
    try {
      const raw = prefs
        ? (await prefs.get({ key: STORAGE_KEY })).value
        : localStorage.getItem(STORAGE_KEY);

      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async function saveConfig(config) {
    const prefs = preferences();
    const raw = JSON.stringify(config);
    try {
      if (prefs) {
        await prefs.set({ key: STORAGE_KEY, value: raw });
      } else {
        localStorage.setItem(STORAGE_KEY, raw);
      }
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

  async function isConfigured() {
    const config = await loadConfig();

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
    if (periodSelect.value === 'range' && rangeStartInput.value && rangeEndInput.value) {
      url.searchParams.set('start', rangeStartInput.value);
      url.searchParams.set('end', rangeEndInput.value);
    }

    return url.toString();
  }

  function network() {
    return window.Capacitor?.Plugins?.Network || null;
  }

  async function isOffline() {
    const net = network();
    if (!net) {
      return false;
    }
    try {
      const status = await net.getStatus();

      return !status.connected;
    } catch {
      return false;
    }
  }

  async function fetchReport() {
    const config = await loadConfig();
    if (!config) {
      setStatus('Configure a node URL and API key first.', true);

      return;
    }

    if (await isOffline()) {
      setStatus('Offline - check your connection.', true);

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

  function formatUptime(value) {
    return value.toFixed(4) + '%';
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
      case 'uptime':
      case 'confirmed': {
        const field = sortKey === 'confirmed' ? 'confirmed_uptime_percent' : 'uptime_percent';
        const leftUptime = left[field];
        const rightUptime = right[field];
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
    const totals = { checks_total: 0, checks_pass: 0, checks_unknown: 0, checks_excluded_maintenance: 0, checks_confirmed_down: 0 };
    for (const item of items) {
      totals.checks_total += item.checks_total || 0;
      totals.checks_pass += item.checks_pass || 0;
      totals.checks_unknown += item.checks_unknown || 0;
      totals.checks_excluded_maintenance += item.checks_excluded_maintenance || 0;
      totals.checks_confirmed_down += item.checks_confirmed_down || 0;
    }

    const denominator = totals.checks_total - totals.checks_unknown - totals.checks_excluded_maintenance;
    totals.uptime_percent = denominator > 0 ? (totals.checks_pass / denominator) * 100 : null;

    // Mirrors UptimeReport::confirmedUptimePercent(): only confirmed-down checks reduce it, so errors and isolated misses do not.
    const confirmedDenominator = totals.checks_total - totals.checks_excluded_maintenance;
    totals.confirmed_uptime_percent = confirmedDenominator > 0 ? ((confirmedDenominator - totals.checks_confirmed_down) / confirmedDenominator) * 100 : null;

    return totals;
  }

  function renderAll() {
    const items = visibleItems().map((item, index) => ({ item, index }))
      .sort((left, right) => compareItems(left.item, right.item) || left.index - right.index)
      .map(({ item }) => item);
    const overall = computeOverall(items);

    el('summary-confirmed-uptime').textContent = overall.confirmed_uptime_percent === null ? 'n/a' : formatUptime(overall.confirmed_uptime_percent);
    el('summary-uptime').textContent = overall.uptime_percent === null ? 'n/a' : formatUptime(overall.uptime_percent);
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

      const confirmed = document.createElement('td');
      confirmed.dataset.label = 'Confirmed uptime %';
      confirmed.textContent = item.confirmed_uptime_percent === null || item.confirmed_uptime_percent === undefined ? 'n/a' : formatUptime(item.confirmed_uptime_percent);
      row.append(confirmed);

      const uptime = document.createElement('td');
      uptime.dataset.label = 'Raw uptime %';
      uptime.textContent = item.uptime_percent === null || item.uptime_percent === undefined ? 'n/a' : formatUptime(item.uptime_percent);
      row.append(uptime);

      const checks = document.createElement('td');
      checks.dataset.label = 'Checks (pass / total)';
      checks.textContent = item.checks_pass + ' / ' + item.checks_total;
      row.append(checks);

      itemsBody.append(row);
    }
  }

  function toDateString(date) {
    return date.toISOString().slice(0, 10);
  }

  function syncPeriodFields() {
    monthField.hidden = periodSelect.value !== 'month';
    dateField.hidden = periodSelect.value !== 'day';
    rangeStartField.hidden = periodSelect.value !== 'range';
    rangeEndField.hidden = periodSelect.value !== 'range';

    const today = new Date();
    if (periodSelect.value === 'month' && !monthInput.value) {
      monthInput.value = today.toISOString().slice(0, 7);
    }
    if (periodSelect.value === 'day' && !dateInput.value) {
      dateInput.value = today.toISOString().slice(0, 10);
    }
    if (periodSelect.value === 'range') {
      if (!rangeEndInput.value) {
        rangeEndInput.value = toDateString(today);
      }
      if (!rangeStartInput.value) {
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 6);
        rangeStartInput.value = toDateString(weekAgo);
      }
    }
  }

  // Keeps the "To" date from landing before the "From" date.
  function syncRangeBounds() {
    if (rangeStartInput.value) {
      rangeEndInput.min = rangeStartInput.value;
    }
    if (rangeEndInput.value) {
      rangeStartInput.max = rangeEndInput.value;
    }
    if (rangeStartInput.value && rangeEndInput.value && rangeEndInput.value < rangeStartInput.value) {
      rangeEndInput.value = rangeStartInput.value;
    }
  }

  async function openSettingsIfUnconfigured() {
    if (!(await isConfigured())) {
      settingsSection.hidden = false;
    }
  }

  el('toggle-settings').addEventListener('click', () => {
    settingsSection.hidden = !settingsSection.hidden;
  });

  settingsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveConfig({ nodeUrl: nodeUrlInput.value.trim(), apiKey: apiKeyInput.value.trim() });
    settingsSection.hidden = true;
    fetchReport();
  });

  periodSelect.addEventListener('change', () => {
    syncPeriodFields();
    fetchReport();
  });
  monthInput.addEventListener('change', fetchReport);
  dateInput.addEventListener('change', fetchReport);
  rangeStartInput.addEventListener('change', () => {
    syncRangeBounds();
    fetchReport();
  });
  rangeEndInput.addEventListener('change', () => {
    syncRangeBounds();
    fetchReport();
  });
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

  function triggerHaptic() {
    const haptics = window.Capacitor?.Plugins?.Haptics;
    if (!haptics) {
      return;
    }
    haptics.impact({ style: 'LIGHT' }).catch(() => {});
  }

  function setupPullToRefresh() {
    const indicator = el('ptr-indicator');
    const arrow = el('ptr-arrow');
    const spinner = el('ptr-spinner');
    const threshold = 70;
    const maxPull = 110;

    let startY = null;
    let pulling = false;
    let refreshing = false;
    let armed = false;

    function reset() {
      indicator.classList.remove('visible');
      indicator.style.marginTop = '';
      arrow.classList.remove('flip');
      startY = null;
      pulling = false;
      armed = false;
    }

    window.addEventListener('touchstart', (event) => {
      if (refreshing || window.scrollY > 0 || event.touches.length !== 1) {
        startY = null;

        return;
      }
      startY = event.touches[0].clientY;
      pulling = false;
      armed = false;
    }, { passive: true });

    window.addEventListener('touchmove', (event) => {
      if (startY === null || refreshing) {
        return;
      }

      const delta = event.touches[0].clientY - startY;
      if (delta <= 0) {
        return;
      }

      if (window.scrollY > 0) {
        startY = null;
        reset();

        return;
      }

      pulling = true;
      const distance = Math.min(delta * 0.5, maxPull);
      indicator.classList.add('visible');
      indicator.style.marginTop = (-56 + distance) + 'px';
      const reached = distance >= threshold;
      arrow.classList.toggle('flip', reached);
      if (reached && !armed) {
        armed = true;
        triggerHaptic();
      } else if (!reached) {
        armed = false;
      }
    }, { passive: true });

    window.addEventListener('touchend', () => {
      if (!pulling || refreshing) {
        reset();

        return;
      }

      const distance = parseFloat(indicator.style.marginTop || '-56') + 56;
      if (distance >= threshold) {
        refreshing = true;
        indicator.classList.add('refreshing');
        spinner.hidden = false;
        fetchReport().finally(() => {
          refreshing = false;
          spinner.hidden = true;
          indicator.classList.remove('refreshing');
          reset();
        });
      } else {
        reset();
      }
    });

    window.addEventListener('touchcancel', reset);
  }

  function setupAppLifecycle() {
    const app = window.Capacitor?.Plugins?.App;
    if (!app) {
      return;
    }

    app.addListener('backButton', () => {
      if (!settingsSection.hidden) {
        settingsSection.hidden = true;

        return;
      }
      app.minimizeApp();
    });

    app.addListener('resume', async () => {
      if (await isConfigured()) {
        fetchReport();
      }
    });
  }

  setupPullToRefresh();
  setupAppLifecycle();

  (async () => {
    const existing = await loadConfig();
    if (existing) {
      nodeUrlInput.value = existing.nodeUrl;
      apiKeyInput.value = existing.apiKey;
    }

    syncPeriodFields();
    await openSettingsIfUnconfigured();
    if (await isConfigured()) {
      fetchReport();
    }
  })();
})();
