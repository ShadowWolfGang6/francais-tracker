import { modes, phases, prompts, workflow } from './content.js';
import { backupChanges, dayFormat, httpUrl, journalEntries, readBackup, shiftDay, streak, text } from './data.js';
import { openJournal } from './sync.js';

const $ = id => document.getElementById(id);
const all = selector => [...document.querySelectorAll(selector)];
const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
function dateNow() {
  const parts = Object.fromEntries(dayFormat.formatToParts(new Date()).map(({ type, value }) => [type, value]));
  return [parts.year, parts.month, parts.day].join('-');
}
const recordBase = minutes => ({ date: dateNow(), minutes, created: new Date().toISOString() });
const value = (id, max) => text($(id).value, max);
const assign = (id, output) => { $(id).textContent = output; };
const clear = (...ids) => ids.forEach(id => { $(id).value = ''; });
const empty = message => '<p class="empty">' + message + '</p>';
const activityName = { duo: 'Duolingo', speak: 'Speaking' };
const prettyDay = new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const dayLabel = day => prettyDay.format(new Date(day + 'T12:00:00Z'));

let state = new Map();
let currentMode;
let roadmapReady = false;
let promptLevel = 'A2';
let promptIndex = 0;
let wordEdit;
let reviewKey;
let reviewRevealed = false;
let toastTimer;
let historyLimit = 15;
const journal = openJournal(document.querySelector('[name="journal-owner"]').content, next => {
  state = next;
  render();
}, (message, status = '') => {
  assign('syncStatus', message);
  $('syncStatus').dataset.state = status;
});

const get = (key, fallback) => state.get(key)?.value ?? fallback;
const save = (...entries) => journal.change(entries);
const write = (key, value) => ({ key, value });
const add = (kind, value) => write(kind + ':' + crypto.randomUUID(), value);
const done = key => Boolean(state.get(key)?.done);
const checkKey = (mode, index) => 'check:' + dateNow() + '.' + mode + '.' + index;
const tvKey = index => 'tvstep:' + dateNow() + '.' + index;
const wordRecords = () => journalEntries(state).filter(item => item.key.startsWith('word:'));

function toast(message) {
  clearTimeout(toastTimer);
  assign('toast', message);
  $('toast').classList.add('show');
  toastTimer = setTimeout(() => { $('toast').classList.remove('show'); }, 3000);
}

function minutes(id, { min = 1, max = 300, fallback } = {}) {
  const field = $(id);
  const entered = field.value === '' && !field.validity.badInput ? fallback : Number(field.value);
  if (!Number.isInteger(entered) || entered < min || entered > max || !field.validity.valid) {
    toast('Enter whole minutes from ' + min + ' to ' + max + '.');
    field.focus();
    return null;
  }
  return entered;
}

function showTab(tab, { scroll = true } = {}) {
  if (!all('.section').some(section => section.id === tab)) tab = 'today';
  for (const button of all('[data-tab]')) {
    const active = button.dataset.tab === tab;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  all('.section').forEach(section => section.classList.toggle('active', section.id === tab));
  if (scroll) {
    const button = document.querySelector('[data-tab="' + tab + '"]');
    const nav = button.parentElement;
    if (button.offsetLeft < nav.scrollLeft || button.offsetLeft + button.offsetWidth > nav.scrollLeft + nav.clientWidth) {
      nav.scrollLeft = Math.max(0, button.offsetLeft - 8);
    }
    window.scrollTo(0, 0);
  }
}

function selectTab(tab) {
  history.replaceState(null, '', tab === 'today' ? location.pathname : '#' + tab);
  showTab(tab);
}

function renderTasks() {
  const mode = get('prefs:mode', 'light');
  const { title, time, tasks } = modes[mode];
  if (mode !== currentMode) {
    for (const button of all('[data-mode]')) {
      const selected = button.dataset.mode === mode;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    assign('modeTitle', title);
    assign('modeTime', time);
    $('tasks').innerHTML = tasks.map(([name, detail], index) =>
      '<label class="activity"><input type="checkbox" data-task="' + index + '"><span><strong>' +
      name + '</strong><small>' + detail + '</small></span></label>').join('');
    currentMode = mode;
  }
  for (const input of all('[data-task]')) input.checked = done(checkKey(mode, input.dataset.task));
}

function renderRoadmap() {
  if (!roadmapReady) {
    $('roadmapCards').innerHTML = phases.map(({ level, title, skills }, index) =>
      '<div class="phase" data-phase="' + index + '"><div class="eyebrow" data-focus-label="' + index +
      '"></div><div class="level">' + level + '</div><h3>' + title + '</h3>' +
      skills.map((skill, skillIndex) => '<label class="activity"><input type="checkbox" data-milestone="' +
        index + '.' + skillIndex + '"><span>' + skill + '</span></label>').join('') +
      '<button class="pill" data-focus="' + index + '">Set ' + level + ' focus</button></div>').join('');
    roadmapReady = true;
  }
  const focus = get('prefs:focus', 'A2');
  assign('heroFocus', focus + ' focus');
  for (const section of all('[data-phase]')) {
    const index = Number(section.dataset.phase);
    const active = phases[index].level === focus;
    section.classList.toggle('current', active);
    section.querySelector('[data-focus-label]').textContent = active ? 'Current focus' : index === 4 ? 'Target' : 'Milestone';
    section.querySelector('[data-focus]').setAttribute('aria-pressed', String(active));
    section.querySelector('[data-focus]').textContent = active ? 'Current focus' : 'Set ' + phases[index].level + ' focus';
  }
  for (const input of all('[data-milestone]')) input.checked = done('milestone:' + input.dataset.milestone);
}

function renderLessons(lessons) {
  const markup = lessons.map(item => {
    const link = httpUrl(item.url);
    const expressions = item.expressions.split('\n').map(line => line.trim()).filter(Boolean);
    return '<details class="activity log"><summary><strong>' + escape(item.title) + '</strong><small>' +
      escape(item.source) + ' · ' + escape(item.level) + ' · ' + item.minutes + ' min · ' + dayLabel(item.date) +
      (item.revisited ? ' · Revisited' : item.difficulty.startsWith('Difficult') ? ' · To revisit' : '') +
      '</small></summary><p>' + escape(item.difficulty) + '</p>' +
      (item.steps.length ? '<p><strong>Completed</strong> ' + escape(item.steps.map(index => workflow[index]).join(', ')) + '</p>' : '') +
      (item.notes ? '<p>' + escape(item.notes) + '</p>' : '') +
      expressions.map(expression => '<div class="inline-actions"><button class="pill" data-collect="' +
        escape(expression) + '" data-source="' + escape(item.source) + '">Save “' + escape(expression) +
        '” to phrasebook</button></div>').join('') +
      '<div class="inline-actions">' + (link ? '<a class="link" href="' + escape(link) +
        '" target="_blank" rel="noopener">Open lesson ↗</a>' : '') +
      '<button class="pill" data-revisit="' + escape(item.key) + '">' +
        (item.revisited ? 'Mark for revisit' : 'Mark revisited') + '</button></div></details>';
  }).join('');
  renderPreservingDetails('tvRecent', markup || empty('Your saved lessons will appear here.'), lessons);
}

function renderSpeaking(entries) {
  const markup = entries.map(item => '<details class="activity log"><summary><strong>' + escape(item.topic) +
    '</strong><small>' + escape(item.level) + ' · ' + item.minutes + ' min · ' + dayLabel(item.date) +
    '</small></summary>' + (item.improve ? '<p><strong>Next time</strong> ' + escape(item.improve) + '</p>' : '') +
    (item.notes ? '<p>' + escape(item.notes) + '</p>' : '') + '</details>').join('');
  renderPreservingDetails('speakRecent', markup || empty('Your speaking sessions will appear here.'), entries);
}

const renderedContent = new Map();
function renderPreservingDetails(id, markup, entries) {
  if (renderedContent.get(id) === markup) return;
  const parent = $(id);
  const openKeys = new Set([...parent.querySelectorAll('details[open]')].map(element => element.dataset.entry));
  parent.innerHTML = markup;
  [...parent.querySelectorAll('details')].forEach((element, index) => {
    element.dataset.entry = entries[index].key;
    element.open = openKeys.has(element.dataset.entry);
  });
  renderedContent.set(id, markup);
}

const normalize = value => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
function renderWords(words = wordRecords()) {
  assign('wordCount', words.length === 1 ? '1 expression' : words.length + ' expressions');
  const search = normalize(value('wordSearch'));
  const matches = words.filter(word => normalize([word.fr, word.en, word.example, word.source].join(' ')).includes(search));
  const markup = matches.map(word => '<article class="word"><div><strong lang="fr">' + escape(word.fr) +
    '</strong><div class="muted">' + escape(word.en) + '</div>' + (word.example ? '<p lang="fr">' +
    escape(word.example) + '</p>' : '') + '<div class="muted">' + escape(word.source) +
    (word.due ? ' · Review ' + dayLabel(word.due) : '') + '</div></div><div class="inline-actions">' +
    '<button class="pill" data-edit-word="' + escape(word.key) + '">Edit</button>' +
    '<button class="pill" data-delete="' + escape(word.key) + '">Delete</button></div></article>').join('');
  if (renderedContent.get('wordList') !== markup) {
    $('wordList').innerHTML = markup || empty(search ? 'No matching expressions.' : 'Your saved expressions will appear here.');
    renderedContent.set('wordList', markup);
  }
  const due = words.filter(word => !word.due || word.due <= dateNow()).sort((a, b) => (a.due || '').localeCompare(b.due || ''));
  const review = due.find(word => word.key === reviewKey) || due[0];
  if (review?.key !== reviewKey) reviewRevealed = false;
  reviewKey = review?.key;
  const reviewMarkup = review ? '<p class="muted">' + due.length + ' due for review</p><strong lang="fr">' +
    escape(review.fr) + '</strong>' + (reviewRevealed ? '<p>' + escape(review.en) + '</p>' +
    (review.example ? '<p lang="fr">' + escape(review.example) + '</p>' : '') +
    '<div class="btnrow"><button class="btn secondary" data-grade="again">Again tomorrow</button>' +
    '<button class="btn" data-grade="good">Got it</button></div>' :
    '<div class="btnrow"><button class="btn secondary" id="revealWord">Show meaning</button></div>') :
    '<p class="muted">' + (words.length ? 'You’re caught up on reviews.' : 'Save your first expression to start reviewing.') + '</p>';
  if ($('wordReview').dataset.last !== reviewMarkup) {
    $('wordReview').innerHTML = reviewMarkup;
    $('wordReview').dataset.last = reviewMarkup;
  }
}

function renderHistory(logs) {
  const selected = $('historyFilter').value;
  const types = [...new Set(logs.map(item => item.type))].sort();
  const filterOptions = '<option value="">All activities</option>' +
    types.map(type => '<option>' + escape(type) + '</option>').join('');
  if ($('historyFilter').dataset.last !== filterOptions) {
    $('historyFilter').innerHTML = filterOptions;
    $('historyFilter').dataset.last = filterOptions;
    if (types.includes(selected)) $('historyFilter').value = selected;
  }
  const filtered = $('historyFilter').value ? logs.filter(item => item.type === $('historyFilter').value) : logs;
  const list = filtered.slice(0, historyLimit).map(item => '<div class="activity log"><div><strong>' +
    escape(item.type) + ' · ' + item.minutes + ' min</strong><small>' + dayLabel(item.date) +
    (item.detail ? ' · ' + escape(item.detail) : '') + '</small><div class="inline-actions">' +
    '<button class="pill" data-delete="' + escape(item.key) + '">Remove entry</button></div></div></div>').join('');
  const markup = list + (filtered.length > historyLimit ? '<button class="btn secondary" id="moreHistory">Show more</button>' : '');
  if ($('activityHistory').dataset.last !== markup) {
    $('activityHistory').innerHTML = markup || empty('Your activity will appear here as you log it.');
    $('activityHistory').dataset.last = markup;
  }
}

const totalMinutes = entries => entries.reduce((total, item) => total + item.minutes, 0);
function render() {
  const items = journalEntries(state);
  const ofKind = kind => items.filter(item => item.key.startsWith(kind + ':'));
  const duo = ofKind('duo');
  const tv = ofKind('tv');
  const speak = ofKind('speak');
  const words = ofKind('word');
  const logs = items.filter(item => 'minutes' in item).map(item => {
    const kind = item.key.split(':')[0];
    if (kind === 'log') return item;
    return { ...item, type: activityName[kind] || item.source,
      detail: item.title || item.topic || 'Daily lesson' };
  });
  const day = dateNow();
  const todaysDuo = state.get('duo:' + day);
  assign('duoStatus', todaysDuo ? 'Logged today · ' + todaysDuo.minutes + ' min' : 'Not logged');
  assign('logDuo', todaysDuo ? 'Update today’s minutes' : 'Log today’s Duolingo');
  $('undoDuo').hidden = !todaysDuo;
  $('duoBar').style.width = todaysDuo ? '100%' : '0%';
  assign('duoStreak', streak(new Set(duo.map(item => item.date)), day));
  assign('streak', streak(new Set(logs.map(item => item.date)), day));
  assign('totalMinutes', totalMinutes(logs));
  assign('histMinutes', totalMinutes(logs));
  assign('histDuo', duo.length);
  assign('histTV', tv.filter(item => item.source === 'TV5MONDE').length);
  assign('histSpeak', logs.filter(item => item.type === 'Speaking').length);
  assign('histWords', words.length);
  assign('histSessions', logs.filter(item => item.category).length);
  assign('histSpeakingMinutes', totalMinutes(logs.filter(item => item.type === 'Speaking')));
  assign('histTVMinutes', totalMinutes(logs.filter(item => item.type === 'TV5MONDE')));
  const byDay = new Map();
  for (const item of logs) byDay.set(item.date, (byDay.get(item.date) || 0) + item.minutes);
  const week = Array.from({ length: 7 }, (_, index) => {
    const date = shiftDay(day, index - 6);
    return { date, minutes: byDay.get(date) || 0 };
  });
  assign('weekMinutes', totalMinutes(week) + ' min');
  const scale = Math.max(1, ...week.map(item => item.minutes));
  $('weekBars').innerHTML = week.map(item => '<div><span class="bar-value">' +
    item.minutes + '</span><div class="bar-track" aria-hidden="true"><i style="height:' +
    (item.minutes / scale * 100) + '%"></i></div><small>' + dayLabel(item.date) + '</small></div>').join('');
  renderTasks();
  for (const input of all('[data-tv-step]')) input.checked = done(tvKey(input.dataset.tvStep));
  renderRoadmap();
  renderLessons(tv);
  renderSpeaking(speak);
  renderWords(words);
  renderHistory(logs);
}

all('[data-tab]').forEach(button => { button.onclick = () => selectTab(button.dataset.tab); });
addEventListener('hashchange', () => showTab(location.hash.slice(1)));
addEventListener('pageshow', event => {
  if (event.persisted) location.reload();
});
$('modes').onclick = event => {
  const option = event.target.closest('[data-mode]');
  if (option) save(write('prefs:mode', { value: option.dataset.mode }));
};
$('tasks').onchange = event => {
  const input = event.target.closest('[data-task]');
  if (input) save(write(checkKey(currentMode, input.dataset.task), input.checked ? { done: true } : null));
};
$('finishSession').onclick = () => {
  const tasks = modes[currentMode].tasks;
  const selected = tasks.flatMap(([name], index) => done(checkKey(currentMode, index)) ? [{ name, index }] : []);
  if (!selected.length) return toast('Check an activity first.');
  const duration = minutes('sessionMinutes', { min: 0, fallback: 0 });
  if (duration === null) return;
  const base = recordBase(duration);
  const activities = selected.map(item => item.name);
  const record = add('log', { ...base, type: currentMode[0].toUpperCase() + currentMode.slice(1) + ' session',
    category: currentMode, detail: activities.join(' · '), activities });
  const entries = [record, ...selected.map(item => write(checkKey(currentMode, item.index), null))];
  if (selected.some(item => item.index === 0) && !state.get('duo:' + base.date)) {
    entries.push(write('duo:' + base.date, { ...base, minutes: 0 }));
  }
  clear('sessionMinutes');
  save(...entries);
  toast('Session logged.');
};
$('clearChecks').onclick = () => {
  const entries = modes[currentMode].tasks.flatMap((_, index) => {
    const key = checkKey(currentMode, index);
    return done(key) ? [write(key, null)] : [];
  });
  if (entries.length) save(...entries);
};
$('logDuo').onclick = () => {
  const existing = state.get('duo:' + dateNow());
  const duration = minutes('duoMinutes', { max: 180, fallback: existing ? undefined : 5 });
  if (duration === null) return;
  const base = recordBase(duration);
  save(write('duo:' + base.date, base));
  clear('duoMinutes');
  toast('Duolingo logged.');
};
$('undoDuo').onclick = () => {
  if (!confirm('Remove today’s Duolingo entry?')) return;
  save(write('duo:' + dateNow(), null));
  toast('Duolingo entry removed.');
};
$('quickLog').onclick = () => {
  const duration = minutes('quickMinutes');
  if (duration === null) return;
  save(add('log', { ...recordBase(duration), type: value('quickType'), detail: 'Independent activity' }));
  clear('quickMinutes');
  toast('Activity added.');
};

$('tvSteps').onchange = event => {
  const input = event.target.closest('[data-tv-step]');
  if (input) save(write(tvKey(input.dataset.tvStep), input.checked ? { done: true } : null));
};
$('saveTV').onclick = () => {
  const title = value('tvTitle');
  if (!title) { $('tvTitle').focus(); return toast('Enter the lesson title or topic.'); }
  const duration = minutes('tvMinutes', { fallback: 10 });
  if (duration === null) return;
  const rawUrl = value('tvUrl', 2000);
  const url = httpUrl(rawUrl);
  if (rawUrl && !url) { $('tvUrl').focus(); return toast('Enter a full lesson link starting with https://.'); }
  const steps = workflow.flatMap((_, index) => done(tvKey(index)) ? [index] : []);
  save(add('tv', { ...recordBase(duration), title, level: value('tvLevel'), source: value('tvSource'),
    difficulty: value('tvDifficulty'), expressions: value('tvExpressions', 2000), notes: value('tvNotes', 2000),
    steps, url, revisited: false }), ...steps.map(index => write(tvKey(index), null)));
  clear('tvTitle', 'tvUrl', 'tvNotes', 'tvExpressions', 'tvMinutes');
  toast('Lesson saved.');
};
$('tvRecent').onclick = event => {
  const revisit = event.target.closest('[data-revisit]');
  if (revisit) {
    const key = revisit.dataset.revisit;
    const item = state.get(key);
    if (item) save(write(key, { ...item, revisited: !item.revisited }));
    return;
  }
  const collect = event.target.closest('[data-collect]');
  if (!collect) return;
  if ($('wordFR').value && !confirm('Replace the expression currently in the form?')) return;
  resetWordForm();
  $('wordFR').value = collect.dataset.collect;
  $('wordSource').value = collect.dataset.source === 'Curated video' ? 'Video / podcast' : 'TV5MONDE';
  selectTab('vocab');
  $('wordEN').focus();
};

function showPrompt() {
  const prompt = prompts[promptLevel][promptIndex % prompts[promptLevel].length];
  assign('promptBox', prompt);
  $('tutorText').value = 'Act as my French conversation partner at ' + promptLevel +
    ' level. Start with this topic: « ' + prompt + ' »\n\nSpeak mainly in French and ask one question at a time. Let me finish before correcting me. ' +
    'Adjust your vocabulary and follow-ups to my level. At the end, give me three important corrections with examples, five useful expressions, and one short follow-up challenge.';
  for (const button of all('[data-level]')) {
    const active = button.dataset.level === promptLevel;
    button.classList.toggle('selected', active);
    button.setAttribute('aria-pressed', String(active));
  }
}
$('promptLevels').onclick = event => {
  const button = event.target.closest('[data-level]');
  if (!button) return;
  promptIndex = 0;
  promptLevel = button.dataset.level;
  showPrompt();
};
$('nextPrompt').onclick = () => { promptIndex++; showPrompt(); };
async function copy(output) {
  try {
    await navigator.clipboard.writeText(output);
    toast('Copied to clipboard.');
  } catch {
    if (output === $('tutorText').value) {
      $('tutorText').focus();
      $('tutorText').select();
    } else {
      const range = document.createRange();
      range.selectNodeContents($('promptBox'));
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    toast('Copy the selected text.');
  }
}
$('copyPrompt').onclick = () => copy($('promptBox').textContent);
$('copyTutor').onclick = () => copy($('tutorText').value);
$('saveSpeaking').onclick = () => {
  const duration = minutes('speakMinutes');
  if (duration === null) return;
  save(add('speak', { ...recordBase(duration), topic: value('speakTopic') || $('promptBox').textContent,
    improve: value('speakImprove'), notes: value('speakNotes', 2000), level: promptLevel }));
  clear('speakTopic', 'speakMinutes', 'speakImprove', 'speakNotes');
  toast('Speaking session saved.');
};

function resetWordForm() {
  clear('wordFR', 'wordEN', 'wordExample');
  $('wordSource').selectedIndex = 0;
  wordEdit = undefined;
  assign('wordFormTitle', 'Add an expression');
  assign('saveWord', 'Save expression');
  $('cancelWord').hidden = true;
}
$('cancelWord').onclick = resetWordForm;
$('saveWord').onclick = () => {
  const fr = value('wordFR');
  const en = value('wordEN');
  if (!fr || !en) {
    $(fr ? 'wordEN' : 'wordFR').focus();
    return toast('Add the expression and its meaning.');
  }
  const existing = wordEdit && state.get(wordEdit);
  const record = { ...(existing || { date: dateNow(), created: new Date().toISOString(), due: dateNow(), interval: 0 }),
    fr, en, example: value('wordExample', 2000), source: value('wordSource') };
  save(existing ? write(wordEdit, record) : add('word', record));
  resetWordForm();
  toast(existing ? 'Expression updated.' : 'Expression saved.');
};
$('wordSearch').oninput = () => renderWords();
$('wordList').onclick = event => {
  const edit = event.target.closest('[data-edit-word]');
  if (!edit) return;
  const key = edit.dataset.editWord;
  const item = state.get(key);
  if (!item) return;
  wordEdit = key;
  $('wordFR').value = item.fr;
  $('wordEN').value = item.en;
  $('wordExample').value = item.example;
  $('wordSource').value = [...$('wordSource').options].some(option => option.value === item.source) ? item.source : 'Other';
  assign('wordFormTitle', 'Edit expression');
  assign('saveWord', 'Save changes');
  $('cancelWord').hidden = false;
  $('wordFR').focus();
};
$('wordReview').onclick = event => {
  if (event.target.closest('#revealWord')) {
    reviewRevealed = true;
    renderWords();
    $('wordReview').querySelector('[data-grade]').focus();
    return;
  }
  const button = event.target.closest('[data-grade]');
  const word = state.get(reviewKey);
  if (!button || !word) return;
  const interval = button.dataset.grade === 'good' ? Math.min(32, Math.max(2, (word.interval || 0) * 2)) : 1;
  const key = reviewKey;
  reviewKey = undefined;
  reviewRevealed = false;
  save(write(key, { ...word, interval, due: shiftDay(dateNow(), interval) }));
  toast('Review scheduled in ' + interval + (interval === 1 ? ' day.' : ' days.'));
};

$('roadmapCards').onchange = event => {
  const input = event.target.closest('[data-milestone]');
  if (input) save(write('milestone:' + input.dataset.milestone, input.checked ? { done: true } : null));
};
$('roadmapCards').onclick = event => {
  const button = event.target.closest('[data-focus]');
  if (button) save(write('prefs:focus', { value: phases[Number(button.dataset.focus)].level }));
};
$('historyFilter').onchange = () => { historyLimit = 15; render(); };
$('activityHistory').onclick = event => {
  if (event.target.closest('#moreHistory')) { historyLimit += 15; render(); }
};
document.addEventListener('click', event => {
  const button = event.target.closest('[data-delete]');
  if (!button) return;
  const key = button.dataset.delete;
  if (!state.get(key) || !confirm(key.startsWith('word:') ? 'Delete this expression?' : 'Remove this journal entry?')) return;
  if (wordEdit === key) resetWordForm();
  save(write(key, null));
  toast('Entry removed.');
});
$('exportData').onclick = () => {
  const entries = [...state].filter(([, item]) => item !== null).map(([key, item]) => ({ key, value: item }));
  const file = new Blob([JSON.stringify({ format: 'francais-journal-v2', entries }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'francais-journal-' + dateNow() + '.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
};
async function importProgress(backup) {
  const entries = await readBackup(backup, dateNow());
  await journal.sync();
  const additions = backupChanges(state, entries);
  if (!additions.length) return toast('There are no new entries in this backup.');
  save(...additions);
  toast('Progress imported.');
}

$('importData').onclick = () => $('importFile').click();
$('importFile').onchange = async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 15000000) throw Error('This backup is too large.');
    await importProgress(JSON.parse(await file.text()));
  } catch (error) {
    toast(error instanceof SyntaxError ? 'Choose a valid JSON backup.' : error.message);
  }
};

const legacyButton = $('importLegacy');
if (legacyButton) {
  try {
    const legacy = JSON.parse(localStorage.getItem('francaisImmersion_v1'));
    if (legacy && (legacy.logs?.length || legacy.words?.length || Object.values(legacy.duo || {}).some(Boolean))) {
      legacyButton.hidden = false;
      legacyButton.onclick = async () => {
        legacyButton.disabled = true;
        try {
          await importProgress(legacy);
          legacyButton.hidden = true;
        } catch (error) {
          toast(error.message);
          legacyButton.disabled = false;
        }
      };
    }
  } catch {
    // The file import remains available for an unreadable browser backup.
  }
}
$('syncNow').onclick = async () => {
  if (await journal.sync()) toast('Journal is up to date.');
};
$('resetAll').onclick = async () => {
  if (!(await journal.sync())) return toast('Sync the journal before resetting it.');
  if (!confirm('Delete the current journal from all synced devices? Export a backup first if you want to keep it.')) return;
  const entries = [...state].filter(([, item]) => item !== null).map(([key]) => write(key, null));
  if (entries.length) save(...entries);
  resetWordForm();
  toast('Journal reset.');
};

state = journal.state();
showPrompt();
showTab(location.hash.slice(1), { scroll: false });
render();
journal.sync();
