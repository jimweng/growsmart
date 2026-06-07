'use strict';

/* ─── State ─────────────────────────────────────────────────────────────────── */
const state = {
  children: [],
  selectedId: null,
  measurements: [],
  type: 'height',       // 'height' | 'weight'
  chart: null,
  curves: null,
  editingChildId: null, // null = create, else = edit
  activeTab: 'growth',  // 'growth' | 'ai'
};

/* ─── Helpers ────────────────────────────────────────────────────────────────── */
function ageInMonths(birthDateStr) {
  const birth = new Date(birthDateStr);
  const now = new Date();
  return (now.getFullYear() - birth.getFullYear()) * 12 +
    (now.getMonth() - birth.getMonth()) +
    (now.getDate() >= birth.getDate() ? 0 : -1);
}

function ageAtDate(birthDateStr, measureDateStr) {
  const birth = new Date(birthDateStr);
  const m = new Date(measureDateStr);
  return (m.getFullYear() - birth.getFullYear()) * 12 +
    (m.getMonth() - birth.getMonth()) +
    (m.getDate() >= birth.getDate() ? 0 : -1);
}

function formatAge(months) {
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m} 個月`;
  if (m === 0) return `${y} 歲`;
  return `${y} 歲 ${m} 個月`;
}

function percentileBadge(pct) {
  if (pct === null || pct === undefined) return '<span class="badge badge-gray">—</span>';
  const cls = pct < 10 ? 'badge-red' : pct < 25 ? 'badge-yellow' : 'badge-green';
  return `<span class="badge ${cls} badge-clickable" data-pct="${pct}" title="點擊了解更多">P${pct}</span>`;
}

function childAvatar(gender) {
  return gender === 'male' ? '👦' : '👧';
}

function accentColor(gender) {
  return gender === 'male' ? '#3b82f6' : '#ec4899';
}

/* ─── API ────────────────────────────────────────────────────────────────────── */
async function apiFetch(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 204) return null;
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}

const api = {
  getChildren: () => apiFetch('/api/children'),
  createChild: (d) => apiFetch('/api/children', { method: 'POST', body: JSON.stringify(d) }),
  updateChild: (id, d) => apiFetch(`/api/children/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
  deleteChild: (id) => apiFetch(`/api/children/${id}`, { method: 'DELETE' }),
  getMeasurements: (cid) => apiFetch(`/api/children/${cid}/measurements`),
  addMeasurement: (cid, d) => apiFetch(`/api/children/${cid}/measurements`, { method: 'POST', body: JSON.stringify(d) }),
  deleteMeasurement: (cid, mid) => apiFetch(`/api/children/${cid}/measurements/${mid}`, { method: 'DELETE' }),
  getCurves: (gender, type) => {
    const to = type === 'height' ? 216 : 120;
    return apiFetch(`/api/curves?gender=${gender}&type=${type}&from=0&to=${to}&step=6`);
  },
  getPercentile: (d) => apiFetch('/api/percentile', { method: 'POST', body: JSON.stringify(d) }),
  predict: (d) => apiFetch('/api/predict', { method: 'POST', body: JSON.stringify(d) }),
  getAIHistory: (cid) => apiFetch(`/api/children/${cid}/ai-history`),
  clearAIHistory: (cid) => apiFetch(`/api/children/${cid}/ai-history`, { method: 'DELETE' }),
};

/* ─── DOM refs ────────────────────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const el = {
  childrenList: $('children-list'),
  emptyState: $('empty-state'),
  dashboard: $('dashboard'),
  childForm: $('child-form'),
  childFormTitle: $('child-form-title'),
  cfName: $('cf-name'),
  cfGender: $('cf-gender'),
  cfBirth: $('cf-birth'),
  cfFatherHeight: $('cf-father-height'),
  cfMotherHeight: $('cf-mother-height'),
  childName: $('child-name'),
  childMeta: $('child-meta'),
  statsRow: $('stats-row'),
  measureDate: $('m-date'),
  measureHeight: $('m-height'),
  measureWeight: $('m-weight'),
  measureTbody: $('measure-tbody'),
  noMeasures: $('no-measures'),
  measureTable: $('measure-table'),
};

/* ─── Event wiring ─────────────────────────────────────────────────────────────── */
$('btn-add-child').addEventListener('click', () => openChildForm());
$('btn-add-child-main').addEventListener('click', () => openChildForm());
$('cf-cancel').addEventListener('click', closeChildForm);
$('cf-save').addEventListener('click', saveChild);
$('btn-add-measure').addEventListener('click', addMeasurement);

// Dropdown More Actions Menu
const moreActionsBtn = $('btn-more-actions');
const moreActionsMenu = $('more-actions-menu');

if (moreActionsBtn && moreActionsMenu) {
  moreActionsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    moreActionsMenu.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!moreActionsMenu.classList.contains('hidden') && !moreActionsMenu.contains(e.target) && e.target !== moreActionsBtn) {
      moreActionsMenu.classList.add('hidden');
    }
  });
}

$('btn-edit-child').addEventListener('click', () => {
  if (moreActionsMenu) moreActionsMenu.classList.add('hidden');
  const child = state.children.find(c => c.id === state.selectedId);
  if (child) openChildForm(child);
});
$('btn-delete-child').addEventListener('click', () => {
  if (moreActionsMenu) moreActionsMenu.classList.add('hidden');
  deleteChild();
});

document.querySelectorAll('.toggle-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.type = btn.dataset.type;
    state.curves = null;
    await renderChart();
  });
});

/* ─── Child form ─────────────────────────────────────────────────────────────── */
function openChildForm(child = null) {
  state.editingChildId = child ? child.id : null;
  el.childFormTitle.textContent = child ? '編輯孩子' : '新增孩子';
  el.cfName.value = child ? child.name : '';
  el.cfGender.value = child ? child.gender : 'male';
  el.cfBirth.value = child ? child.birthDate : '';
  el.cfFatherHeight.value = child?.fatherHeight ?? '';
  el.cfMotherHeight.value = child?.motherHeight ?? '';
  el.childForm.classList.remove('hidden');
  el.cfName.focus();

  // Open mobile sidebar drawer so the form is visible to the user
  const sidebar = document.querySelector('.sidebar');
  const overlay = $('sidebar-overlay');
  if (sidebar && overlay) {
    sidebar.classList.add('open');
    overlay.classList.add('active');
  }
}

function closeChildForm() {
  el.childForm.classList.add('hidden');
  state.editingChildId = null;
}

async function saveChild() {
  const data = {
    name: el.cfName.value.trim(),
    gender: el.cfGender.value,
    birthDate: el.cfBirth.value,
    fatherHeight: el.cfFatherHeight.value ? parseFloat(el.cfFatherHeight.value) : null,
    motherHeight: el.cfMotherHeight.value ? parseFloat(el.cfMotherHeight.value) : null,
  };
  if (!data.name || !data.birthDate) {
    alert('請填寫姓名和出生日期');
    return;
  }
  try {
    if (state.editingChildId) {
      const updated = await api.updateChild(state.editingChildId, data);
      const idx = state.children.findIndex(c => c.id === state.editingChildId);
      if (idx !== -1) state.children[idx] = updated;
      if (state.selectedId === state.editingChildId) await selectChild(state.selectedId);
    } else {
      const created = await api.createChild(data);
      state.children.push(created);
      await selectChild(created.id);
    }
    closeChildForm();
    renderChildrenList();
  } catch (e) {
    alert('儲存失敗：' + e.message);
  }
}

async function deleteChild() {
  if (!state.selectedId) return;
  if (!confirm('確定刪除此孩子及所有測量記錄？')) return;
  try {
    await api.deleteChild(state.selectedId);
    state.children = state.children.filter(c => c.id !== state.selectedId);
    state.selectedId = null;
    state.measurements = [];
    renderChildrenList();
    showEmptyOrDashboard();
  } catch (e) {
    alert('刪除失敗：' + e.message);
  }
}

/* ─── Children list ──────────────────────────────────────────────────────────── */
function renderChildrenList() {
  el.childrenList.innerHTML = '';
  state.children.forEach(child => {
    const li = document.createElement('li');
    li.className = 'child-item' + (child.id === state.selectedId ? ' active' : '');
    const months = ageInMonths(child.birthDate);
    li.innerHTML = `
      <div class="child-avatar">${childAvatar(child.gender)}</div>
      <div class="child-info">
        <div class="child-item-name">${child.name}</div>
        <div class="child-item-age">${formatAge(months)}</div>
      </div>`;
    li.addEventListener('click', () => selectChild(child.id));
    el.childrenList.appendChild(li);
  });
}

/* ─── Select child ───────────────────────────────────────────────────────────── */
async function selectChild(id) {
  state.selectedId = id;
  state.curves = null;
  const child = state.children.find(c => c.id === id);
  if (!child) return;

  const [measurements, historyMsgs] = await Promise.all([
    api.getMeasurements(id),
    api.getAIHistory(id).catch(() => []),
  ]);
  state.measurements = measurements;

  // Populate client cache from DB (source of truth), preserve timestamps
  chatHistories[id] = historyMsgs.map(m => ({ role: m.role, content: m.content, createdAt: m.createdAt }));

  renderChildrenList();
  showEmptyOrDashboard();
  renderDashboard(child);
  resetAIChat();

  const moreActionsMenu = $('more-actions-menu');
  if (moreActionsMenu) {
    moreActionsMenu.classList.add('hidden');
  }

  if (state.closeSidebar) {
    state.closeSidebar();
  }
}

function showEmptyOrDashboard() {
  if (state.selectedId && state.children.some(c => c.id === state.selectedId)) {
    el.emptyState.classList.add('hidden');
    el.dashboard.classList.remove('hidden');
  } else {
    el.emptyState.classList.remove('hidden');
    el.dashboard.classList.add('hidden');
    destroyChart();
  }
}

/* ─── Dashboard ──────────────────────────────────────────────────────────────── */
async function renderDashboard(child) {
  const months = ageInMonths(child.birthDate);
  el.childName.textContent = child.name;
  el.childMeta.textContent = `${child.gender === 'male' ? '男' : '女'} · 出生 ${child.birthDate} · 目前 ${formatAge(months)}`;

  await renderStats(child);
  if (state.activeTab === 'growth') {
    await renderChart();
  }
  renderMeasurementTable(child);
}

/* ─── Stats ──────────────────────────────────────────────────────────────────── */
async function renderStats(child) {
  const ms = [...state.measurements].sort((a, b) => a.date < b.date ? -1 : 1);
  const latest = ms[ms.length - 1];
  if (!latest) {
    el.statsRow.innerHTML = '<p class="no-data">新增第一筆測量來查看統計</p>';
    $('growth-alert').classList.add('hidden');
    $('lifestyle-cards').classList.add('hidden');
    return;
  }

  const ageM = ageAtDate(child.birthDate, latest.date);
  let hPct = null, wPct = null;
  try {
    const pctRes = await api.getPercentile({
      gender: child.gender,
      ageMonths: ageM,
      height: latest.height || 0,
      weight: latest.weight || 0,
    });
    if (latest.height) hPct = pctRes.heightPercentile;
    if (latest.weight) wPct = pctRes.weightPercentile;
  } catch (_) {}

  // Growth rate + predicted adult height via linear regression (all data points)
  let growthRate = null;
  let adultPred = null;
  const hPoints = ms.filter(m => m.height).map(m => ({
    ageMonths: ageAtDate(child.birthDate, m.date),
    value: m.height,
  }));
  if (hPoints.length >= 2) {
    try {
      const predRes = await api.predict({ points: hPoints, predictUpTo: 216 });
      // slope is cm/month → ×12 = cm/year
      if (predRes.slope) growthRate = (predRes.slope * 12).toFixed(1);
      const at18 = predRes.predictions.find(p => p.ageMonths === 216);
      if (at18) adultPred = at18.value;
    } catch (_) {}
  }

  // Feature 1: MPH
  const mph = calcMPH(child);

  el.statsRow.innerHTML = `
    ${latest.height ? `
    <div class="stat-card">
      <div class="stat-label">最新身高</div>
      <div class="stat-value">${latest.height} <small>cm</small></div>
      <div class="stat-sub">測量日 ${latest.date}</div>
      ${hPct !== null ? percentileBadge(hPct) : ''}
    </div>` : ''}
    ${latest.weight ? `
    <div class="stat-card">
      <div class="stat-label">最新體重</div>
      <div class="stat-value">${latest.weight} <small>kg</small></div>
      ${wPct !== null ? percentileBadge(wPct) : ''}
    </div>` : ''}
    ${growthRate !== null ? `
    <div class="stat-card">
      <div class="stat-label">近期成長速</div>
      <div class="stat-value">${growthRate} <small>cm/年</small></div>
    </div>` : ''}
    ${adultPred !== null ? `
    <div class="stat-card">
      <div class="stat-label">預測成人身高</div>
      <div class="stat-value">${adultPred} <small>cm</small></div>
      <div class="stat-sub">基於線性回歸</div>
    </div>` : ''}
    ${mph ? `
    <div class="stat-card">
      <div class="stat-label">遺傳靶身高</div>
      <div class="stat-value">${mph.mid.toFixed(1)} <small>cm</small></div>
      <div class="stat-sub">±${child.gender === 'male' ? '7.5' : '6.0'} cm 範圍 (${mph.low.toFixed(1)}–${mph.high.toFixed(1)})</div>
    </div>` : ''}
  `;

  // Feature 2: deviation alert (async, non-blocking)
  checkGrowthDeviation(child, ms);

  // Feature 4: lifestyle cards
  renderLifestyleCards(ageInMonths(child.birthDate), hPct);
}

/* ─── Chart ──────────────────────────────────────────────────────────────────── */
function destroyChart() {
  if (state.chart) {
    state.chart.destroy();
    state.chart = null;
  }
}

async function renderChart() {
  const child = state.children.find(c => c.id === state.selectedId);
  if (!child) return;
  const mph = state.type === 'height' ? calcMPH(child) : null;

  destroyChart();

  // Load WHO curves
  if (!state.curves) {
    state.curves = await api.getCurves(child.gender, state.type);
  }
  const curves = state.curves;
  const color = accentColor(child.gender);

  // Build child's data series
  const ms = [...state.measurements]
    .sort((a, b) => a.date < b.date ? -1 : 1)
    .filter(m => state.type === 'height' ? m.height : m.weight);

  const childPoints = ms.map(m => ({
    x: ageAtDate(child.birthDate, m.date),
    y: state.type === 'height' ? m.height : m.weight,
  }));

  // Prediction — extend to 216 (age 18) when MPH target is present so the
  // prediction line visually connects to the genetic target zone.
  const predictUpTo = mph ? 216 : 120;
  let predPoints = [];
  if (childPoints.length >= 2) {
    try {
      const predRes = await api.predict({
        points: childPoints.map(p => ({ ageMonths: p.x, value: p.y })),
        predictUpTo,
      });
      predPoints = predRes.predictions.map(p => ({ x: p.ageMonths, y: p.value }));
    } catch (_) {}
  }

  const whoLineStyle = { pointRadius: 0, borderWidth: 1, tension: 0.4, fill: false };

  const datasets = [
    // WHO percentile curves (background)
    { label: 'P97', data: curves.p97.map(p => ({ x: p.x, y: p.y })), borderColor: '#94a3b8', borderDash: [4, 3], ...whoLineStyle },
    { label: 'P90', data: curves.p90.map(p => ({ x: p.x, y: p.y })), borderColor: '#cbd5e1', ...whoLineStyle },
    { label: 'P75', data: curves.p75.map(p => ({ x: p.x, y: p.y })), borderColor: '#94a3b8', ...whoLineStyle },
    { label: 'P50', data: curves.p50.map(p => ({ x: p.x, y: p.y })), borderColor: '#64748b', borderWidth: 1.5, ...whoLineStyle },
    { label: 'P25', data: curves.p25.map(p => ({ x: p.x, y: p.y })), borderColor: '#94a3b8', ...whoLineStyle },
    { label: 'P10', data: curves.p10.map(p => ({ x: p.x, y: p.y })), borderColor: '#cbd5e1', ...whoLineStyle },
    { label: 'P3',  data: curves.p3.map(p => ({ x: p.x, y: p.y })),  borderColor: '#94a3b8', borderDash: [4, 3], ...whoLineStyle },
    // Child's data
    {
      label: child.name,
      data: childPoints,
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2.5,
      pointRadius: 5,
      pointHoverRadius: 7,
      tension: 0.3,
      fill: false,
    },
    // Prediction
    ...(predPoints.length ? [{
      label: '預測',
      data: [childPoints[childPoints.length - 1], ...predPoints],
      borderColor: color,
      borderDash: [6, 4],
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointRadius: 3,
      tension: 0.3,
      fill: false,
    }] : []),
    // Feature 1: MPH target zone — two horizontal reference lines at age 18 (216 months)
    // Upper bound (mid + offset): amber dashed line with fill down to lower bound
    ...(mph ? [
      {
        label: '遺傳靶身高上限',
        data: [{ x: 0, y: mph.high }, { x: 216, y: mph.high }],
        borderColor: 'rgba(245, 158, 11, 0.6)',
        backgroundColor: 'rgba(245, 158, 11, 0.08)',
        borderWidth: 1.5,
        borderDash: [5, 4],
        pointRadius: 0,
        tension: 0,
        fill: '+1',   // fill down to the next dataset (lower bound)
      },
      {
        label: '遺傳靶身高下限',
        data: [{ x: 0, y: mph.low }, { x: 216, y: mph.low }],
        borderColor: 'rgba(245, 158, 11, 0.6)',
        backgroundColor: 'rgba(245, 158, 11, 0.08)',
        borderWidth: 1.5,
        borderDash: [5, 4],
        pointRadius: 0,
        tension: 0,
        fill: false,
      },
    ] : []),
  ];

  const ctx = $('growth-chart').getContext('2d');
  state.chart = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      parsing: false,
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: '年齡（月）', color: '#64748b', font: { size: 12 } },
          ticks: {
            color: '#64748b',
            callback: (v) => {
              if (v % 12 === 0) return `${v / 12}歲`;
              return v % 6 === 0 ? `${v}m` : null;
            },
          },
          grid: { color: '#f1f5f9' },
        },
        y: {
          title: {
            display: true,
            text: state.type === 'height' ? '身高（cm）' : '體重（kg）',
            color: '#64748b',
            font: { size: 12 },
          },
          ticks: { color: '#64748b' },
          grid: { color: '#f1f5f9' },
        },
      },
      plugins: {
        legend: {
          labels: {
            filter: (item) => !['P90','P10','P75','P25','遺傳靶身高下限'].includes(item.text),
            color: '#64748b',
            font: { size: 12 },
          },
        },
        tooltip: {
          callbacks: {
            title: (items) => {
              // WHO curves have data every 3 months — their x snaps to 0,3,6,...
              // Prefer x from child/prediction dataset which has the actual age.
              const whoLabels = new Set(['P97','P90','P75','P50','P25','P10','P3']);
              const precise = items.find(i => !whoLabels.has(i.dataset.label));
              const x = Math.round((precise ?? items[0]).parsed.x);
              return `${x} 個月 (${formatAge(x)})`;
            },
            label: (item) => {
              if (item.dataset.label === '遺傳靶身高下限') return null;
              if (item.dataset.label === '遺傳靶身高上限') {
                return `遺傳靶身高: ${mph ? mph.low.toFixed(1) : ''}–${mph ? mph.high.toFixed(1) : ''} cm`;
              }
              const unit = state.type === 'height' ? 'cm' : 'kg';
              return `${item.dataset.label}: ${item.parsed.y} ${unit}`;
            },
          },
        },
      },
    },
  });
}

/* ─── Measurement table ────────────────────────────────────────────────────────── */
function renderMeasurementTable(child) {
  const ms = [...state.measurements].sort((a, b) => b.date < a.date ? -1 : 1);
  if (ms.length === 0) {
    el.measureTable.classList.add('hidden');
    el.noMeasures.classList.remove('hidden');
    return;
  }
  el.measureTable.classList.remove('hidden');
  el.noMeasures.classList.add('hidden');

  el.measureTbody.innerHTML = ms.map(m => {
    const ageM = ageAtDate(child.birthDate, m.date);
    return `<tr>
      <td>${m.date}</td>
      <td>${formatAge(ageM)}</td>
      <td>${m.height ?? '—'}</td>
      <td>${m.weight ?? '—'}</td>
      <td data-mid="${m.id}" class="pct-h">—</td>
      <td data-mid="${m.id}" class="pct-w">—</td>
      <td><button class="btn-del" data-mid="${m.id}" title="刪除">×</button></td>
    </tr>`;
  }).join('');

  // Async-fill percentile cells
  ms.forEach(async (m) => {
    if (!m.height && !m.weight) return;
    try {
      const ageM = ageAtDate(child.birthDate, m.date);
      const pct = await api.getPercentile({
        gender: child.gender,
        ageMonths: ageM,
        height: m.height || 0,
        weight: m.weight || 0,
      });
      const hCell = el.measureTbody.querySelector(`[data-mid="${m.id}"].pct-h`);
      const wCell = el.measureTbody.querySelector(`[data-mid="${m.id}"].pct-w`);
      if (hCell && m.height) hCell.innerHTML = percentileBadge(pct.heightPercentile);
      if (wCell && m.weight) wCell.innerHTML = percentileBadge(pct.weightPercentile);
    } catch (_) {}
  });

  el.measureTbody.querySelectorAll('.btn-del').forEach(btn => {
    btn.addEventListener('click', () => deleteMeasurement(btn.dataset.mid));
  });
}

/* ─── Add / Delete measurement ────────────────────────────────────────────────── */
async function addMeasurement() {
  const child = state.children.find(c => c.id === state.selectedId);
  if (!child) return;

  const date = el.measureDate.value;
  const heightVal = el.measureHeight.value;
  const weightVal = el.measureWeight.value;

  if (!date) { alert('請選擇日期'); return; }
  if (!heightVal && !weightVal) { alert('請至少填寫身高或體重'); return; }

  const body = {
    date,
    height: heightVal ? parseFloat(heightVal) : null,
    weight: weightVal ? parseFloat(weightVal) : null,
  };

  try {
    const m = await api.addMeasurement(state.selectedId, body);
    const idx = state.measurements.findIndex(x => x.id === m.id);
    if (idx !== -1) state.measurements[idx] = m;
    else state.measurements.push(m);

    el.measureDate.value = '';
    el.measureHeight.value = '';
    el.measureWeight.value = '';

    state.curves = null;
    await renderStats(child);
    await renderChart();
    renderMeasurementTable(child);
  } catch (e) {
    alert('新增失敗：' + e.message);
  }
}

async function deleteMeasurement(mid) {
  if (!confirm('確定刪除此測量記錄？')) return;
  const child = state.children.find(c => c.id === state.selectedId);
  try {
    await api.deleteMeasurement(state.selectedId, mid);
    state.measurements = state.measurements.filter(m => m.id !== mid);
    state.curves = null;
    await renderStats(child);
    await renderChart();
    renderMeasurementTable(child);
  } catch (e) {
    alert('刪除失敗：' + e.message);
  }
}

/* ─── AI Chat (multi-turn) ───────────────────────────────────────────────────── */
// Per-child conversation history: { [childId]: [{role, content}, ...] }
const chatHistories = {};

function getChatHistory() {
  if (!state.selectedId) return [];
  return chatHistories[state.selectedId] || [];
}

function appendHistory(role, content) {
  if (!state.selectedId) return;
  if (!chatHistories[state.selectedId]) chatHistories[state.selectedId] = [];
  chatHistories[state.selectedId].push({ role, content, createdAt: new Date().toISOString() });
}

async function clearChatHistory() {
  if (!state.selectedId) return;
  try {
    await api.clearAIHistory(state.selectedId);
  } catch (e) {
    alert('清除失敗：' + e.message);
    return;
  }
  chatHistories[state.selectedId] = [];
  renderChatMessages();
}

function formatMsgDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;
}

function formatMsgTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function renderChatMessages() {
  const thread = $('ai-thread');
  const history = getChatHistory();
  if (!thread) return;
  if (history.length === 0) {
    thread.innerHTML = '<p class="ai-thread-empty">開始詢問孩子成長相關問題</p>';
    return;
  }

  let lastDate = '';
  const parts = [];
  history.forEach(m => {
    const dateLabel = formatMsgDate(m.createdAt);
    if (dateLabel && dateLabel !== lastDate) {
      parts.push(`<div class="ai-date-divider"><span>${dateLabel}</span></div>`);
      lastDate = dateLabel;
    }
    const timeLabel = formatMsgTime(m.createdAt);
    parts.push(`
      <div class="ai-msg ai-msg-${m.role}">
        <div class="ai-msg-label">${m.role === 'user' ? '你' : 'AI 顧問'}${timeLabel ? ` <span class="ai-msg-time">${timeLabel}</span>` : ''}</div>
        <div class="ai-msg-content">${escapeHtml(m.content)}</div>
      </div>`);
  });

  thread.innerHTML = parts.join('');
  thread.scrollTop = thread.scrollHeight;
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/\n/g,'<br>');
}

/* ─── Feature 3: Percentile modal ────────────────────────────────────────────── */
function pctModalText(pct) {
  const p = Math.round(pct);
  let range, feel;
  if (p <= 3)       { range = '低於 P3（後 3%）'; feel = '屬於同齡中較矮小的範圍，建議持續追蹤，若持續偏低可諮詢兒科醫師。'; }
  else if (p <= 10) { range = `P${p}（後 ${p}%）`; feel = '偏低，但仍在正常範圍內。成長是一段連續的過程，只要持續沿著自己的曲線前進，就是健康的。'; }
  else if (p <= 25) { range = `P${p}`; feel = '中低，完全正常。身材偏小通常受遺傳影響，和「不健康」沒有關係。'; }
  else if (p <= 75) { range = `P${p}（中間 50%）`; feel = '屬於人群的中間範圍，非常理想。'; }
  else if (p <= 90) { range = `P${p}`; feel = '中高，完全正常。'; }
  else if (p <= 97) { range = `P${p}（前 ${100-p}%）`; feel = '偏高，正常範圍。若增長速度非常快，可留意是否有性早熟跡象。'; }
  else              { range = '高於 P97（前 3%）'; feel = '屬於同齡中最高大的群體。若增長速度異常快，建議諮詢兒科醫師。'; }
  return { range, feel };
}

function initPctModal() {
  const backdrop = $('pct-modal-backdrop');
  const closeBtn = $('pct-modal-close');
  const title    = $('pct-modal-title');
  const body     = $('pct-modal-body');

  document.addEventListener('click', (e) => {
    const badge = e.target.closest('[data-pct]');
    if (!badge) return;
    const pct = parseFloat(badge.dataset.pct);
    const { range, feel } = pctModalText(pct);
    title.textContent = `百分位 ${range}`;
    body.textContent  = `在 100 位相同年齡、性別的孩子中，您的孩子排在第 ${Math.round(pct)} 名。${feel}`;
    backdrop.classList.remove('hidden');
  });
  const close = () => backdrop.classList.add('hidden');
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

/* ─── Feature 2: Growth deviation alert ─────────────────────────────────────── */
const PCT_BANDS = [3, 10, 25, 50, 75, 90, 97];

function bandsCrossed(oldPct, newPct) {
  if (oldPct === null || newPct === null) return 0;
  const lo = Math.min(oldPct, newPct), hi = Math.max(oldPct, newPct);
  return PCT_BANDS.filter(b => lo < b && b < hi).length;
}

function showGrowthAlert(msgs) {
  const el = $('growth-alert');
  if (!msgs || msgs.length === 0) { el.classList.add('hidden'); return; }
  const isRed = msgs.some(m => m.red);
  el.className = 'growth-alert' + (isRed ? ' alert-red' : '');
  el.innerHTML = `
    <div class="growth-alert-icon">${isRed ? '🚨' : '⚠️'}</div>
    <div class="growth-alert-body">
      <div class="growth-alert-title">成長軌跡提醒</div>
      <div class="growth-alert-text">
        ${msgs.map(m => `• ${m.text}`).join('<br>')}
        <br><br>請別緊張，成長速度受短期因素（感冒、季節）影響很常見。建議持續觀察 3 個月，若趨勢持續，可尋求「小兒內分泌科」或「兒童生長發育門診」諮詢。
      </div>
    </div>`;
}

async function checkGrowthDeviation(child, measurements) {
  const ms = [...measurements].sort((a, b) => a.date < b.date ? -1 : 1);
  if (ms.length < 2) { showGrowthAlert([]); return; }

  const alerts = [];

  // Get last two height measurements for band crossing check
  const hMs = ms.filter(m => m.height);
  if (hMs.length >= 2) {
    const prev = hMs[hMs.length - 2];
    const curr = hMs[hMs.length - 1];
    try {
      const [prevPct, currPct] = await Promise.all([
        api.getPercentile({ gender: child.gender, ageMonths: ageAtDate(child.birthDate, prev.date), height: prev.height, weight: prev.weight || 0 }),
        api.getPercentile({ gender: child.gender, ageMonths: ageAtDate(child.birthDate, curr.date), height: curr.height, weight: curr.weight || 0 }),
      ]);
      const crossed = bandsCrossed(prevPct.heightPercentile, currPct.heightPercentile);
      if (crossed >= 2) {
        const dir = currPct.heightPercentile < prevPct.heightPercentile ? '下滑' : '上升（留意性早熟）';
        alerts.push({ red: true, text: `身高百分位從 P${Math.round(prevPct.heightPercentile)} ${dir}至 P${Math.round(currPct.heightPercentile)}，跨越 ${crossed} 條曲線帶。` });
      }
    } catch (_) {}
  }

  // Annual growth rate < 4 cm check (age > 48 months)
  const ageNow = ageInMonths(child.birthDate);
  if (ageNow >= 48 && hMs.length >= 2) {
    try {
      const pts = hMs.map(m => ({ ageMonths: ageAtDate(child.birthDate, m.date), value: m.height }));
      const pred = await api.predict({ points: pts, predictUpTo: ageNow + 1 });
      if (pred.slope !== undefined && pred.slope * 12 < 4) {
        alerts.push({ red: false, text: `估計年化身高增長約 ${(pred.slope * 12).toFixed(1)} cm，低於學齡期建議的 4 cm/年。` });
      }
    } catch (_) {}
  }

  showGrowthAlert(alerts);
}

/* ─── Feature 1: MPH calculation ────────────────────────────────────────────── */
function calcMPH(child) {
  const f = child.fatherHeight, m = child.motherHeight;
  if (!f || !m) return null;
  if (child.gender === 'male') {
    const mid = (f + m + 13) / 2;
    return { low: mid - 7.5, mid, high: mid + 7.5 };
  } else {
    const mid = (f + m - 13) / 2;
    return { low: mid - 6.0, mid, high: mid + 6.0 };
  }
}

/* ─── Feature 4: Lifestyle advisor cards ────────────────────────────────────── */
function renderLifestyleCards(ageMonths, hPct) {
  const container = $('lifestyle-cards');

  // Sleep
  let sleepHrs, bedtime;
  if (ageMonths < 12)       { sleepHrs = '12–16 小時'; bedtime = '晚上 8 點前'; }
  else if (ageMonths < 24)  { sleepHrs = '11–14 小時'; bedtime = '晚上 8–9 點'; }
  else if (ageMonths < 72)  { sleepHrs = '10–13 小時'; bedtime = '晚上 9 點前'; }
  else if (ageMonths < 144) { sleepHrs = '9–11 小時';  bedtime = '晚上 9–10 點'; }
  else                       { sleepHrs = '8–10 小時';  bedtime = '晚上 10 點前'; }

  // Exercise
  let exercise;
  if (ageMonths < 36)       exercise = '每天 3 小時活動性遊戲（爬行、走路、跑跳）';
  else if (ageMonths < 72)  exercise = '每天至少 1 小時中高強度活動：跳繩、跑步、游泳';
  else if (ageMonths < 144) exercise = '每天 60 分鐘高衝擊運動：跳繩、籃球、彈跳床（促進骨骼縱向生長）';
  else                       exercise = '每週 3–5 次有氧＋跳躍運動（如跳繩、排球），避免過度重訓';

  // Nutrition
  let calcium, note;
  if (ageMonths < 36)       { calcium = '700 mg/天'; note = '母乳或配方奶為主，開始添加副食品'; }
  else if (ageMonths < 96)  { calcium = '1000 mg/天'; note = '每日 2 杯牛奶（約 500 mL），豆腐、深色蔬菜補充'; }
  else                       { calcium = '1300 mg/天'; note = '每日 3 杯牛奶，避免高糖飲料（抑制生長激素分泌 2 小時）'; }

  const pctNote = hPct !== null && hPct < 25 ? '⚠️ 蛋白質攝取要足夠：每公斤體重約 1.5 g/天' : '蛋白質每公斤體重約 1.2 g/天';

  container.innerHTML = `
    <div class="lc-card">
      <div class="lc-card-header"><span class="lc-card-icon">😴</span>睡眠建議</div>
      <div class="lc-card-tag">生長激素 22:00–02:00 分泌最旺</div>
      <div class="lc-card-body">
        每日睡眠：<strong>${sleepHrs}</strong><br>
        建議就寢時間：<strong>${bedtime}</strong><br>
        確保深層睡眠涵蓋晚上 10 點至凌晨 2 點的黃金期。
      </div>
    </div>
    <div class="lc-card">
      <div class="lc-card-header"><span class="lc-card-icon">🏃</span>運動建議</div>
      <div class="lc-card-tag">高衝擊運動刺激骨骼生長</div>
      <div class="lc-card-body">${exercise}</div>
    </div>
    <div class="lc-card">
      <div class="lc-card-header"><span class="lc-card-icon">🥗</span>營養建議</div>
      <div class="lc-card-tag">鈣質 ${calcium}</div>
      <div class="lc-card-body">
        ${note}<br>
        ${pctNote}
      </div>
    </div>`;
  container.classList.remove('hidden');
}

function initAIChat() {
  $('ai-submit').addEventListener('click', askAI);
  $('ai-clear').addEventListener('click', clearChatHistory);
  $('ai-question').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) askAI();
  });
  document.querySelectorAll('.ai-example-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $('ai-question').value = btn.textContent;
      $('ai-question').focus();
    });
  });
}

// Reset chat display when switching children
function resetAIChat() {
  $('ai-question').value = '';
  $('ai-error').classList.add('hidden');
  renderChatMessages();
}

async function askAI() {
  if (!state.selectedId) return;
  const questionEl = $('ai-question');
  const question = questionEl.value.trim();
  if (!question) { questionEl.focus(); return; }

  const loadingEl = $('ai-loading');
  const errorEl = $('ai-error');

  errorEl.classList.add('hidden');
  loadingEl.classList.remove('hidden');
  $('ai-submit').disabled = true;

  // Optimistically append user message
  appendHistory('user', question);
  questionEl.value = '';
  renderChatMessages();

  try {
    const res = await apiFetch('/api/ai/ask', {
      method: 'POST',
      body: JSON.stringify({
        childId: state.selectedId,
        question,
      }),
    });
    appendHistory('assistant', res.answer);
    renderChatMessages();
  } catch (e) {
    // Roll back optimistic user message on error
    const h = chatHistories[state.selectedId];
    if (h && h.length > 0 && h[h.length-1].role === 'user') h.pop();
    questionEl.value = question;
    renderChatMessages();
    errorEl.textContent = '錯誤：' + e.message;
    errorEl.classList.remove('hidden');
  } finally {
    loadingEl.classList.add('hidden');
    $('ai-submit').disabled = false;
  }
}

/* ─── Mobile Sidebar ─────────────────────────────────────────────────────────── */
function initMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = $('sidebar-overlay');
  const toggleBtn = $('btn-toggle-sidebar');
  const closeBtn = $('btn-close-sidebar');

  const closeSidebar = () => {
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
  };

  if (toggleBtn && sidebar && overlay) {
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.add('open');
      overlay.classList.add('active');
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', closeSidebar);
  }

  if (overlay) {
    overlay.addEventListener('click', closeSidebar);
  }

  state.closeSidebar = closeSidebar;
}

/* ─── Tab Switcher ───────────────────────────────────────────────────────────── */
function initTabSwitcher() {
  const navItems = document.querySelectorAll('.nav-item');
  const tabs = {
    growth: $('tab-content-growth'),
    ai: $('tab-content-ai'),
  };

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      // Toggle active states on menu items
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');

      const targetTab = item.dataset.tab;
      state.activeTab = targetTab;

      // Show/hide correct tab content panel
      Object.keys(tabs).forEach(key => {
        if (tabs[key]) {
          if (key === targetTab) {
            tabs[key].classList.remove('hidden');
          } else {
            tabs[key].classList.add('hidden');
          }
        }
      });

      // Render chart only when entering the growth tab to avoid sizing issues on hidden canvases
      if (targetTab === 'growth') {
        renderChart();
      }

      // Close mobile sidebar if open
      if (state.closeSidebar) {
        state.closeSidebar();
      }
    });
  });
}

/* ─── Init ───────────────────────────────────────────────────────────────────── */
async function init() {
  // Set date input default to today
  el.measureDate.value = new Date().toISOString().split('T')[0];

  initAIChat();
  initMobileSidebar();
  initTabSwitcher();
  initPctModal();

  try {
    state.children = await api.getChildren();
  } catch (e) {
    console.error('Failed to load children:', e);
    state.children = [];
  }

  renderChildrenList();

  if (state.children.length > 0) {
    await selectChild(state.children[0].id);
  } else {
    showEmptyOrDashboard();
  }
}

document.addEventListener('DOMContentLoaded', init);
