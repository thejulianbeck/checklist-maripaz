/* Maripaz Editorial Checklist PWA
   Weighted progress + Firebase Realtime Database sync (REST)
*/
(() => {
  'use strict';

  /* Sync: Firebase RTDB REST (CORS OK from github.io). No SDK required. */
  const SYNC_URL = 'https://checklist-maripaz-default-rtdb.firebaseio.com/maripaz.json';
  const LS_KEY = 'maripaz-checklist-v1';
  const PROJECT = 'maripaz';
  const POLL_MS = 20000;
  const PUT_DEBOUNCE_MS = 400;
  /* updatedAt in unix seconds (stable across clients). */
  function nowTs() { return Math.floor(Date.now() / 1000); }

  const el = {
    sections: document.getElementById('sections'),
    progressLabel: document.getElementById('progress-label'),
    progressPct: document.getElementById('progress-pct'),
    progressFill: document.getElementById('progress-fill'),
    syncPill: document.getElementById('sync-pill'),
    syncText: document.getElementById('sync-text'),
    toast: document.getElementById('toast'),
    metaTitle: document.getElementById('meta-title'),
    metaTipo: document.getElementById('meta-tipo'),
    metaAutor: document.getElementById('meta-autor'),
    metaAsins: document.getElementById('meta-asins'),
    metaIsbn: document.getElementById('meta-isbn'),
    itemCountChip: document.getElementById('item-count-chip'),
  };

  let DATA = null;
  let state = {
    project: PROJECT,
    updatedAt: 0,
    checked: {},
    notes: {},
  };
  let putTimer = null;
  let pollTimer = null;
  let syncFailWarned = false;
  let applyingRemote = false;

  function toast(msg) {
    if (!msg || !el.toast) return;
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      el.toast.classList.remove('show');
      el.toast.textContent = '';
    }, 2800);
  }

  function setSync(status, label) {
    el.syncPill.classList.remove('syncing', 'offline', 'warn');
    if (status) el.syncPill.classList.add(status);
    el.syncText.textContent = label;
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return {
        project: parsed.project || PROJECT,
        updatedAt: (function () {
          let u = Number(parsed.updatedAt) || 0;
          if (u > 1e12) u = Math.floor(u / 1000);
          return u;
        })(),
        checked: parsed.checked && typeof parsed.checked === 'object' ? parsed.checked : {},
        notes: parsed.notes && typeof parsed.notes === 'object' ? parsed.notes : {},
      };
    } catch {
      return null;
    }
  }

  function saveLocal() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('localStorage failed', e);
    }
  }

  function mergeStates(a, b) {
    // last updatedAt wins for the whole checked/notes map
    if ((b.updatedAt || 0) > (a.updatedAt || 0)) return {
      project: PROJECT,
      updatedAt: b.updatedAt,
      checked: { ...(b.checked || {}) },
      notes: { ...(b.notes || {}) },
    };
    return {
      project: PROJECT,
      updatedAt: a.updatedAt || 0,
      checked: { ...(a.checked || {}) },
      notes: { ...(a.notes || {}) },
    };
  }

  async function fetchRemote() {
    const res = await fetch(SYNC_URL + '?t=' + Date.now(), {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error('GET ' + res.status);
    const data = await res.json();
    // Firebase returns null if path empty; omits empty {} on write — treat missing as {}
    if (data == null || typeof data !== 'object') {
      return { project: PROJECT, updatedAt: 0, checked: {}, notes: {} };
    }
    let updatedAt = Number(data.updatedAt) || 0;
    // normalize legacy ms timestamps
    if (updatedAt > 1e12) updatedAt = Math.floor(updatedAt / 1000);
    return {
      project: data.project || PROJECT,
      updatedAt,
      checked: data.checked && typeof data.checked === 'object' ? data.checked : {},
      notes: data.notes && typeof data.notes === 'object' ? data.notes : {},
    };
  }

  async function putRemote() {
    const body = JSON.stringify({
      project: PROJECT,
      updatedAt: state.updatedAt,
      checked: state.checked,
      notes: state.notes || {},
    });
    const res = await fetch(SYNC_URL, {
      method: 'PUT',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
    });
    if (!res.ok) throw new Error('PUT ' + res.status);
    return true;
  }

  function schedulePut() {
    clearTimeout(putTimer);
    setSync('syncing', 'Sincronizando…');
    putTimer = setTimeout(async () => {
      if (!navigator.onLine) {
        setSync('offline', 'Sin conexión (local)');
        return;
      }
      try {
        await putRemote();
        const hh = new Date().toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setSync('', 'Sincronizado · ' + hh);
        syncFailWarned = false;
      } catch (e) {
        setSync('warn', 'Sync falló · local OK');
        if (!syncFailWarned) {
          syncFailWarned = true;
          toast('No se pudo sincronizar en la nube. El progreso queda guardado en este dispositivo.');
        }
      }
    }, PUT_DEBOUNCE_MS);
  }

  function allItems() {
    const list = [];
    for (const sec of DATA.sections) {
      for (const it of sec.items) list.push(it);
    }
    return list;
  }

  function computeProgress() {
    // Weighted: sum weight_pct of checked items (N/A have 0, placeholders count)
    let doneWeight = 0;
    let doneCount = 0;
    let actionable = 0;
    for (const it of allItems()) {
      const w = Number(it.weight_pct) || 0;
      if (it.na || w === 0) continue;
      actionable += 1;
      if (state.checked[it.id]) {
        doneWeight += w;
        doneCount += 1;
      }
    }
    const pct = Math.min(100, Math.round(doneWeight * 10) / 10);
    return { pct, doneCount, actionable, doneWeight };
  }

  function updateProgressUI() {
    const { pct, doneCount, actionable } = computeProgress();
    el.progressPct.textContent = (Number.isInteger(pct) ? pct : pct.toFixed(1)) + '%';
    el.progressFill.style.width = pct + '%';
    el.progressLabel.textContent = `${doneCount} de ${actionable} · progreso ponderado`;
  }


  function formatRichText(s) {
    // Preserve paragraphs; escape HTML; keep simple backticks as <code>
    const esc = escapeHtml(s || '');
    return esc
      .split(/\n\n+/)
      .map((para) => `<p>${para.replace(/\n/g, '<br>').replace(/`([^`]+)`/g, '<code>$1</code>')}</p>`)
      .join('');
  }

  function buildDetailHtml(it) {
    const parts = [];
    const rich = it.description_rich || it.description || '';
    parts.push(`<div class="detail-block"><div class="detail-label">Cómo</div><div class="detail-body">${formatRichText(rich)}</div></div>`);

    if (it.steps && it.steps.length) {
      const lis = it.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('');
      parts.push(`<div class="detail-block"><div class="detail-label">Pasos</div><ol class="detail-steps">${lis}</ol></div>`);
    }

    if (it.done_when) {
      parts.push(`<div class="detail-block detail-done"><div class="detail-label">Listo cuando</div><div class="detail-body">${escapeHtml(it.done_when)}</div></div>`);
    }

    const actors = it.actors && it.actors.length ? it.actors : (it.tags || []);
    if (actors.length) {
      const chips = actors.map((a) => `<span class="tag tag-${escapeHtml(a)}">[${escapeHtml(a)}]</span>`).join(' ');
      parts.push(`<div class="detail-block"><div class="detail-label">Quién</div><div class="detail-body detail-actors">${chips}</div></div>`);
    }

    if (it.na && it.na_reason) {
      parts.push(`<div class="detail-block detail-na"><div class="detail-label">Por qué N/A</div><div class="detail-body">${escapeHtml(it.na_reason)}</div></div>`);
    }
    if (it.placeholder && it.placeholder_note) {
      parts.push(`<div class="detail-block detail-ph"><div class="detail-label">PLACEHOLDER</div><div class="detail-body">${escapeHtml(it.placeholder_note)}</div></div>`);
    }

    const weightNote = it.na || !(Number(it.weight_pct) > 0)
      ? 'Peso: 0 % (N/A — no cuenta en el progreso).'
      : `Peso: ${Number(it.weight_pct).toFixed(1)} % del proyecto${it.effort_band ? ' · ' + it.effort_band : ''}.`;
    parts.push(`<div class="detail-meta">${escapeHtml(weightNote)}</div>`);

    if (it.cites && it.cites.length) {
      parts.push(`<div class="cites">${it.cites.map((c) => `<span class="tag tag-cite">(${escapeHtml(c)})</span>`).join('')}</div>`);
    }
    return parts.join('');
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function tagHtml(tags, it) {
    const parts = [];
    if (it.na) parts.push('<span class="tag tag-NA">N/A</span>');
    if (it.placeholder) parts.push('<span class="tag tag-PH">PLACEHOLDER</span>');
    for (const t of tags || []) {
      parts.push(`<span class="tag tag-${escapeHtml(t)}">[${escapeHtml(t)}]</span>`);
    }
    return parts.join('');
  }

  function render() {
    const meta = DATA.meta;
    el.metaTitle.textContent = meta.title;
    el.metaTipo.textContent = meta.tipo;
    el.metaAutor.textContent = meta.autor;
    el.metaAsins.textContent = `${meta.asins.paperback} (tapa blanda) / ${meta.asins.kindle} (Kindle)`;
    el.metaIsbn.textContent = meta.isbn;
    el.itemCountChip.textContent = `${allItems().length} ítems`;

    const frag = document.createDocumentFragment();
    for (const sec of DATA.sections) {
      const sectionEl = document.createElement('section');
      sectionEl.className = 'section' + (sec.num <= 1 ? ' open' : '');
      sectionEl.dataset.section = sec.num;

      const actionable = sec.items.filter((it) => !it.na && (Number(it.weight_pct) || 0) > 0);
      const doneInSec = actionable.filter((it) => state.checked[it.id]).length;
      const secWeightDone = sec.items.reduce((acc, it) => {
        const w = Number(it.weight_pct) || 0;
        return acc + (state.checked[it.id] && w > 0 ? w : 0);
      }, 0);
      const secWeightTotal = sec.items.reduce((acc, it) => acc + (Number(it.weight_pct) || 0), 0);

      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'section-head';
      head.setAttribute('aria-expanded', sectionEl.classList.contains('open') ? 'true' : 'false');
      head.innerHTML = `
        <span class="left">
          <span class="section-num">Sección ${sec.num}</span>
          <span class="section-title">${escapeHtml(sec.title)}</span>
        </span>
        <span class="section-count">${doneInSec}/${actionable.length} · ${secWeightDone.toFixed(1)}/${secWeightTotal.toFixed(1)}%</span>
        <span class="chevron" aria-hidden="true">▸</span>
      `;
      head.addEventListener('click', () => {
        sectionEl.classList.toggle('open');
        head.setAttribute('aria-expanded', sectionEl.classList.contains('open') ? 'true' : 'false');
      });

      const body = document.createElement('div');
      body.className = 'section-body';
      if (sec.intro) {
        const intro = document.createElement('p');
        intro.className = 'section-intro';
        intro.textContent = sec.intro;
        body.appendChild(intro);
      }

      let lastSub = undefined;
      for (const it of sec.items) {
        if (it.subsection && it.subsection !== lastSub) {
          lastSub = it.subsection;
          const sub = document.createElement('div');
          sub.className = 'subsection-label';
          sub.textContent = it.subsection;
          body.appendChild(sub);
        }

        const item = document.createElement('div');
        const isDone = !!state.checked[it.id];
        item.className = 'item'
          + (isDone ? ' done' : '')
          + (it.na ? ' na' : '')
          + (it.placeholder ? ' placeholder' : '');
        item.dataset.id = it.id;

        const check = document.createElement('button');
        check.type = 'button';
        check.className = 'check';
        check.setAttribute('aria-label', it.na ? 'N/A' : (isDone ? 'Desmarcar' : 'Marcar hecho'));
        if (it.na) {
          check.disabled = true;
          check.textContent = 'N/A';
        } else {
          check.textContent = isDone ? '✓' : '';
          check.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleItem(it.id);
          });
        }

        const main = document.createElement('div');
        main.className = 'item-main';
        main.innerHTML = `
          <p class="item-title">${escapeHtml(it.title)}</p>
          <div class="item-tags">${tagHtml(it.tags, it)}</div>
        `;
        main.addEventListener('click', () => {
          if (it.na) return;
          toggleItem(it.id);
        });

        const expand = document.createElement('button');
        expand.type = 'button';
        expand.className = 'expand';
        expand.setAttribute('aria-label', 'Ver detalle');
        expand.textContent = '▾';
        expand.addEventListener('click', (e) => {
          e.stopPropagation();
          item.classList.toggle('open');
        });

        const detail = document.createElement('div');
        detail.className = 'item-detail';
        detail.innerHTML = buildDetailHtml(it);

        item.appendChild(check);
        item.appendChild(main);
        item.appendChild(expand);
        item.appendChild(detail);
        body.appendChild(item);
      }

      sectionEl.appendChild(head);
      sectionEl.appendChild(body);
      frag.appendChild(sectionEl);
    }
    el.sections.innerHTML = '';
    el.sections.appendChild(frag);
    updateProgressUI();
  }

  function refreshChecksOnly() {
    // lighter update after remote poll
    for (const item of el.sections.querySelectorAll('.item')) {
      const id = item.dataset.id;
      const it = allItems().find((x) => x.id === id);
      if (!it || it.na) continue;
      const done = !!state.checked[id];
      item.classList.toggle('done', done);
      const check = item.querySelector('.check');
      if (check && !check.disabled) {
        check.textContent = done ? '✓' : '';
        check.setAttribute('aria-label', done ? 'Desmarcar' : 'Marcar hecho');
      }
    }
    // update section counts
    for (const sectionEl of el.sections.querySelectorAll('.section')) {
      const num = Number(sectionEl.dataset.section);
      const sec = DATA.sections.find((s) => s.num === num);
      if (!sec) continue;
      const actionable = sec.items.filter((it) => !it.na && (Number(it.weight_pct) || 0) > 0);
      const doneInSec = actionable.filter((it) => state.checked[it.id]).length;
      const secWeightDone = sec.items.reduce((acc, it) => {
        const w = Number(it.weight_pct) || 0;
        return acc + (state.checked[it.id] && w > 0 ? w : 0);
      }, 0);
      const secWeightTotal = sec.items.reduce((acc, it) => acc + (Number(it.weight_pct) || 0), 0);
      const countEl = sectionEl.querySelector('.section-count');
      if (countEl) {
        countEl.textContent = `${doneInSec}/${actionable.length} · ${secWeightDone.toFixed(1)}/${secWeightTotal.toFixed(1)}%`;
      }
    }
    updateProgressUI();
  }

  function toggleItem(id) {
    if (applyingRemote) return;
    const it = allItems().find((x) => x.id === id);
    if (!it || it.na) return;
    if (state.checked[id]) delete state.checked[id];
    else state.checked[id] = true;
    state.updatedAt = nowTs();
    state.project = PROJECT;
    saveLocal();
    refreshChecksOnly();
    schedulePut();
  }

  async function initialSync() {
    const local = loadLocal();
    if (local) state = mergeStates(state, local);

    if (!navigator.onLine) {
      setSync('offline', 'Sin conexión (local)');
      return;
    }
    setSync('syncing', 'Sincronizando…');
    try {
      const remote = await fetchRemote();
      const merged = mergeStates(state, remote);
      // If local was newer, push; if remote newer or equal after merge of remote, use remote
      const localNewer = (state.updatedAt || 0) > (remote.updatedAt || 0);
      state = merged;
      saveLocal();
      if (localNewer && state.updatedAt > 0) {
        await putRemote();
      }
      const hh = new Date().toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setSync('', 'Sincronizado · ' + hh);
    } catch (e) {
      setSync('warn', 'Sync falló · local OK');
      toast('Usando copia local. Reintentaremos sincronizar en segundo plano.');
    }
  }

  async function pollRemote() {
    if (document.hidden || !navigator.onLine) return;
    try {
      const remote = await fetchRemote();
      if ((remote.updatedAt || 0) > (state.updatedAt || 0)) {
        applyingRemote = true;
        state = {
          project: PROJECT,
          updatedAt: remote.updatedAt,
          checked: { ...(remote.checked || {}) },
          notes: { ...(remote.notes || {}) },
        };
        saveLocal();
        refreshChecksOnly();
        applyingRemote = false;
        const hh = new Date().toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setSync('', 'Sincronizado · ' + hh);
      }
    } catch {
      // soft fail
    }
  }

  function startPolling() {
    function armPoll() {
      clearInterval(pollTimer);
      pollTimer = null;
      if (document.hidden) return;
      pollTimer = setInterval(pollRemote, POLL_MS);
    }
    armPoll();
    document.addEventListener('visibilitychange', () => {
      armPoll();
      if (!document.hidden) pollRemote();
    });
    window.addEventListener('online', () => {
      setSync('syncing', 'Sincronizando…');
      schedulePut();
      pollRemote();
    });
    window.addEventListener('offline', () => {
      setSync('offline', 'Sin conexión (local)');
    });
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./sw.js').catch((e) => {
      console.warn('SW register failed', e);
    });
  }


  function applyDefaultChecked() {
    // Seed defaults only for ids never present in checked (fresh install / empty remote).
    // Once a key exists (true or later deleted by user after sync), we do not re-force it here;
    // Firebase / local state owns ongoing toggles. We only fill missing keys when the map is empty
    // OR when the id is absent and remote had no opinion yet on first paint after empty sync.
    let changed = false;
    const checkedEmpty = !state.checked || Object.keys(state.checked).length === 0;
    for (const it of allItems()) {
      if (!it.defaultChecked || it.na) continue;
      if (state.checked[it.id]) continue;
      if (!(it.id in (state.checked || {}))) {
        // If map already has other checks, still seed missing defaultChecked ids once
        // unless user explicitly had remote state without them (then remote wins via sync).
        if (checkedEmpty || !state._defaultsApplied) {
          state.checked[it.id] = true;
          changed = true;
        }
      }
    }
    if (changed) {
      state._defaultsApplied = true;
      state.updatedAt = Math.max(Number(state.updatedAt) || 0, nowTs());
      state.project = PROJECT;
      saveLocal();
      schedulePut();
    } else {
      state._defaultsApplied = true;
    }
  }

  async function boot() {
    try {
      const res = await fetch('./data.json?v=20260929h', { cache: 'no-store' });
      DATA = await res.json();
    } catch (e) {
      el.sections.innerHTML = '<p class="footer-note">No se pudo cargar el checklist.</p>';
      return;
    }
    const n = allItems().length;
    if (n !== 90) {
      console.warn('Expected 90 items, got', n);
    }
    await initialSync();
    applyDefaultChecked();
    render();
    startPolling();
    registerSW();
  }

  boot();
})();
