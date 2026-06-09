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
  activeTab: 'overview',  // 'overview' | 'chart' | 'logs' | 'ai'
  currentPage: 1,       // For measurement table pagination
  ageRange: 'auto',     // 'auto' | '0-2' | '2-5' | '5-18' | 'all'
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

async function fetchPercentilesForMeasurements(child, measurements) {
  await Promise.all(measurements.map(async (m) => {
    if ((m.heightPercentile !== undefined && m.weightPercentile !== undefined) || (!m.height && !m.weight)) return;
    try {
      const ageM = ageAtDate(child.birthDate, m.date);
      const pct = await api.getPercentile({
        gender: child.gender,
        ageMonths: ageM,
        height: m.height || 0,
        weight: m.weight || 0,
      });
      m.heightPercentile = m.height ? pct.heightPercentile : null;
      m.weightPercentile = m.weight ? pct.weightPercentile : null;
    } catch (_) {
      m.heightPercentile = null;
      m.weightPercentile = null;
    }
  }));
}

function interpolateCurveValue(ageMonths, curvePoints) {
  if (!curvePoints || curvePoints.length === 0) return null;
  if (ageMonths <= curvePoints[0].x) return curvePoints[0].y;
  if (ageMonths >= curvePoints[curvePoints.length - 1].x) return curvePoints[curvePoints.length - 1].y;

  for (let i = 0; i < curvePoints.length - 1; i++) {
    const p1 = curvePoints[i];
    const p2 = curvePoints[i + 1];
    if (ageMonths >= p1.x && ageMonths <= p2.x) {
      if (p1.x === p2.x) return p1.y;
      const ratio = (ageMonths - p1.x) / (p2.x - p1.x);
      return p1.y + (p2.y - p1.y) * ratio;
    }
  }
  return null;
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
    return apiFetch(`/api/curves?gender=${gender}&type=${type}&from=0&to=216&step=6`);
  },
  getPercentile: (d) => apiFetch('/api/percentile', { method: 'POST', body: JSON.stringify(d) }),
  predict: (d) => apiFetch('/api/predict', { method: 'POST', body: JSON.stringify(d) }),
  project: (d) => apiFetch('/api/project', { method: 'POST', body: JSON.stringify(d) }),
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

$('btn-prev-page').addEventListener('click', () => {
  if (state.currentPage > 1) {
    state.currentPage--;
    const child = state.children.find(c => c.id === state.selectedId);
    if (child) renderMeasurementTable(child);
  }
});

$('btn-next-page').addEventListener('click', () => {
  const child = state.children.find(c => c.id === state.selectedId);
  if (child) {
    const pageSize = 5;
    const totalPages = Math.ceil(state.measurements.length / pageSize);
    if (state.currentPage < totalPages) {
      state.currentPage++;
      renderMeasurementTable(child);
    }
  }
});

document.querySelectorAll('.toggle-group .toggle-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (btn.dataset.type) {
      const group = btn.closest('.toggle-group');
      group.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.type = btn.dataset.type;
      state.curves = null;
      await renderChart();
    } else if (btn.dataset.range) {
      const group = btn.closest('.toggle-group');
      group.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.ageRange = btn.dataset.range;
      await renderChart();
    }
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
  state.currentPage = 1; // Reset pagination page when switching children
  state.ageRange = 'auto'; // Reset age range view to auto zoom
  
  // Sync UI buttons for age range group
  const ageGroup = document.querySelector('.age-range-group');
  if (ageGroup) {
    ageGroup.querySelectorAll('.toggle-btn').forEach(b => {
      if (b.dataset.range === 'auto') {
        b.classList.add('active');
      } else {
        b.classList.remove('active');
      }
    });
  }

  const child = state.children.find(c => c.id === id);
  if (!child) return;

  const [measurements, historyMsgs] = await Promise.all([
    api.getMeasurements(id),
    api.getAIHistory(id).catch(() => []),
  ]);
  await fetchPercentilesForMeasurements(child, measurements);
  state.measurements = measurements;

  // Populate client cache from DB (source of truth), preserve timestamps
  chatHistories[id] = historyMsgs.map(m => ({ role: m.role, content: m.content, createdAt: m.createdAt }));

  renderChildrenList();
  showEmptyOrDashboard();
  renderDashboard(child);
  resetAIChat();
  resetOverviewSubTabs();

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
  if (state.activeTab === 'chart') {
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
    ['growth-alert', 'milestone-banner', 'lifestyle-cards', 'catchup-nutrition', 'medical-checklist', 'normal-growth-status']
      .forEach(id => {
        const item = $(id);
        if (item) item.classList.add('hidden');
      });
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

  // Growth rate: annualized velocity from last two height measurements.
  // Prefer a pair >= 3 months apart for accuracy; fall back to any two measurements.
  let growthRate = null;
  let growthRateNote = '';
  const hMs = ms.filter(m => m.height).sort((a, b) => a.date < b.date ? -1 : 1);
  if (hMs.length >= 2) {
    // Try to find a reference point >= 3 months before the latest
    let refIdx = hMs.length - 2;
    for (let i = 0; i < hMs.length - 1; i++) {
      const age = ageAtDate(child.birthDate, hMs[i].date);
      if (ageM - age >= 3) { refIdx = i; }
    }
    const ref = hMs[refIdx];
    const refAge = ageAtDate(child.birthDate, ref.date);
    const months = ageM - refAge;
    if (months >= 1) {
      growthRate = ((latest.height - ref.height) / months * 12).toFixed(1);
      if (months < 3) growthRateNote = '（測量間隔短，僅供參考）';
    }
  }

  // Adult height prediction: WHO percentile tracking (maintains child's current percentile to age 18)
  let adultPred = null;
  if (latest.height) {
    try {
      const projRes = await api.project({
        gender: child.gender, type: 'height',
        ageMonths: ageM, value: latest.height, predictUpTo: 216,
      });
      const at18 = projRes.predictions.find(p => p.ageMonths === 216);
      if (at18) adultPred = at18.value;
    } catch (_) {}
  }

  // Feature 1: MPH
  const mph = calcMPH(child);

  // Phase 2: WHO expected velocity at current age
  const expectedCmYear = whoMedianVelocityCmYear(ageM);

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
    ${growthRate !== null ? (() => {
      const gr = parseFloat(growthRate);
      const chasing = gr >= expectedCmYear;
      const pctAbove = chasing ? Math.round(((gr / expectedCmYear) - 1) * 100) : 0;
      return `
    <div class="stat-card${chasing ? ' stat-card-positive' : ''}">
      <div class="stat-label">近期成長速</div>
      <div class="stat-value">${growthRate} <small>cm/年</small></div>
      <div class="stat-sub">${chasing ? `🌱 積極追趕中！超越中位數 ${pctAbove}%` : `同齡中位數 ${expectedCmYear} cm/年`}${growthRateNote ? `<br><span style="font-size:0.75em;opacity:0.7">${growthRateNote}</span>` : ''}</div>
    </div>`;
    })() : ''}
    ${adultPred !== null ? `
    <div class="stat-card">
      <div class="stat-label">預測成人身高</div>
      <div class="stat-value">${adultPred} <small>cm</small></div>
      <div class="stat-sub">基於 WHO 百分位追蹤</div>
    </div>` : ''}
    ${mph ? `
    <div class="stat-card stat-card-wide">
      <div class="stat-label">遺傳靶身高</div>
      <div class="stat-value">${mph.mid.toFixed(1)} <small>cm</small></div>
      <div class="stat-sub">±${child.gender === 'male' ? '7.5' : '6.0'} cm 範圍 (${mph.low.toFixed(1)}–${mph.high.toFixed(1)})</div>
    </div>` : ''}
  `;

  // Alerts: deviation (Phase 1) + milestone (Phase 2) — shared percentile calls
  checkAlerts(child, ms);

  // Feature 4: lifestyle cards
  renderLifestyleCards(ageInMonths(child.birthDate), hPct, latest.weight, child.gender);

  // Phase 2: catch-up cards
  renderCatchupNutrition(hPct);
  renderMedicalChecklist(hPct);

  // Normal growth reassurance status
  renderNormalGrowthStatus(hPct, wPct);
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
  const sortedMs = [...state.measurements]
    .sort((a, b) => a.date < b.date ? -1 : 1)
    .filter(m => state.type === 'height' ? m.height : m.weight);

  const rawPoints = [];
  for (let i = 0; i < sortedMs.length; i++) {
    const m = sortedMs[i];
    const x = ageAtDate(child.birthDate, m.date);
    const y = state.type === 'height' ? m.height : m.weight;
    const pct = state.type === 'height' ? m.heightPercentile : m.weightPercentile;

    if (rawPoints.length > 0) {
      const prevManual = rawPoints.filter(p => p.manual).pop();
      if (prevManual) {
        const gap = x - prevManual.x;
        if (gap > 12) {
          const insertX = prevManual.x + 6;
          const ratio = 6 / gap;
          const insertY = prevManual.y + (y - prevManual.y) * ratio;
          rawPoints.push({ x: insertX, y: insertY, manual: false });
        }
      }
    }

    rawPoints.push({ x, y, manual: true, percentile: pct });
  }

  // Fetch percentiles for any gap-predicted points in parallel
  await Promise.all(rawPoints.map(async (p) => {
    if (p.manual) return;
    try {
      const pctRes = await api.getPercentile({
        gender: child.gender,
        ageMonths: p.x,
        height: state.type === 'height' ? p.y : 0,
        weight: state.type === 'weight' ? p.y : 0,
      });
      p.percentile = state.type === 'height' ? pctRes.heightPercentile : pctRes.weightPercentile;
    } catch (_) {
      p.percentile = null;
    }
  }));

  const childPoints = rawPoints;

  // Prediction via WHO percentile tracking (maintains current z-score forward).
  const predictUpTo = 216;
  let predPoints = [];
  if (childPoints.length >= 1) {
    const manualPoints = childPoints.filter(p => p.manual);
    const lastPt = manualPoints[manualPoints.length - 1];
    try {
      const projRes = await api.project({
        gender: child.gender, type: state.type,
        ageMonths: lastPt.x, value: lastPt.y, predictUpTo,
      });
      predPoints = projRes.predictions.map(p => ({ x: p.ageMonths, y: p.value }));
    } catch (_) {}
  }

  // Auto-zoom or presets: show child's relevant age range based on selector
  let xMin = 0;
  let xMax = predictUpTo;
  
  if (state.ageRange === 'auto') {
    const ageNow = ageInMonths(child.birthDate);
    const manualPoints = childPoints.filter(p => p.manual);
    const firstMeasureAge = manualPoints.length > 0 ? manualPoints[0].x : 0;
    xMin = Math.max(0, firstMeasureAge - 6);
    xMax = Math.min(predictUpTo, ageNow + 48);
  } else if (state.ageRange === '0-2') {
    xMin = 0;
    xMax = 24;
  } else if (state.ageRange === '2-5') {
    xMin = 24;
    xMax = 60;
  } else if (state.ageRange === '5-18') {
    xMin = 60;
    xMax = 216;
  } else if (state.ageRange === 'all') {
    xMin = 0;
    xMax = predictUpTo;
  }

  const isMobile = window.innerWidth < 768;
  const whoLineStyle = { pointRadius: 0, borderWidth: isMobile ? 0.8 : 1, tension: 0.4, fill: false };

  const datasets = [
    // WHO percentile curves (background)
    { label: 'P97', data: curves.p97.map(p => ({ x: p.x, y: p.y })), borderColor: '#94a3b8', borderDash: [4, 3], ...whoLineStyle },
    ...(!isMobile ? [
      { label: 'P90', data: curves.p90.map(p => ({ x: p.x, y: p.y })), borderColor: '#cbd5e1', ...whoLineStyle },
      { label: 'P75', data: curves.p75.map(p => ({ x: p.x, y: p.y })), borderColor: '#94a3b8', ...whoLineStyle },
    ] : []),
    { label: 'P50', data: curves.p50.map(p => ({ x: p.x, y: p.y })), borderColor: '#64748b', borderWidth: isMobile ? 1 : 1.5, ...whoLineStyle },
    ...(!isMobile ? [
      { label: 'P25', data: curves.p25.map(p => ({ x: p.x, y: p.y })), borderColor: '#94a3b8', ...whoLineStyle },
      { label: 'P10', data: curves.p10.map(p => ({ x: p.x, y: p.y })), borderColor: '#cbd5e1', ...whoLineStyle },
    ] : []),
    { label: 'P3',  data: curves.p3.map(p => ({ x: p.x, y: p.y })),  borderColor: '#94a3b8', borderDash: [4, 3], ...whoLineStyle },
    // Child's data (combining manual and 6-month predicted gap points)
    {
      label: child.name,
      data: childPoints,
      borderColor: color,
      backgroundColor: color,
      borderWidth: isMobile ? 2 : 2.5,
      pointRadius: (context) => {
        const index = context.dataIndex;
        const point = context.dataset.data[index];
        if (!point) return 0;
        return point.manual ? (isMobile ? 4 : 5) : (isMobile ? 3 : 4);
      },
      pointHoverRadius: (context) => {
        const index = context.dataIndex;
        const point = context.dataset.data[index];
        if (!point) return 0;
        return point.manual ? (isMobile ? 6 : 7) : (isMobile ? 5 : 6);
      },
      pointBackgroundColor: (context) => {
        const index = context.dataIndex;
        const point = context.dataset.data[index];
        if (point && !point.manual) return '#ffffff';
        return color;
      },
      pointBorderColor: color,
      pointBorderWidth: (context) => {
        const index = context.dataIndex;
        const point = context.dataset.data[index];
        if (point && !point.manual) return 2;
        return 1;
      },
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
      borderWidth: isMobile ? 1.5 : 2,
      pointRadius: isMobile ? 2 : 3,
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
      interaction: { mode: 'x', intersect: false }, // match points vertically by X axis
      parsing: false,
      scales: {
        x: {
          type: 'linear',
          min: xMin,
          max: xMax,
          title: { display: !isMobile, text: '年齡', color: '#64748b', font: { size: 12 } },
          ticks: {
            color: '#64748b',
            font: { size: isMobile ? 10 : 12 },
            maxRotation: 0,
            autoSkip: true,
            callback: (v) => {
              const rangeMonths = xMax - xMin;
              // Always mark year boundaries
              if (v % 12 === 0) return `${v / 12}歲`;
              // Short range (0-2y): show every 3 months
              if (rangeMonths <= 24) return v % 3 === 0 ? `${v}m` : null;
              // Medium range (2-5y): show every 6 months on desktop
              if (rangeMonths <= 48) return (!isMobile && v % 6 === 0) ? `${v}m` : null;
              // Wide range (5y+): years only
              return null;
            },
          },
          grid: { color: '#f1f5f9', display: !isMobile }, // hide vertical grid lines on mobile for cleaner view
        },
        y: {
          title: {
            display: !isMobile,
            text: state.type === 'height' ? '身高（cm）' : '體重（kg）',
            color: '#64748b',
            font: { size: 12 },
          },
          ticks: {
            color: '#64748b',
            font: { size: isMobile ? 10 : 12 },
          },
          grid: { color: '#f1f5f9' },
        },
      },
      plugins: {
        legend: {
          position: isMobile ? 'bottom' : 'top',
          labels: {
            boxWidth: isMobile ? 12 : 40,
            filter: (item) => !['P90','P10','P75','P25','遺傳靶身高下限'].includes(item.text),
            color: '#64748b',
            font: { size: isMobile ? 10 : 12 },
          },
        },
        tooltip: {
          filter: (tooltipItem) => {
            // Hide the lower bound target helper label from tooltip
            if (tooltipItem.dataset.label === '遺傳靶身高下限') return false;
            return true;
          },
          callbacks: {
            title: (items) => {
              const whoLabels = new Set(['P97','P90','P75','P50','P25','P10','P3']);
              const precise = items.find(i => !whoLabels.has(i.dataset.label));
              const x = Math.round((precise ?? items[0]).parsed.x);
              return formatAge(x);
            },
            label: (item) => {
              if (item.dataset.label === '遺傳靶身高下限') return null;
              if (item.dataset.label === '遺傳靶身高上限') {
                return `遺傳靶身高: ${mph ? mph.low.toFixed(1) : ''}–${mph ? mph.high.toFixed(1) : ''} cm`;
              }
              // Hide prediction for ages at or before the last actual measurement
              if (item.dataset.label === '預測') {
                const lastActualAge = childPoints.length > 0 ? childPoints[childPoints.length - 1].x : 0;
                if (Math.round(item.parsed.x) <= lastActualAge) return null;
                const unit = state.type === 'height' ? 'cm' : 'kg';
                const lastManual = childPoints.filter(p => p.manual).pop();
                const prVal = lastManual ? lastManual.percentile : null;
                const prText = prVal !== null && prVal !== undefined ? ` (PR: P${Math.round(prVal)})` : '';
                return `預測: ${item.parsed.y} ${unit}${prText}`;
              }
              const unit = state.type === 'height' ? 'cm' : 'kg';
              if (item.dataset.label === child.name) {
                const point = item.dataset.data[item.dataIndex];
                if (point && point.percentile !== undefined && point.percentile !== null) {
                  const labelType = point.manual ? '' : ' (預測)';
                  const lines = [
                    `${item.dataset.label}${labelType}: ${item.parsed.y} ${unit} (PR: P${Math.round(point.percentile)})`
                  ];
                  if (state.curves) {
                    const ageM = Math.round(item.parsed.x);
                    const p3Val = interpolateCurveValue(ageM, state.curves.p3);
                    const p50Val = interpolateCurveValue(ageM, state.curves.p50);
                    const p97Val = interpolateCurveValue(ageM, state.curves.p97);
                    
                    if (p3Val !== null) {
                      const diffP3 = item.parsed.y - p3Val;
                      const sign = diffP3 >= 0 ? '+' : '';
                      lines.push(`  ↳ 距離 P3 低標: ${sign}${diffP3.toFixed(1)} ${unit}`);
                    }
                    if (p50Val !== null) {
                      const diffP50 = item.parsed.y - p50Val;
                      const sign = diffP50 >= 0 ? '+' : '';
                      lines.push(`  ↳ 距離 P50 中位: ${sign}${diffP50.toFixed(1)} ${unit}`);
                    }
                    if (p97Val !== null) {
                      const diffP97 = item.parsed.y - p97Val;
                      const sign = diffP97 >= 0 ? '+' : '';
                      lines.push(`  ↳ 距離 P97 高標: ${sign}${diffP97.toFixed(1)} ${unit}`);
                    }
                  }
                  return lines;
                }
              }
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
  const paginationEl = $('table-pagination');

  if (ms.length === 0) {
    el.measureTable.classList.add('hidden');
    el.noMeasures.classList.remove('hidden');
    if (paginationEl) paginationEl.classList.add('hidden');
    return;
  }
  el.measureTable.classList.remove('hidden');
  el.noMeasures.classList.add('hidden');

  // Pagination setup
  const pageSize = 5;
  const totalPages = Math.ceil(ms.length / pageSize);
  if (state.currentPage > totalPages) state.currentPage = totalPages;
  if (state.currentPage < 1) state.currentPage = 1;

  // Show pagination controls only if we have more than 5 items
  if (totalPages > 1) {
    if (paginationEl) {
      paginationEl.classList.remove('hidden');
      $('page-indicator').textContent = `${state.currentPage} / ${totalPages}`;
      $('btn-prev-page').disabled = state.currentPage === 1;
      $('btn-next-page').disabled = state.currentPage === totalPages;
    }
  } else {
    if (paginationEl) paginationEl.classList.add('hidden');
  }

  const startIdx = (state.currentPage - 1) * pageSize;
  const paginatedMs = ms.slice(startIdx, startIdx + pageSize);

  el.measureTbody.innerHTML = paginatedMs.map(m => {
    const ageM = ageAtDate(child.birthDate, m.date);
    const hPctBadge = m.heightPercentile !== undefined && m.heightPercentile !== null ? percentileBadge(m.heightPercentile) : '—';
    const wPctBadge = m.weightPercentile !== undefined && m.weightPercentile !== null ? percentileBadge(m.weightPercentile) : '—';
    return `<tr>
      <td>${m.date}</td>
      <td>${formatAge(ageM)}</td>
      <td>${m.height ?? '—'}</td>
      <td>${m.weight ?? '—'}</td>
      <td>${m.height ? hPctBadge : '—'}</td>
      <td>${m.weight ? wPctBadge : '—'}</td>
      <td><button class="btn-del" data-mid="${m.id}" title="刪除">×</button></td>
    </tr>`;
  }).join('');

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
    await fetchPercentilesForMeasurements(child, [m]);
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

/* ─── Phase 2: WHO median height velocity (cm/year) ─────────────────────────── */
const WHO_VELOCITY_TABLE = [
  { maxAge: 3,   cmPerYear: 42  },
  { maxAge: 6,   cmPerYear: 24  },
  { maxAge: 12,  cmPerYear: 16  },
  { maxAge: 24,  cmPerYear: 11  },
  { maxAge: 48,  cmPerYear: 8   },
  { maxAge: 72,  cmPerYear: 6   },
  { maxAge: 120, cmPerYear: 5.5 },
  { maxAge: 216, cmPerYear: 6   },
];

function whoMedianVelocityCmYear(ageMonths) {
  for (const row of WHO_VELOCITY_TABLE) {
    if (ageMonths <= row.maxAge) return row.cmPerYear;
  }
  return 6;
}

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

async function checkAlerts(child, measurements) {
  const ms = [...measurements].sort((a, b) => a.date < b.date ? -1 : 1);
  if (ms.length < 2) { showGrowthAlert([]); showMilestoneBanner(null); return; }

  const alerts = [];
  let milestoneMsg = null;

  const hMs = ms.filter(m => m.height);
  if (hMs.length >= 2) {
    const prev = hMs[hMs.length - 2];
    const curr = hMs[hMs.length - 1];
    try {
      const [prevPct, currPct] = await Promise.all([
        api.getPercentile({ gender: child.gender, ageMonths: ageAtDate(child.birthDate, prev.date), height: prev.height, weight: prev.weight || 0 }),
        api.getPercentile({ gender: child.gender, ageMonths: ageAtDate(child.birthDate, curr.date), height: curr.height, weight: curr.weight || 0 }),
      ]);
      const oldP = prevPct.heightPercentile;
      const newP = currPct.heightPercentile;
      const crossed = bandsCrossed(oldP, newP);

      if (crossed >= 2) {
        const dir = newP < oldP ? '下滑' : '上升（留意性早熟）';
        alerts.push({ red: true, text: `身高百分位從 P${Math.round(oldP)} ${dir}至 P${Math.round(newP)}，跨越 ${crossed} 條曲線帶。` });
      }

      // Phase 2: upward milestone
      if (crossed >= 1 && newP > oldP) {
        milestoneMsg = `身高百分位從 P${Math.round(oldP)} 進步到 P${Math.round(newP)}，跨越 ${crossed} 個百分位帶，繼續保持！`;
      }
    } catch (_) {}
  }

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
  showMilestoneBanner(milestoneMsg);
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
function renderLifestyleCards(ageMonths, hPct, weight, gender) {
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

  // Nutrition text
  let note;
  if (ageMonths < 36)      note = '母乳或配方奶為主，開始添加副食品';
  else if (ageMonths < 96) note = '每日 2 杯牛奶（約 500 mL），豆腐、深色蔬菜補充';
  else                      note = '每日 3 杯牛奶，避免高糖飲料（抑制生長激素分泌 2 小時）';

  // Personalized nutrition calculations (DRI-based)
  let calcHtml = '';
  if (weight && weight > 0) {
    const proteinRate = (hPct !== null && hPct < 25) ? 1.5 : 1.2;
    const protein = (weight * proteinRate).toFixed(1);

    let calPerKg;
    if (ageMonths < 6)        calPerKg = 108;
    else if (ageMonths < 12)  calPerKg = 98;
    else if (ageMonths < 36)  calPerKg = 102;
    else if (ageMonths < 96)  calPerKg = 90;
    else if (ageMonths < 156) calPerKg = gender === 'male' ? 75 : 70;
    else                       calPerKg = gender === 'male' ? 63 : 58;
    const calories = Math.round(weight * calPerKg);

    let calcium;
    if (ageMonths < 7)        calcium = 200;
    else if (ageMonths < 12)  calcium = 260;
    else if (ageMonths < 48)  calcium = 700;
    else if (ageMonths < 108) calcium = 1000;
    else                       calcium = 1300;

    let zinc;
    if (ageMonths < 7)        zinc = 2;
    else if (ageMonths < 12)  zinc = 3;
    else if (ageMonths < 48)  zinc = 3;
    else if (ageMonths < 108) zinc = 5;
    else if (ageMonths < 168) zinc = 8;
    else                       zinc = gender === 'male' ? 11 : 9;

    const water = Math.round(weight * 35);

    calcHtml = `
      <div class="nc-grid">
        <div class="nc-item">
          <div class="nc-label">蛋白質</div>
          <div class="nc-value">${protein}<span class="nc-unit">g</span></div>
          <div class="nc-note">${proteinRate}g × ${weight}kg</div>
        </div>
        <div class="nc-item">
          <div class="nc-label">熱量</div>
          <div class="nc-value">${calories}<span class="nc-unit">kcal</span></div>
          <div class="nc-note">${calPerKg}kcal × ${weight}kg</div>
        </div>
        <div class="nc-item">
          <div class="nc-label">鈣質</div>
          <div class="nc-value">${calcium}<span class="nc-unit">mg</span></div>
        </div>
        <div class="nc-item">
          <div class="nc-label">鋅</div>
          <div class="nc-value">${zinc}<span class="nc-unit">mg</span></div>
        </div>
        <div class="nc-item">
          <div class="nc-label">水分</div>
          <div class="nc-value">${water}<span class="nc-unit">mL</span></div>
          <div class="nc-note">35mL × ${weight}kg</div>
        </div>
      </div>`;
  }

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
      <div class="lc-card-tag">依體重個人化計算（DRI 標準）</div>
      <div class="lc-card-body">
        ${note}
        ${calcHtml}
      </div>
    </div>`;
  container.classList.remove('hidden');
}

/* ─── Phase 2: Milestone banner ─────────────────────────────────────────────── */
function showMilestoneBanner(msg) {
  const banner = $('milestone-banner');
  if (!msg) { banner.classList.add('hidden'); return; }
  banner.innerHTML = `
    <div class="milestone-icon">🏆</div>
    <div class="milestone-content">
      <div class="milestone-title">追趕里程碑達成！</div>
      <div class="milestone-body">${msg}</div>
    </div>`;
  banner.classList.remove('hidden');
}

/* ─── Phase 2: Catch-up nutrition card (hPct ≤ 15) ─────────────────────────── */
function renderCatchupNutrition(hPct) {
  const container = $('catchup-nutrition');
  if (hPct === null || hPct > 15) { container.classList.add('hidden'); return; }
  const child = state.children.find(c => c.id === state.selectedId);
  const name = child ? child.name : '孩子';
  container.innerHTML = `
    <div class="catchup-header">
      <span class="catchup-icon">🥗</span>
      <div class="catchup-title">追趕生長營養建議 <span class="catchup-tag">身高 P${Math.round(hPct)} 以下啟用</span></div>
    </div>
    <ul class="catchup-list">
      <li>優質蛋白：每公斤體重 1.5 g/天（雞蛋、鮮奶、魚肉、豆腐）</li>
      <li>鈣質 1000–1300 mg/天：每日 2–3 杯牛奶，搭配深色蔬菜</li>
      <li>鋅補充：牡蠣、牛肉、南瓜子，促進食慾與細胞生長</li>
      <li>維生素 D3：400–1000 IU/天，強化鈣質吸收與骨骼延伸</li>
      <li class="catchup-avoid">🚫 避免含糖飲料（抑制生長激素 2 小時）、油炸加工食品</li>
    </ul>
    <button class="catchup-ai-btn" id="btn-catchup-ai">詢問 AI 顧問個人化建議 →</button>`;
  container.classList.remove('hidden');
  $('btn-catchup-ai').addEventListener('click', () => {
    $('ai-question').value = `${name} 身高百分位偏低（P${Math.round(hPct)}），請給我具體的追趕生長飲食計畫，包含每日餐點建議和應避免的食物。`;
    document.querySelector('[data-tab="ai"]').click();
    $('ai-question').focus();
  });
}

/* ─── Phase 2: Medical checklist card (hPct < 3) ────────────────────────────── */
function renderMedicalChecklist(hPct) {
  const container = $('medical-checklist');
  if (hPct === null || hPct >= 3) { container.classList.add('hidden'); return; }
  container.innerHTML = `
    <div class="catchup-header">
      <span class="catchup-icon">🏥</span>
      <div class="catchup-title">就醫評估建議清單 <span class="catchup-tag medical-tag">身高低於 P3</span></div>
    </div>
    <ul class="catchup-list">
      <li>建議就診：<strong>小兒遺傳內分泌科</strong> 或 <strong>兒童生長發育專科門診</strong></li>
      <li>就醫時機：4 歲以上每年身高增加不足 4 cm，或百分位持續低於 P3</li>
      <li>醫師可能進行：拍左手 X 光，評估骨骼年齡</li>
      <li>醫師可能進行：抽血檢測生長激素、甲狀腺素、IGF-1</li>
      <li>請攜帶：近兩年身高體重記錄（GrowSmart 截圖即可）</li>
    </ul>
    <p class="medical-note">提前了解流程，就診不慌張。是否需就醫請由醫師判斷，本系統提供輔助參考。</p>`;
  container.classList.remove('hidden');
}

/* ─── Normal Growth Reassurance Status ───────────────────────────────────────── */
function renderNormalGrowthStatus(hPct, wPct) {
  const container = $('normal-growth-status');
  if (!container) return;

  const hasLowPct = (hPct !== null && hPct <= 15) || (wPct !== null && wPct <= 15);

  if (hasLowPct || (hPct === null && wPct === null)) {
    container.classList.add('hidden');
    return;
  }

  const child = state.children.find(c => c.id === state.selectedId);
  const name = child ? child.name : '孩子';

  let detailText = `目前 ${name} 的成長數據非常理想。`;
  if (hPct !== null) {
    detailText += `最新身高百分位為 P${Math.round(hPct)}，`;
  }
  if (wPct !== null) {
    detailText += `最新體重百分位為 P${Math.round(wPct)}，`;
  }
  detailText += `均落於正常的成長曲線區間內。不需要特別啟動就醫評估或額外的追趕生長飲食計畫。`;

  container.innerHTML = `
    <div class="normal-growth-card">
      <div class="normal-growth-header">
        <span class="normal-growth-icon">✨</span>
        <div class="normal-growth-title">成長狀態評估：健康良好</div>
      </div>
      <p class="normal-growth-body">${detailText}</p>
      <div class="normal-growth-tips">
        <strong>💡 日常維持建議：</strong>
        <ul>
          <li>維持每日均衡飲食（適量攝取優質蛋白質、鈣質與深色蔬菜）。</li>
          <li>每天進行至少 60 分鐘中高強度活動（如跳繩、打籃球、戶外跑跳）。</li>
          <li>保持規律作息，每天晚上 10 點前就寢，確保深層睡眠涵蓋生長激素分泌黃金期。</li>
        </ul>
      </div>
    </div>
  `;
  container.classList.remove('hidden');
}

/* ─── Overview Sub-Tabs ──────────────────────────────────────────────────────── */
function initOverviewSubTabs() {
  const subTabsContainer = document.querySelector('.overview-sub-tabs');
  if (!subTabsContainer) return;

  const buttons = subTabsContainer.querySelectorAll('.sub-tab-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const targetSubtab = btn.dataset.subtab;
      const subtabContents = document.querySelectorAll('.subtab-content');
      subtabContents.forEach(content => {
        if (content.id === `subtab-${targetSubtab}`) {
          content.classList.remove('hidden');
          content.classList.add('fade-in');
        } else {
          content.classList.add('hidden');
          content.classList.remove('fade-in');
        }
      });
    });
  });
}

function resetOverviewSubTabs() {
  const subTabsContainer = document.querySelector('.overview-sub-tabs');
  if (!subTabsContainer) return;
  const buttons = subTabsContainer.querySelectorAll('.sub-tab-btn');
  buttons.forEach((btn, idx) => {
    const targetSubtab = btn.dataset.subtab;
    const content = $(`subtab-${targetSubtab}`);
    if (idx === 0) {
      btn.classList.add('active');
      if (content) {
        content.classList.remove('hidden');
        content.classList.remove('fade-in');
      }
    } else {
      btn.classList.remove('active');
      if (content) {
        content.classList.add('hidden');
        content.classList.remove('fade-in');
      }
    }
  });
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
    overview: $('tab-content-overview'),
    chart: $('tab-content-chart'),
    logs: $('tab-content-logs'),
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

      // Render chart only when entering the chart tab to avoid sizing issues on hidden canvases
      if (targetTab === 'chart') {
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
  initOverviewSubTabs();

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
