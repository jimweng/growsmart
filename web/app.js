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
  return `<span class="badge ${cls}">P${pct}</span>`;
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
  getCurves: (gender, type) => apiFetch(`/api/curves?gender=${gender}&type=${type}&from=0&to=96&step=3`),
  getPercentile: (d) => apiFetch('/api/percentile', { method: 'POST', body: JSON.stringify(d) }),
  predict: (d) => apiFetch('/api/predict', { method: 'POST', body: JSON.stringify(d) }),
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
$('btn-edit-child').addEventListener('click', () => {
  const child = state.children.find(c => c.id === state.selectedId);
  if (child) openChildForm(child);
});
$('btn-delete-child').addEventListener('click', deleteChild);

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

  state.measurements = await api.getMeasurements(id);
  renderChildrenList();
  showEmptyOrDashboard();
  renderDashboard(child);
  resetAIChat();

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
  await renderChart();
  renderMeasurementTable(child);
}

/* ─── Stats ──────────────────────────────────────────────────────────────────── */
async function renderStats(child) {
  const ms = [...state.measurements].sort((a, b) => a.date < b.date ? -1 : 1);
  const latest = ms[ms.length - 1];
  if (!latest) {
    el.statsRow.innerHTML = '<p class="no-data">新增第一筆測量來查看統計</p>';
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

  // Growth rate (cm/year) from last two measurements
  let growthRate = null;
  if (ms.length >= 2) {
    const prev = ms[ms.length - 2];
    if (latest.height && prev.height) {
      const monthsDiff = ageAtDate(child.birthDate, latest.date) - ageAtDate(child.birthDate, prev.date);
      if (monthsDiff > 0) {
        growthRate = ((latest.height - prev.height) / monthsDiff * 12).toFixed(1);
      }
    }
  }

  // Predicted adult height (18y = 216 months)
  let adultPred = null;
  const hPoints = ms.filter(m => m.height).map(m => ({
    ageMonths: ageAtDate(child.birthDate, m.date),
    value: m.height,
  }));
  if (hPoints.length >= 2) {
    try {
      const predRes = await api.predict({ points: hPoints, predictUpTo: 216 });
      const at18 = predRes.predictions.find(p => p.ageMonths === 216);
      if (at18) adultPred = at18.value;
    } catch (_) {}
  }

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
  `;
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

  // Prediction
  let predPoints = [];
  if (childPoints.length >= 2) {
    try {
      const predRes = await api.predict({
        points: childPoints.map(p => ({ ageMonths: p.x, value: p.y })),
        predictUpTo: 120,
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
            filter: (item) => !['P90','P10','P75','P25'].includes(item.text),
            color: '#64748b',
            font: { size: 12 },
          },
        },
        tooltip: {
          callbacks: {
            title: (items) => `${items[0].parsed.x} 個月 (${formatAge(items[0].parsed.x)})`,
            label: (item) => {
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
  chatHistories[state.selectedId].push({ role, content });
  // Sliding window — keep last 10 turns client-side too
  if (chatHistories[state.selectedId].length > 10) {
    chatHistories[state.selectedId] = chatHistories[state.selectedId].slice(-10);
  }
}

function clearChatHistory() {
  if (!state.selectedId) return;
  chatHistories[state.selectedId] = [];
  renderChatMessages();
}

function renderChatMessages() {
  const thread = $('ai-thread');
  const history = getChatHistory();
  if (!thread) return;
  if (history.length === 0) {
    thread.innerHTML = '<p class="ai-thread-empty">開始詢問孩子成長相關問題</p>';
    return;
  }
  thread.innerHTML = history.map(m => `
    <div class="ai-msg ai-msg-${m.role}">
      <div class="ai-msg-label">${m.role === 'user' ? '你' : 'AI 顧問'}</div>
      <div class="ai-msg-content">${escapeHtml(m.content)}</div>
    </div>`).join('');
  thread.scrollTop = thread.scrollHeight;
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/\n/g,'<br>');
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
    // Send history BEFORE the new message (backend appends it)
    const historyToSend = getChatHistory().slice(0, -1); // exclude the just-appended user msg
    const res = await apiFetch('/api/ai/ask', {
      method: 'POST',
      body: JSON.stringify({
        childId: state.selectedId,
        question,
        history: historyToSend,
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

/* ─── Init ───────────────────────────────────────────────────────────────────── */
async function init() {
  // Set date input default to today
  el.measureDate.value = new Date().toISOString().split('T')[0];

  initAIChat();
  initMobileSidebar();

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
