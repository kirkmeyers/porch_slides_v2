import JSZip from 'jszip';
import { parseRequestFile, parseVerseLines, extractCommunicatorLastName, dateCode, sentenceCase, THEME_ALIASES } from './src/requests.js';
import {
  buildSlides, passageSlides, slideBlock, layoutTextSlide, measureSlide, loadPassageText,
  layoutForKind, makeSlide, newId, KIND_LABELS, passageLabel, boxMeasure,
} from './src/slides.js';
import { parseTheme, resolveLayouts } from './src/theme.js';
import { setFontMap, measure, fontMetrics, clearMetricsCache, drawSlide, renderSlidePng } from './src/render.js';
import { fetchChapter, cleanVerseText, isNivTranslation, translationName, TRANSLATIONS } from './src/bible.js';
import { parseRuns, plainText, readingText, setDim, isAllDim, sliceText } from './src/layout.js';
import { createTextBox, bindEditable, textToHtml, selectionOffsets, setSelectionOffsets } from './src/inline-editor.js';
import { exportBundle, slideNotes, locationsNotes } from './src/propresenter.js';
import { fetchLiveLocations, splitLocations } from './src/asana.js';
import {
  compressDeckPayload, decompressDeckPayload, decompressOutlinePayload, encodeOutlineLink,
} from './src/links.js';
import { THEMES } from './src/themes/index.js';
import sampleRequests from './reference/sample-requests.txt?raw';

// ---------- State ----------
const state = {
  theme: null, // theme config
  layouts: null, // resolved layouts
  size: { w: 3840, h: 2160 },
  header: {},
  loadWarnings: [],
  slides: [],
  passages: {}, // scripture passages by group id (see slides.js)
  active: 0,
  view: 'grid',
  bg: 'video',
  dimOpacity: 0.25,
  context: 2,
  loading: false,
  // This week's Porch Live locations: { list, source: 'asana' | 'request' | 'typed', task }
  locations: { list: [], source: null, task: null },
};

const $ = id => document.getElementById(id);

// ---------- Small helpers ----------
function storageGet(key, fallback) {
  try {
    const v = localStorage.getItem(`porch_slides_v2.${key}`);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(`porch_slides_v2.${key}`, JSON.stringify(value));
  } catch {
    // Private windows can block storage; settings just won't persist
  }
}

function showToast(message, kind = '', duration = 3600) {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = message;
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), duration);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const oneLine = s => (s || '').replace(/\s*\n\s*/g, ' ').trim();

const ICON_NOTE = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
const ICON_WARN = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
const SPINNER = '<svg class="btn-icon btn-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>';

// ---------- Theme ----------
async function loadTheme(config) {
  const bytes = new Uint8Array(await (await fetch(config.themeUrl)).arrayBuffer());
  const parsed = parseTheme(bytes);
  state.theme = config;
  state.layouts = resolveLayouts(config, parsed);
  state.size = state.layouts.scripture.slide.size;
  setFontMap(config.fonts);
  clearMetricsCache();
  // Wait for the slide fonts before anything is measured
  await Promise.all(Object.values(config.fonts).map(f => document.fonts.load(`${f.weight} 100px "${f.family}"`)));
  await document.fonts.ready;
  $('theme-select').value = config.id;
  // Black-text themes need a light preview behind them, and the reverse
  if (config.dark && (state.bg === 'video' || state.bg === 'black')) setBg('light');
  if (!config.dark && state.bg === 'light') setBg('video');
}

/** What the slide builders need: the theme's boxes and how to measure text. */
function ctx() {
  return {
    layouts: state.layouts,
    measure,
    metricsFor: fontMetrics,
    fetchChapter,
    context: state.context,
    sentenceCasePoints: !!state.theme.sentenceCasePoints,
  };
}

/** Index range [start, end] of the slides in a group. */
function groupRange(group) {
  const start = state.slides.findIndex(s => s.group === group);
  let end = start;
  while (end + 1 < state.slides.length && state.slides[end + 1].group === group) end += 1;
  return [start, end];
}

/** Lay a passage out again from its verses, keeping the operator's notes. */
function rebuildPassage(group) {
  const passage = state.passages[group];
  const [start, end] = groupRange(group);
  if (!passage || start < 0) return null;
  const old = state.slides.slice(start, end + 1);
  const rebuilt = passageSlides(passage, ctx());
  if (rebuilt.length) rebuilt[0].cues = old.flatMap(s => s.cues);
  state.slides.splice(start, old.length, ...rebuilt);
  return { start, count: rebuilt.length };
}

/**
 * After a theme or setting change: lay out every passage and text slide again,
 * except slides the operator changed by hand, which are only measured.
 */
function relayoutAll() {
  const groups = [...new Set(state.slides.filter(s => s.kind === 'scripture' && state.passages[s.group]).map(s => s.group))];
  for (const g of groups) {
    const [start, end] = groupRange(g);
    if (!state.slides.slice(start, end + 1).some(s => s.edited)) rebuildPassage(g);
  }
  const c = ctx();
  state.slides = state.slides.map(s => {
    if (s.kind === 'point' && !s.edited && s.original) {
      const source = c.sentenceCasePoints ? sentenceCase(s.original) : s.original;
      return layoutTextSlide({ ...s, source }, c);
    }
    if ((s.kind === 'point' || s.kind === 'quote') && !s.edited) return layoutTextSlide(s, c);
    return measureSlide(s, c);
  });
}

// ---------- Porch Live locations ----------
function setLocations(list, source, task = null) {
  state.locations = { list, source, task };
  $('live-locations').value = list.join(', ');
  renderLocationsStatus();
  renderWarnings();
}

function renderLocationsStatus(message) {
  const { list, source, task } = state.locations;
  const el = $('locations-status');
  if (message) {
    el.textContent = message;
    return;
  }
  if (source === 'asana' && task) {
    el.innerHTML = `${list.length ? 'From' : 'Nothing listed yet in'} <a href="${escapeHtml(task.url)}" target="_blank" rel="noopener">${escapeHtml(task.name.trim())}</a>${state.locations.otherDate ? ' (dated for another week; check it)' : ''}`;
  } else if (source === 'request') {
    el.textContent = 'From the request file.';
  } else if (source === 'typed') {
    el.textContent = 'Typed in.';
  } else {
    el.textContent = storageGet('asanaToken', '') ? '' : 'Add an Asana token in Settings to fill these in automatically.';
  }
}

/** Get this week's locations from Asana (needs a token in Settings). */
async function loadLocationsFromAsana({ quiet = false } = {}) {
  const token = storageGet('asanaToken', '');
  if (!token) {
    if (!quiet) showToast('Add your Asana token in Settings first.', 'warn');
    renderLocationsStatus();
    return;
  }
  const date = $('service-date').value || todayIso();
  renderLocationsStatus('Checking Asana…');
  try {
    const found = await fetchLiveLocations({ token, date });
    if (!found) {
      setLocations([], null);
      renderLocationsStatus(`No Live Locations task in Asana for ${date}.`);
      return;
    }
    setLocations(found.locations, 'asana', found.task);
    state.locations.otherDate = found.otherDate;
    renderLocationsStatus();
    if (!quiet && found.locations.length) showToast(`Porch Live: ${found.locations.join(', ')}.`);
  } catch (err) {
    console.error(err);
    renderLocationsStatus(err.message || 'Couldn’t reach Asana.');
  }
}

// ---------- Loading requests ----------
async function loadRequestText(text, sourceLabel) {
  const parsed = parseRequestFile(text);
  if (!parsed.entries.length) {
    showToast('No slide requests found in that file.', 'warn');
    return;
  }
  if (state.loading) return;
  state.loading = true;
  const h = parsed.header;
  const themeId = h.theme && THEME_ALIASES[h.theme.toLowerCase().trim()];
  const theme = themeId && THEMES.find(t => t.id === themeId);
  if (theme && theme !== state.theme) await loadTheme(theme);
  if (h.communicator) $('communicator').value = h.communicator;
  $('service-date').value = /^\d{4}-\d{2}-\d{2}$/.test(h.date || '') ? h.date : todayIso();
  if (h.locations) setLocations(splitLocations(h.locations), 'request');
  else loadLocationsFromAsana({ quiet: true });

  const status = $('load-status');
  status.textContent = 'Getting scripture from Bolls…';
  try {
    const { slides, passages } = await buildSlides(parsed, ctx());
    // Keep each point's request text, so a theme change can recase it
    const byGroup = Object.fromEntries(parsed.entries.map((e, i) => [`e${i}`, e]));
    for (const s of slides) if (s.kind === 'point' && byGroup[s.group]) s.original = byGroup[s.group].text;
    state.header = h;
    state.loadWarnings = parsed.warnings;
    state.slides = slides;
    state.passages = passages;
    state.active = 0;
  } finally {
    state.loading = false;
    status.textContent = '';
  }
  $('review-banner').hidden = true;
  setView('grid');
  renderAll();
  const n = state.slides.length;
  showToast(`Loaded ${n} slide${n === 1 ? '' : 's'}${sourceLabel ? ` from ${sourceLabel}` : ''}.`);
}

async function handleFile(file) {
  if (!file) return;
  if (!/\.txt$/i.test(file.name) && file.type && file.type !== 'text/plain') {
    showToast('That isn’t a request file. Load the requests .txt.', 'warn');
    return;
  }
  if (state.slides.some(s => s.edited) && !confirm('Replace the current slides? Your edits will be lost.')) return;
  await loadRequestText(await file.text(), file.name);
}

// ---------- Warnings ----------
function slideIssues(slide) {
  const issues = slide.checks.map(c => (typeof c === 'string' ? { text: c } : c));
  if (slide.needsText) issues.push({ danger: true, text: 'Verse text needed.' });
  if (slide.overflow) issues.push({ danger: true, text: `Text is too tall for the box (${slide.lines} lines); remove context or split the slide.` });
  return issues;
}

function renderWarnings() {
  const list = $('warning-list');
  list.innerHTML = '';
  let count = 0;
  if (state.slides.length && !state.locations.list.length) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="where">Porch Live</span>No locations yet for the confidence monitor. Get them from Asana or type them in.';
    list.appendChild(li);
    count += 1;
  }
  for (const f of state.loadWarnings) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="where">Request file</span>${escapeHtml(f)}`;
    list.appendChild(li);
    count += 1;
  }
  state.slides.forEach((slide, i) => {
    for (const issue of slideIssues(slide)) {
      const li = document.createElement('li');
      li.className = `clickable${issue.danger ? ' danger' : ''}`;
      li.innerHTML = `<span class="where">Slide ${i + 1} · ${escapeHtml(oneLine(slide.reference) || KIND_LABELS[slide.kind])}</span>${escapeHtml(issue.text)}`;
      li.addEventListener('click', () => openEditor(i));
      list.appendChild(li);
      count += 1;
    }
  });
  $('warnings-card').hidden = count === 0;
  $('warning-count').textContent = count;
}

// ---------- Deck info ----------
function renderDeckInfo() {
  const h = state.header;
  const info = $('deck-info');
  if (!h.title && !h.date && !h.translation) {
    info.hidden = true;
    return;
  }
  info.hidden = false;
  $('deck-title').textContent = h.title || 'Untitled';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(h.date || '') ? new Date(`${h.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '';
  $('deck-meta').innerHTML = [date, h.translation && `Translation: ${escapeHtml(h.translation)}`]
    .filter(Boolean)
    .join('<br>');
}

// ---------- Grid ----------
let dragIndex = null;

function slideBadges(slide) {
  const issues = slideIssues(slide);
  let html = '';
  if (issues.length) {
    const danger = issues.some(i => i.danger);
    html += `<span class="badge${danger ? ' danger' : ''}" title="${escapeHtml(issues.map(i => i.text).join('\n'))}">${ICON_WARN}${issues.length}</span>`;
  }
  if (slide.cues.length) {
    html += `<span class="badge note" title="${escapeHtml(slide.cues.join('\n'))}">${ICON_NOTE}${slide.cues.length} note${slide.cues.length === 1 ? '' : 's'}</span>`;
  }
  return html;
}

function cardCaption(slide) {
  if (slide.kind === 'scripture') {
    const p = state.passages[slide.group];
    const t = p && p.translation !== 'ESV' ? ` (${translationName(p.translation)})` : '';
    return `${oneLine(slide.reference)}${t}`;
  }
  if (slide.kind === 'quote') return slide.reference;
  if (slide.kind === 'blank') return '';
  return oneLine(plainText(slide.text));
}

function renderGrid() {
  const grid = $('grid');
  grid.innerHTML = '';
  state.slides.forEach((slide, i) => {
    const card = document.createElement('div');
    card.className = `slide-card${i === state.active ? ' active' : ''}`;
    card.draggable = true;
    card.innerHTML = `
      <div class="thumb bg-${state.bg}"><canvas width="640" height="360"></canvas></div>
      <div class="slide-meta">
        <span class="slide-num">${i + 1}</span>
        <span class="kind-tag ${slide.kind}">${KIND_LABELS[slide.kind]}</span>
        <span class="slide-ref">${escapeHtml(cardCaption(slide))}</span>
        ${slideBadges(slide)}
      </div>`;
    card.addEventListener('click', () => selectSlide(i));
    card.addEventListener('dblclick', () => openEditor(i));
    card.addEventListener('dragstart', e => {
      dragIndex = i;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/x-slide', String(i));
    });
    card.addEventListener('dragend', () => {
      dragIndex = null;
      card.classList.remove('dragging');
      grid.querySelectorAll('.drop-before, .drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'));
    });
    card.addEventListener('dragover', e => {
      if (dragIndex === null) return;
      e.preventDefault();
      const after = e.offsetX > card.offsetWidth / 2;
      card.classList.toggle('drop-after', after);
      card.classList.toggle('drop-before', !after);
    });
    card.addEventListener('dragleave', () => card.classList.remove('drop-before', 'drop-after'));
    card.addEventListener('drop', e => {
      if (dragIndex === null) return;
      e.preventDefault();
      e.stopPropagation();
      const after = e.offsetX > card.offsetWidth / 2;
      moveSlide(dragIndex, after ? i + 1 : i);
    });
    grid.appendChild(card);
    const canvas = card.querySelector('canvas');
    const c2d = canvas.getContext('2d');
    c2d.setTransform(canvas.width / state.size.w, 0, 0, canvas.height / state.size.h, 0, 0);
    drawSlide(c2d, slide, state.layouts, state.theme.assets, { dimOpacity: state.dimOpacity });
  });
}

/** Select a slide in the grid without opening it. */
function selectSlide(index) {
  state.active = Math.max(0, Math.min(index, state.slides.length - 1));
  const cards = $('grid').querySelectorAll('.slide-card');
  cards.forEach((c, i) => c.classList.toggle('active', i === state.active));
  cards[state.active]?.scrollIntoView({ block: 'nearest' });
}

/** Number of columns the grid is showing right now, for Up/Down. */
function gridColumns() {
  return getComputedStyle($('grid')).gridTemplateColumns.split(' ').filter(Boolean).length || 1;
}

// ---------- Editor ----------
function activeSlide() {
  return state.slides[state.active];
}

function drawEditorCanvas() {
  const slide = activeSlide();
  if (!slide) return;
  const canvas = $('editor-canvas');
  if (canvas.width !== state.size.w) {
    canvas.width = state.size.w;
    canvas.height = state.size.h;
  }
  // The text itself is drawn by the editable boxes on top
  drawSlide(canvas.getContext('2d'), slide, state.layouts, state.theme.assets, { dimOpacity: state.dimOpacity, skipText: true });
}

// Scale the full-size editing layer to the preview frame
function fitSlideLayer() {
  const frame = $('canvas-frame');
  const layer = $('slide-layer');
  layer.style.width = `${state.size.w}px`;
  layer.style.height = `${state.size.h}px`;
  layer.style.transform = `scale(${frame.clientWidth / state.size.w})`;
}

/** Recount lines for a slide after its text changes by hand. */
function updateOverflow(slide) {
  Object.assign(slide, measureSlide(slide, ctx()));
}

let activeEditable = null; // the main text editable, for dimming and splitting
let lastCaret = null; // { start, end } in the main text, kept while focus moves to buttons

/** Build the editable text boxes for the active slide. */
function renderSlideLayer() {
  const slide = activeSlide();
  const layer = $('slide-layer');
  layer.innerHTML = '';
  layer.style.setProperty('--dim', state.dimOpacity);
  activeEditable = null;
  lastCaret = null;
  fitSlideLayer();
  if (!slide || !slide.layout || slide.kind === 'blank') return;

  const layout = state.layouts[slide.layout];
  const main = createTextBox(layout.text, { placeholder: slide.kind === 'scripture' ? 'Verse text' : 'Slide text', align: slide.align });
  main.editor.innerHTML = textToHtml(slide.needsText ? '' : slide.text);
  bindEditable(main.editor, { onSplit: splitAtCursor }, text => {
    slide.text = text;
    slide.edited = true;
    if (slide.needsText && plainText(text).trim()) slide.needsText = false;
    updateOverflow(slide);
    slideEdited();
  });
  layer.appendChild(main.box);
  activeEditable = main.editor;

  if (layout.reference && (slide.kind === 'scripture' || slide.kind === 'quote')) {
    const ref = createTextBox(layout.reference, { placeholder: slide.kind === 'quote' ? 'Author' : 'Reference' });
    ref.editor.innerHTML = textToHtml(slide.reference || '');
    bindEditable(ref.editor, {}, text => {
      slide.reference = text.replace(/[{}^]/g, '');
      if (slide.kind === 'quote') slide.reference = oneLine(slide.reference);
      slideEdited();
    });
    layer.appendChild(ref.box);
  }
}

function renderEditorBadges() {
  const slide = activeSlide();
  $('editor-badges').innerHTML = slideIssues(slide)
    .map(i => `<div class="check${i.danger ? ' danger' : ''}">${escapeHtml(i.text)}</div>`)
    .join('');
  const badge = $('lines-badge');
  if (slide.layout && slide.kind !== 'blank' && !slide.needsText) {
    const { maxLines } = boxMeasure(state.layouts[slide.layout], measure, fontMetrics);
    badge.textContent = `${slide.lines ?? 0} / ${maxLines} lines`;
    badge.classList.toggle('over', !!slide.overflow);
  } else {
    badge.textContent = '';
  }
  $('auto-notes').textContent = slide.kind === 'blank' ? '' : slideNotes({ ...slide, cues: [] });
}

function renderEditor() {
  const slide = activeSlide();
  if (!slide) return;
  $('editor-position').textContent = `Slide ${state.active + 1} of ${state.slides.length}`;
  $('edit-kind').value = slide.kind;
  const passage = slide.kind === 'scripture' ? state.passages[slide.group] : null;
  $('translation-field').hidden = !passage;
  if (passage) {
    const source = passage.sourceTranslation;
    const fromFile = !!passage.manuscript;
    $('edit-translation').innerHTML = Object.entries(TRANSLATIONS)
      .map(([code, name]) => `<option value="${code}">${name}${code === source && fromFile ? ' (request file)' : ''}${isNivTranslation(code) && !(code === source && fromFile) ? ' (paste it in)' : ''}</option>`)
      .join('');
    $('edit-translation').value = passage.translation;
  }
  $('btn-relayout').disabled = !slide.layout || slide.kind === 'blank';
  $('btn-dim').disabled = !slide.layout || slide.kind === 'blank';

  // Context verses on this slide
  const canContext = !!(passage && passage.verses && slide.ref && !slide.needsText && !slide.ref.part);
  $('context-field').hidden = !canContext;
  if (canContext) {
    const nums = passage.verses.map(v => v.verse);
    const { start, end, verse } = slide.ref;
    $('btn-ctx-up-less').disabled = start >= verse;
    $('btn-ctx-up-more').disabled = !nums.includes(start - 1);
    $('btn-ctx-down-less').disabled = end <= verse;
    $('btn-ctx-down-more').disabled = !nums.includes(end + 1);
    $('context-range').textContent = `Showing ${passage.chapter}:${start}${end !== start ? `-${end}` : ''}${slide.edited ? ' (edited by hand)' : ''}`;
  }

  // Paste box for passages without text (NIV) or with the request file's text
  const showPaste = !!passage && (!passage.verses || slide.needsText || isNivTranslation(passage.translation));
  $('paste-field').hidden = !showPaste;
  if (showPaste) $('paste-label').textContent = `Paste ${passageLabel(passage)} (${translationName(passage.translation)})`;

  // Notes
  const cueList = $('cue-list');
  cueList.innerHTML = '';
  slide.cues.forEach((cue, ci) => {
    const li = document.createElement('li');
    li.innerHTML = `<div>${escapeHtml(cue)}</div>
      <div class="cue-actions"><button class="btn btn-small btn-danger" data-act="remove">Remove</button></div>`;
    li.querySelector('button').addEventListener('click', () => {
      slide.cues.splice(ci, 1);
      renderAll();
    });
    cueList.appendChild(li);
  });

  renderEditorBadges();
  drawEditorCanvas();
  renderSlideLayer();
}

function openEditor(index) {
  state.active = Math.max(0, Math.min(index, state.slides.length - 1));
  setView('editor');
  renderEditor();
}

function setView(view) {
  state.view = view;
  const has = state.slides.length > 0;
  $('view-grid').classList.toggle('active', view === 'grid');
  $('view-editor').classList.toggle('active', view === 'editor');
  $('empty-state').hidden = has;
  $('grid').hidden = !has || view !== 'grid';
  $('editor').hidden = !has || view !== 'editor';
  if (has && view === 'grid') {
    renderGrid();
    $('grid').querySelectorAll('.slide-card')[state.active]?.scrollIntoView({ block: 'nearest' });
  }
}

function renderAll() {
  const has = state.slides.length > 0;
  for (const id of ['btn-export-pro', 'btn-export-zip', 'btn-export-png', 'btn-share', 'btn-proof', 'btn-add-slide']) $(id).disabled = !has;
  const counts = state.slides.reduce((acc, s) => ((acc[s.kind] = (acc[s.kind] || 0) + 1), acc), {});
  $('slide-count').textContent = has
    ? `${state.slides.length} slides · ${['scripture', 'point', 'quote', 'blank'].filter(k => counts[k]).map(k => `${counts[k]} ${KIND_LABELS[k].toLowerCase()}`).join(', ')}`
    : '';
  if (state.active >= state.slides.length) state.active = Math.max(0, state.slides.length - 1);
  renderDeckInfo();
  renderWarnings();
  setView(state.view);
  if (state.view === 'editor' && has) renderEditor();
}

// Re-render after an edit without rebuilding the whole grid every keystroke
let editTimer = null;
function slideEdited() {
  clearTimeout(editTimer);
  editTimer = setTimeout(() => {
    renderEditorBadges();
    renderWarnings();
  }, 60);
}

// ---------- Slide operations ----------
function insertSlide(index, slide) {
  state.slides.splice(index, 0, slide);
  state.active = index;
  renderAll();
}

function moveSlide(from, to) {
  if (to > from) to -= 1;
  if (from === to || to < 0 || to >= state.slides.length) {
    renderAll();
    return;
  }
  const [s] = state.slides.splice(from, 1);
  state.slides.splice(to, 0, s);
  state.active = to;
  renderAll();
}

function blankSlide() {
  return makeSlide('blank', { edited: true, lines: 0 });
}

/** Split the slide at the cursor and carry on typing at the start of the new slide (Option+Enter). */
function splitAtCursor() {
  const slide = activeSlide();
  const caret = activeEditable && selectionOffsets(activeEditable);
  const pos = (caret || lastCaret)?.start;
  const length = plainText(slide.text).length;
  if (pos == null || pos <= 0 || pos >= length) {
    showToast('Click in the slide text where the new slide should start.', 'warn');
    return;
  }
  const trim = t => t.replace(/^\s+|\s+$/g, '');
  const original = slide.text;
  slide.text = trim(sliceText(original, 0, pos));
  slide.edited = true;
  updateOverflow(slide);
  const second = { ...slide, id: newId(), text: trim(sliceText(original, pos, length)), cues: [], checks: [], edited: true };
  updateOverflow(second);
  state.slides.splice(state.active + 1, 0, second);
  state.active += 1;
  renderAll();
  if (activeEditable) {
    activeEditable.focus();
    setSelectionOffsets(activeEditable, 0);
  }
}

function mergeWithNext() {
  const a = activeSlide();
  const b = state.slides[state.active + 1];
  if (!b) return showToast('There’s no next slide to merge with.', 'warn');
  if (a.layout !== b.layout || a.kind === 'blank' || b.kind === 'blank') return showToast('Only slides of the same type can be merged.', 'warn');
  a.text = `${a.text.replace(/\s+$/, '')} ${b.text.replace(/^\s+/, '')}`.replace(/\n/g, ' ');
  a.cues = [...a.cues, ...b.cues];
  a.checks = [...a.checks, ...b.checks];
  a.edited = true;
  state.slides.splice(state.active + 1, 1);
  updateOverflow(a);
  renderAll();
  showToast('Merged. Press Enter in the text to place line breaks.');
}

let lastDelete = null; // { slide, index, neighbor, neighborCues } for ⌘Z

function deleteSlide() {
  const slide = activeSlide();
  if (!slide) return;
  const index = state.active;
  const next = state.slides[index + 1] || state.slides[index - 1];
  lastDelete = { slide, index, neighbor: next, neighborCues: next ? [...next.cues] : [] };
  if (slide.cues.length && next) next.cues = [...slide.cues, ...next.cues];
  state.slides.splice(index, 1);
  if (state.active >= state.slides.length) state.active = state.slides.length - 1;
  if (!state.slides.length) state.view = 'grid';
  renderAll();
  showToast(`${slide.cues.length && next ? 'Slide deleted; its notes moved to the neighboring slide.' : 'Slide deleted.'} Press ⌘Z to undo.`);
}

function undoDelete() {
  if (!lastDelete) return;
  const { slide, index, neighbor, neighborCues } = lastDelete;
  lastDelete = null;
  if (neighbor) neighbor.cues = neighborCues;
  state.slides.splice(index, 0, slide);
  state.active = index;
  renderAll();
  showToast('Slide restored.');
}

/** Dim the selected words on the slide, or undim them if they're all dimmed already. */
function toggleDim() {
  const slide = activeSlide();
  const editor = activeEditable;
  if (!editor) return;
  const sel = selectionOffsets(editor) || lastCaret;
  if (!sel || sel.start === sel.end) {
    showToast('Select words in the slide text first.', 'warn');
    return;
  }
  const dim = !isAllDim(slide.text, sel.start, sel.end);
  slide.text = setDim(slide.text, sel.start, sel.end, dim);
  slide.edited = true;
  editor.innerHTML = textToHtml(slide.text);
  editor.focus();
  setSelectionOffsets(editor, sel.start, sel.end);
  lastCaret = sel;
  slideEdited();
}

/** Lay the slide out again: a passage is rebuilt from its verses, a point or quote re-broken. */
function autoLayout() {
  const slide = activeSlide();
  if (slide.kind === 'scripture' && state.passages[slide.group]) {
    const [start, end] = groupRange(slide.group);
    const others = state.slides.slice(start, end + 1).filter(s => s !== slide && s.edited);
    if (others.length && !confirm('This lays out the whole passage again, including other slides you changed by hand. Continue?')) return;
    const offset = state.active - start;
    const r = rebuildPassage(slide.group);
    state.active = r.start + Math.min(offset, r.count - 1);
  } else if (slide.kind === 'point' || slide.kind === 'quote') {
    const source = slide.edited ? oneLine(slide.text) : slide.source || slide.text;
    state.slides[state.active] = layoutTextSlide({ ...slide, source, edited: false }, ctx());
  }
  renderAll();
}

/** The editor's context buttons: one verse more or less above or below. */
function changeContext(edge, delta) {
  const slide = activeSlide();
  const passage = state.passages[slide.group];
  if (!passage?.verses || !slide.ref) return;
  if (slide.edited && !confirm('This replaces your hand edits on this slide. Continue?')) return;
  const start = slide.ref.start + (edge === 'above' ? -delta : 0);
  const end = slide.ref.end + (edge === 'below' ? delta : 0);
  const next = slideBlock(passage, slide, start, end, ctx());
  state.slides[state.active] = next;
  renderAll();
  if (next.overflow) showToast(`That’s ${next.lines} lines, more than the box holds.`, 'warn');
}

/**
 * Switch a passage to another translation, like porch_slides' per-slide
 * picker. Text comes from the request file when switching back to its
 * translation, otherwise from Bolls. Bolls doesn't serve the NIV, so NIV
 * passages wait for pasted verses.
 */
async function changeTranslation(code) {
  const slide = activeSlide();
  const passage = state.passages[slide.group];
  if (!passage || code === passage.translation) return;
  const [start, end] = groupRange(slide.group);
  if (state.slides.slice(start, end + 1).some(s => s.edited) && !confirm('Switching translations replaces this passage’s text, including your edits. Continue?')) {
    $('edit-translation').value = passage.translation;
    return;
  }
  const previous = { translation: passage.translation, verses: passage.verses, checks: passage.checks };
  passage.translation = code;
  passage.checks = passage.checks.filter(c => !/Bolls|aren’t in the/.test(c));
  $('translation-field').classList.add('busy');
  await loadPassageText(passage, fetchChapter);
  $('translation-field').classList.remove('busy');
  if (!passage.verses && !isNivTranslation(code)) {
    Object.assign(passage, previous);
    $('edit-translation').value = passage.translation;
    showToast(`Couldn’t get the ${translationName(code)} from Bolls. Check the connection and try again.`, 'warn', 6000);
    return;
  }
  const offset = state.active - start;
  const r = rebuildPassage(slide.group);
  state.active = r.start + Math.min(offset, r.count - 1);
  renderAll();
  showToast(isNivTranslation(code) ? `Paste the ${translationName(code)} verses for ${passageLabel(passage)} in the editor.` : `${passageLabel(passage)} is now in the ${translationName(code)}.`, isNivTranslation(code) ? 'warn' : '');
}

/** Use pasted verses for the active passage (NIV, or a fix to the request file's text). */
function applyPastedVerses() {
  const slide = activeSlide();
  const passage = state.passages[slide.group];
  const raw = $('paste-verses').value;
  if (!passage || !raw.trim()) return;
  const verses = parseVerseLines(raw.split(/\r?\n/), passage.targets[0]).map(v => ({ verse: v.verse, text: cleanVerseText(v.text) }));
  if (!verses.length) {
    showToast('Start each verse with its number, one verse per line.', 'warn');
    return;
  }
  const missing = passage.targets.filter(t => !verses.some(v => v.verse === t));
  passage.verses = verses;
  passage.manuscript = verses;
  passage.sourceTranslation = passage.translation;
  passage.checks = [...passage.checks.filter(c => !/Bolls|request file|pasted/.test(c)), 'Verse text was pasted in; check it against the Bible.'];
  const [start] = groupRange(slide.group);
  const offset = state.active - start;
  const r = rebuildPassage(slide.group);
  state.active = r.start + Math.min(offset, r.count - 1);
  $('paste-verses').value = '';
  renderAll();
  showToast(missing.length ? `Still missing verse ${missing.join(', ')}.` : `${passageLabel(passage)} now has its text.`, missing.length ? 'warn' : '');
}

// ---------- File names ----------
function fileBase() {
  const last = extractCommunicatorLastName($('communicator').value);
  return `${dateCode($('service-date').value)} - ${state.theme.fileWord}${last ? ` - ${last}` : ''}`;
}

function slugify(s, words = 5) {
  return (s || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9:\-\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, words)
    .join('_')
    .replace(/:/g, '_');
}

/** "mark_9_10", "quote_charles_spurgeon", "theology_of_suffering" */
function slideSlug(slide) {
  if (slide.kind === 'scripture') return `${slugify(oneLine(slide.reference), 4)}${slide.ref?.part ? `_part${slide.ref.part}` : ''}`;
  if (slide.kind === 'quote') return `quote_${slugify(slide.reference, 3) || 'unknown'}`;
  return slugify(readingText(slide.text)) || slide.kind;
}

function confirmUnresolved() {
  const problems = state.slides
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.needsText || s.overflow);
  if (!problems.length) return true;
  const list = problems.slice(0, 8).map(({ s, i }) => `Slide ${i + 1}: ${oneLine(s.reference) || KIND_LABELS[s.kind]} (${s.needsText ? 'needs verse text' : 'too tall'})`).join('\n');
  return confirm(`${problems.length} slide${problems.length === 1 ? '' : 's'} still need attention:\n\n${list}\n\nExport anyway?`);
}

function setProgress(pct) {
  $('export-progress').hidden = pct == null;
  $('export-progress-bar').style.width = `${pct || 0}%`;
}

async function withBusy(button, label, work) {
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `${SPINNER} ${label}`;
  try {
    await work();
  } catch (err) {
    console.error(err);
    showToast(`Export failed: ${err.message || err}`, 'warn', 6000);
  } finally {
    button.innerHTML = original;
    button.disabled = false;
    setProgress(null);
  }
}

// ---------- Exports ----------
async function exportProPresenter() {
  if (!confirmUnresolved()) return;
  await withBusy($('btn-export-pro'), 'Building bundle…', async () => {
    const name = fileBase();
    const blob = await exportBundle({
      name,
      slides: state.slides,
      layouts: state.layouts,
      size: state.size,
      assets: state.theme.assets,
      dimOpacity: state.dimOpacity,
      locations: state.locations.list,
    });
    downloadBlob(blob, `${name}.probundle`);
    showToast(`Saved ${name}.probundle (${state.slides.length} slides, plus the intro and closing blanks).`);
  });
}

async function exportZip() {
  if (!confirmUnresolved()) return;
  await withBusy($('btn-export-zip'), 'Rendering…', async () => {
    const zip = new JSZip();
    const visible = state.slides.map((s, i) => ({ s, i })).filter(({ s }) => s.kind !== 'blank');
    for (let k = 0; k < visible.length; k++) {
      const { s, i } = visible[k];
      setProgress(((k + 1) / visible.length) * 95);
      zip.file(`${String(i + 1).padStart(3, '0')}_${slideSlug(s)}.png`, await renderSlidePng(s, state.layouts, state.theme.assets, state.size, { dimOpacity: state.dimOpacity }));
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, `${fileBase()}.zip`);
    showToast(`Saved ${visible.length} PNGs.`);
  });
}

async function exportCurrentPng() {
  const slide = activeSlide();
  if (!slide) return;
  await withBusy($('btn-export-png'), 'Rendering…', async () => {
    downloadBlob(await renderSlidePng(slide, state.layouts, state.theme.assets, state.size, { dimOpacity: state.dimOpacity }), `${fileBase()} - ${slideSlug(slide)}.png`);
  });
}

// ---------- Review link ----------
async function shareReviewLink() {
  if (!state.slides.length) return;
  try {
    const payload = {
      v: 1,
      theme: state.theme.id,
      header: state.header,
      communicator: $('communicator').value.trim(),
      date: $('service-date').value,
      locations: state.locations,
      slides: state.slides,
      passages: state.passages,
    };
    const hash = await compressDeckPayload(payload);
    const url = `${window.location.origin}${window.location.pathname}#review=${hash}`;
    history.replaceState(null, '', `#review=${hash}`);
    if (await copyToClipboard(url)) showToast('Review link copied. Anyone with the link can see and edit this draft.');
    else showToast('Couldn’t copy automatically; the review link is now in the address bar.', 'warn', 6000);
  } catch (err) {
    console.error(err);
    showToast('Couldn’t make a review link.', 'warn');
  }
}

async function loadFromHash() {
  const hash = window.location.hash;
  if (hash.startsWith('#outline=')) {
    try {
      const text = await decompressOutlinePayload(hash.slice('#outline='.length));
      await loadRequestText(text, 'the link');
    } catch (err) {
      console.error(err);
      showToast('Couldn’t read the requests in that link.', 'warn');
    }
  } else if (hash.startsWith('#review=')) {
    try {
      const payload = await decompressDeckPayload(hash.slice('#review='.length));
      const theme = THEMES.find(t => t.id === payload.theme);
      if (theme && theme !== state.theme) await loadTheme(theme);
      state.header = payload.header || {};
      state.loadWarnings = [];
      state.slides = payload.slides || [];
      state.passages = payload.passages || {};
      state.active = 0;
      $('communicator').value = payload.communicator || '';
      $('service-date').value = payload.date || todayIso();
      const loc = payload.locations || {};
      setLocations(loc.list || [], loc.source || null, loc.task || null);
      $('review-banner').hidden = false;
      state.view = 'grid';
      renderAll();
      showToast(`Loaded a shared draft: ${state.slides.length} slides.`);
    } catch (err) {
      console.error(err);
      showToast('Couldn’t read that review link.', 'warn');
    }
  }
}

// ---------- Proof sheet ----------
function proofTextHtml(text) {
  return parseRuns(text || '')
    .map(r => {
      const t = escapeHtml(r.text);
      const inner = r.sup ? `<sup>${t}</sup>` : t;
      return r.dim ? `<span class="dim">${inner}</span>` : inner;
    })
    .join('');
}

function openProofSheet() {
  const h = state.header;
  $('proof-meta').textContent = [h.title, $('communicator').value.trim(), $('service-date').value, state.theme.name, `${state.slides.length} slides`, locationsNotes(state.locations.list)].filter(Boolean).join(' · ');
  $('proof-content').innerHTML = state.slides
    .map((s, i) => {
      const issues = slideIssues(s);
      return `<div class="proof-item">
        <div class="proof-head">
          <span class="slide-num">${i + 1}</span>
          <span class="kind-tag ${s.kind}">${KIND_LABELS[s.kind]}</span>
          ${s.reference ? `<span class="proof-ref">${escapeHtml(oneLine(s.reference))}</span>` : ''}
          ${issues.length ? `<span class="badge${issues.some(x => x.danger) ? ' danger' : ''}">${ICON_WARN}${escapeHtml(issues.map(x => x.text).join(' '))}</span>` : ''}
        </div>
        <div class="proof-text">${s.kind === 'blank' ? '<em>(blank)</em>' : s.needsText ? '<em>(verse text needed)</em>' : proofTextHtml(s.text)}</div>
        ${s.cues.length ? `<div class="proof-notes">Notes: ${escapeHtml(s.cues.join(' · '))}</div>` : ''}
      </div>`;
    })
    .join('');
  $('proof-modal').hidden = false;
}

// ---------- Preview background ----------
const BG_MODES = ['video', 'light', 'black', 'checker'];
const BG_LABELS = { video: 'Background: video', light: 'Background: light', black: 'Background: black', checker: 'Background: transparent' };

function setBg(mode) {
  state.bg = mode;
  storageSet('bg', mode);
  $('canvas-frame').className = `canvas-frame bg-${mode}`;
  $('btn-bg').textContent = BG_LABELS[mode];
  document.querySelectorAll('.thumb').forEach(t => (t.className = `thumb bg-${mode}`));
}

// ---------- Wiring ----------
function bindEvents() {
  $('btn-load-requests').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', e => {
    handleFile(e.target.files[0]);
    e.target.value = '';
  });
  $('btn-load-sample').addEventListener('click', () => {
    if (state.slides.some(s => s.edited) && !confirm('Replace the current slides with the sample?')) return;
    loadRequestText(sampleRequests, 'the sample');
  });

  // Drag and drop a request file anywhere
  let dragDepth = 0;
  const isFileDrag = e => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', e => {
    if (!isFileDrag(e)) return;
    dragDepth += 1;
    $('drop-overlay').hidden = false;
  });
  window.addEventListener('dragleave', e => {
    if (!isFileDrag(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) $('drop-overlay').hidden = true;
  });
  window.addEventListener('dragover', e => {
    if (isFileDrag(e)) e.preventDefault();
  });
  window.addEventListener('drop', e => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth = 0;
    $('drop-overlay').hidden = true;
    handleFile(e.dataTransfer.files[0]);
  });

  $('view-grid').addEventListener('click', () => setView('grid'));
  $('view-editor').addEventListener('click', () => state.slides.length && openEditor(state.active));
  $('btn-prev').addEventListener('click', () => openEditor(state.active - 1));
  $('btn-next').addEventListener('click', () => openEditor(state.active + 1));
  document.addEventListener('keydown', e => {
    if (!state.slides.length || !$('help-modal').hidden || !$('proof-modal').hidden) return;
    const active = document.activeElement;
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) || active.isContentEditable;

    // Cmd/Ctrl+Z (outside a text box) brings back the last deleted slide
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && !typing && lastDelete) {
      e.preventDefault();
      undoDelete();
      return;
    }

    if (state.view === 'grid') {
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSlide();
        return;
      }
      // Arrow keys move the selection around the grid; Enter opens it
      const cols = gridColumns();
      const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols };
      if (e.key in moves) {
        e.preventDefault();
        const next = state.active + moves[e.key];
        if (next >= 0 && next < state.slides.length) selectSlide(next);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        openEditor(state.active);
      }
      return;
    }

    // Editor: Cmd/Ctrl+D dims or undims the selected words while typing on the slide
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd' && active?.isContentEditable) {
      e.preventDefault();
      toggleDim();
      return;
    }
    // Esc goes back to the grid from anywhere in the editor, even mid-typing
    if (e.key === 'Escape') {
      active.blur?.();
      setView('grid');
      return;
    }
    if (typing) return;
    if (e.key === 'ArrowLeft') openEditor(state.active - 1);
    if (e.key === 'ArrowRight') openEditor(state.active + 1);
  });

  // Remember where the cursor was in the slide text, for Split and Dim
  document.addEventListener('selectionchange', () => {
    if (!activeEditable) return;
    const offsets = selectionOffsets(activeEditable);
    if (offsets) lastCaret = offsets;
  });
  // Keep the text selection when clicking these buttons
  for (const id of ['btn-dim', 'btn-split']) $(id).addEventListener('mousedown', e => e.preventDefault());
  new ResizeObserver(fitSlideLayer).observe($('canvas-frame'));

  $('edit-kind').addEventListener('change', e => {
    const slide = activeSlide();
    slide.kind = e.target.value;
    slide.layout = layoutForKind(slide.kind);
    slide.align = slide.kind === 'scripture' ? slide.align : null;
    slide.edited = true;
    updateOverflow(slide);
    renderAll();
  });
  $('btn-dim').addEventListener('click', toggleDim);
  $('btn-relayout').addEventListener('click', autoLayout);
  $('edit-translation').addEventListener('change', e => changeTranslation(e.target.value));
  $('btn-ctx-up-less').addEventListener('click', () => changeContext('above', -1));
  $('btn-ctx-up-more').addEventListener('click', () => changeContext('above', 1));
  $('btn-ctx-down-less').addEventListener('click', () => changeContext('below', -1));
  $('btn-ctx-down-more').addEventListener('click', () => changeContext('below', 1));
  $('btn-apply-paste').addEventListener('click', applyPastedVerses);
  $('btn-split').addEventListener('click', splitAtCursor);
  $('btn-merge').addEventListener('click', mergeWithNext);
  $('btn-insert-blank').addEventListener('click', () => insertSlide(state.active + 1, blankSlide()));
  $('btn-add-slide').addEventListener('click', () => insertSlide(state.slides.length ? state.active + 1 : 0, blankSlide()));
  $('btn-delete').addEventListener('click', deleteSlide);
  const addCue = () => {
    const input = $('new-cue');
    const v = input.value.trim();
    if (!v) return;
    activeSlide().cues.push(v);
    input.value = '';
    renderAll();
  };
  $('btn-add-cue').addEventListener('click', addCue);
  $('new-cue').addEventListener('keydown', e => e.key === 'Enter' && addCue());

  $('btn-export-pro').addEventListener('click', exportProPresenter);
  $('btn-export-zip').addEventListener('click', exportZip);
  $('btn-export-png').addEventListener('click', exportCurrentPng);
  $('btn-share').addEventListener('click', shareReviewLink);
  $('btn-copy-review').addEventListener('click', shareReviewLink);
  $('btn-dismiss-review').addEventListener('click', () => ($('review-banner').hidden = true));
  $('btn-proof').addEventListener('click', openProofSheet);
  $('btn-print').addEventListener('click', () => window.print());
  $('btn-help').addEventListener('click', () => ($('help-modal').hidden = false));
  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', e => {
      if (e.target === m || e.target.closest('[data-close]')) m.hidden = true;
    });
  });

  $('btn-bg').addEventListener('click', () => setBg(BG_MODES[(BG_MODES.indexOf(state.bg) + 1) % BG_MODES.length]));

  $('dim-opacity').addEventListener('input', e => {
    state.dimOpacity = +e.target.value;
    $('dim-value').textContent = `${Math.round(state.dimOpacity * 100)}%`;
    storageSet('dimOpacity', state.dimOpacity);
    $('slide-layer').style.setProperty('--dim', state.dimOpacity);
  });
  $('dim-opacity').addEventListener('change', () => {
    if (state.view === 'grid') renderGrid();
    else drawEditorCanvas();
  });
  $('context-verses').addEventListener('change', e => {
    state.context = +e.target.value;
    storageSet('context', state.context);
    if (state.slides.length) {
      relayoutAll();
      renderAll();
    }
  });

  $('live-locations').addEventListener('change', e => setLocations(splitLocations(e.target.value), e.target.value.trim() ? 'typed' : null));
  $('btn-fetch-locations').addEventListener('click', () => loadLocationsFromAsana());
  $('service-date').addEventListener('change', () => {
    if (state.locations.source === 'asana' || !state.locations.list.length) loadLocationsFromAsana({ quiet: true });
  });
  $('asana-token').addEventListener('change', e => {
    storageSet('asanaToken', e.target.value.trim());
    if (e.target.value.trim()) loadLocationsFromAsana();
    else renderLocationsStatus();
  });

  $('theme-select').addEventListener('change', async e => {
    const theme = THEMES.find(t => t.id === e.target.value);
    await loadTheme(theme);
    relayoutAll();
    renderAll();
  });

  window.addEventListener('hashchange', loadFromHash);
}

async function init() {
  state.dimOpacity = storageGet('dimOpacity', 0.25);
  state.context = storageGet('context', 2);
  $('dim-opacity').value = state.dimOpacity;
  $('dim-value').textContent = `${Math.round(state.dimOpacity * 100)}%`;
  $('context-verses').value = String(state.context);
  $('service-date').value = todayIso();
  $('asana-token').value = storageGet('asanaToken', '');
  renderLocationsStatus();
  $('theme-select').innerHTML = THEMES.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  setBg(storageGet('bg', 'video'));
  await loadTheme(THEMES[0]);
  bindEvents();
  renderAll();
  await loadFromHash();
}

// For other tools and for debugging: build a #outline= link from request text
window.encodeOutlineLink = encodeOutlineLink;

init().catch(err => {
  console.error(err);
  showToast(`Porch Slides couldn’t start: ${err.message || err}`, 'warn', 10000);
});
