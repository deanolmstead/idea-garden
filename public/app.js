/* ── Storage ─────────────────────────────────────────────── */
const STORE_KEY = 'bp_readings';

function loadReadings() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); }
  catch { return []; }
}

function saveReadings(readings) {
  localStorage.setItem(STORE_KEY, JSON.stringify(readings));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function formatDate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - date) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* ── BP classification ───────────────────────────────────── */
function classify(sys, dia) {
  if (sys < 90 || dia < 60)       return { label: 'Low',         cls: 'cat-low',    bar: '#5856d6' };
  if (sys < 120 && dia < 80)      return { label: 'Normal',      cls: 'cat-normal', bar: '#34c759' };
  if (sys <= 129 && dia < 80)     return { label: 'Elevated',    cls: 'cat-elevated', bar: '#ff9f0a' };
  if (sys <= 139 || dia <= 89)    return { label: 'High — St.1', cls: 'cat-high1',  bar: '#ff6b35' };
  if (sys < 180 && dia < 120)     return { label: 'High — St.2', cls: 'cat-high2',  bar: '#ff3b30' };
  return                                 { label: 'Crisis',       cls: 'cat-crisis', bar: '#8e0000' };
}

/* ── DOM refs ────────────────────────────────────────────── */
const mainView       = document.getElementById('mainView');
const historyView    = document.getElementById('historyView');
const historyToggle  = document.getElementById('historyToggle');
const backBtn        = document.getElementById('backBtn');
const clearBtn       = document.getElementById('clearBtn');

const statusDate     = document.getElementById('statusDate');
const noReading      = document.getElementById('noReading');
const hasReading     = document.getElementById('hasReading');
const displaySys     = document.getElementById('displaySystolic');
const displayDia     = document.getElementById('displayDiastolic');
const displayPulse   = document.getElementById('displayPulse');
const displayCat     = document.getElementById('displayCategory');
const insightLoading = document.getElementById('insightLoading');
const insightText    = document.getElementById('insightText');

const formCard       = document.getElementById('formCard');
const formTitle      = document.getElementById('formTitle');
const sysInput       = document.getElementById('systolic');
const diaInput       = document.getElementById('diastolic');
const pulseInput     = document.getElementById('pulse');
const notesInput     = document.getElementById('notes');
const saveBtn        = document.getElementById('saveBtn');
const errorMsg       = document.getElementById('errorMsg');

const historyList    = document.getElementById('historyList');
const historyEmpty   = document.getElementById('historyEmpty');
const chartCanvas    = document.getElementById('bpChart');
const chartEmpty     = document.getElementById('chartEmpty');

/* ── Navigation ──────────────────────────────────────────── */
function showHistory() {
  mainView.classList.remove('active');
  historyView.classList.add('active');
  renderHistory();
}

function showMain() {
  historyView.classList.remove('active');
  mainView.classList.add('active');
}

historyToggle.addEventListener('click', showHistory);
backBtn.addEventListener('click', showMain);

clearBtn.addEventListener('click', () => {
  if (confirm('Delete all readings? This cannot be undone.')) {
    saveReadings([]);
    renderAll();
    showMain();
  }
});

/* ── Render main view ────────────────────────────────────── */
function renderAll() {
  const readings = loadReadings();
  const todayEntry = readings.find(r => r.date === todayKey());

  statusDate.textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric'
  });

  if (todayEntry) {
    noReading.classList.add('hidden');
    hasReading.classList.remove('hidden');
    formTitle.textContent = 'Update Today\'s Reading';
    saveBtn.textContent   = 'Update Reading';

    // Pre-fill form
    sysInput.value   = todayEntry.systolic;
    diaInput.value   = todayEntry.diastolic;
    pulseInput.value = todayEntry.pulse || '';
    notesInput.value = todayEntry.notes || '';

    const cat = classify(todayEntry.systolic, todayEntry.diastolic);
    displaySys.textContent = todayEntry.systolic;
    displayDia.textContent = todayEntry.diastolic;
    displayPulse.textContent = todayEntry.pulse ? `♥ ${todayEntry.pulse} bpm` : '';
    displayPulse.style.display = todayEntry.pulse ? '' : 'none';
    displayCat.textContent = cat.label;
    displayCat.className   = `category-chip ${cat.cls}`;
  } else {
    noReading.classList.remove('hidden');
    hasReading.classList.add('hidden');
    formTitle.textContent = 'Log Today\'s Reading';
    saveBtn.textContent   = 'Save Reading';
    sysInput.value = diaInput.value = pulseInput.value = notesInput.value = '';
  }

  renderChart(readings);
}

/* ── Save reading ────────────────────────────────────────── */
saveBtn.addEventListener('click', async () => {
  const sys   = parseInt(sysInput.value,   10);
  const dia   = parseInt(diaInput.value,   10);
  const pulse = parseInt(pulseInput.value, 10) || null;
  const notes = notesInput.value.trim();

  // Validate
  if (!sysInput.value || !diaInput.value || isNaN(sys) || isNaN(dia)) {
    showError('Please enter both systolic and diastolic values.');
    return;
  }
  if (sys < 60 || sys > 250) { showError('Systolic must be between 60–250.'); return; }
  if (dia < 40 || dia > 150) { showError('Diastolic must be between 40–150.'); return; }
  if (pulse !== null && (pulse < 30 || pulse > 220)) {
    showError('Pulse must be between 30–220.'); return;
  }

  hideError();
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  const readings = loadReadings().filter(r => r.date !== todayKey());
  const entry = { date: todayKey(), systolic: sys, diastolic: dia, pulse, notes };
  readings.unshift(entry);
  saveReadings(readings);

  renderAll();
  saveBtn.disabled = false;
  saveBtn.textContent = 'Update Reading';

  // Fetch AI insight (streaming)
  fetchInsight(entry, readings.slice(1, 8));
});

/* ── AI insight ──────────────────────────────────────────── */
async function fetchInsight(entry, history) {
  insightLoading.classList.remove('hidden');
  insightText.textContent = '';

  try {
    const res = await fetch('/api/insight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systolic:  entry.systolic,
        diastolic: entry.diastolic,
        pulse:     entry.pulse,
        history,
      }),
    });

    if (!res.ok) throw new Error('Server error');

    const reader = res.body.getReader();
    const dec    = new TextDecoder();
    let   buf    = '';

    insightLoading.classList.add('hidden');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') break;
        try {
          const { text, error } = JSON.parse(payload);
          if (error) { insightText.textContent = '⚠️ ' + error; break; }
          if (text)  { insightText.textContent += text; }
        } catch { /* partial JSON */ }
      }
    }
  } catch (err) {
    insightLoading.classList.add('hidden');
    insightText.textContent = '⚠️ Could not load AI insight. Check your API key and server.';
  }
}

/* ── History ─────────────────────────────────────────────── */
function renderHistory() {
  const readings = loadReadings();
  historyList.innerHTML = '';

  if (readings.length === 0) {
    historyEmpty.classList.remove('hidden');
    return;
  }

  historyEmpty.classList.add('hidden');

  readings.forEach(r => {
    const cat  = classify(r.systolic, r.diastolic);
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
      <div class="history-cat-bar" style="background:${cat.bar}"></div>
      <div class="history-main">
        <div class="history-date">${formatDate(r.date)}</div>
        <div class="history-bp">${r.systolic}<span class="sep"> / </span>${r.diastolic} <span style="font-size:14px;font-weight:400;color:#6c6c70">mmHg</span></div>
        <div class="history-meta">${r.pulse ? `♥ ${r.pulse} bpm` : ''}</div>
        ${r.notes ? `<div class="history-notes">${escHtml(r.notes)}</div>` : ''}
      </div>
      <span class="history-category ${cat.cls}">${cat.label}</span>
    `;
    historyList.appendChild(item);
  });
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ── Chart ───────────────────────────────────────────────── */
function renderChart(readings) {
  const last7 = readings.slice(0, 7).reverse(); // oldest → newest

  if (last7.length < 2) {
    chartEmpty.classList.remove('hidden');
    chartCanvas.classList.add('hidden');
    return;
  }

  chartEmpty.classList.add('hidden');
  chartCanvas.classList.remove('hidden');

  const dpr    = window.devicePixelRatio || 1;
  const width  = chartCanvas.parentElement.clientWidth;
  const height = 120;

  chartCanvas.width  = width  * dpr;
  chartCanvas.height = height * dpr;
  chartCanvas.style.width  = width  + 'px';
  chartCanvas.style.height = height + 'px';

  const ctx = chartCanvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  const pad   = { top: 12, right: 12, bottom: 28, left: 32 };
  const w     = width  - pad.left - pad.right;
  const h     = height - pad.top  - pad.bottom;

  const allVals = last7.flatMap(r => [r.systolic, r.diastolic]);
  const minV = Math.max(40,  Math.min(...allVals) - 10);
  const maxV = Math.min(200, Math.max(...allVals) + 10);
  const range = maxV - minV;

  const xOf = i => pad.left + (i / (last7.length - 1)) * w;
  const yOf = v => pad.top  + (1 - (v - minV) / range) * h;

  // Gridlines
  const yTicks = [80, 120, 140, 180];
  ctx.textAlign = 'right';
  ctx.font = '10px -apple-system, sans-serif';
  yTicks.forEach(t => {
    if (t < minV || t > maxV) return;
    const y = yOf(t);
    ctx.strokeStyle = 'rgba(0,0,0,.07)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + w, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#aaa';
    ctx.fillText(t, pad.left - 4, y + 3.5);
  });

  // Draw a line for a series
  function drawLine(key, color) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap  = 'round';
    last7.forEach((r, i) => {
      const x = xOf(i), y = yOf(r[key]);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Dots
    last7.forEach((r, i) => {
      ctx.beginPath();
      ctx.arc(xOf(i), yOf(r[key]), 3.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    });
  }

  drawLine('diastolic', getComputedStyle(document.documentElement)
    .getPropertyValue('--diastolic-color').trim() || '#4ecdc4');
  drawLine('systolic',  getComputedStyle(document.documentElement)
    .getPropertyValue('--systolic-color').trim()  || '#ff6b6b');

  // X-axis date labels
  ctx.textAlign = 'center';
  ctx.fillStyle = '#aaa';
  ctx.font = '10px -apple-system, sans-serif';
  last7.forEach((r, i) => {
    const [, m, d] = r.date.split('-');
    ctx.fillText(`${parseInt(m)}/${parseInt(d)}`, xOf(i), height - 6);
  });
}

/* ── Helpers ─────────────────────────────────────────────── */
function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
}

function hideError() {
  errorMsg.classList.add('hidden');
}

/* ── Init ────────────────────────────────────────────────── */
renderAll();

// Rebuild chart on resize
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => renderChart(loadReadings()), 100);
});
