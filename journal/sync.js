const batchSize = 24;
let pagesTransport;

export function connectPagesJournal(transport) {
  pagesTransport = transport;
}

export function openJournal(owner, onChange, onStatus) {
  const account = encodeURIComponent(owner);
  const endpoint = pagesTransport?.endpoint || './api/progress';
  const credentials = pagesTransport ? 'omit' : 'same-origin';
  function journalHeaders(input) {
    const headers = new Headers(input);
    headers.set('X-Journal-Account', account);
    if (pagesTransport) headers.set('Authorization', 'Bearer ' + pagesTransport.token);
    return headers;
  }
  const prefix = 'francais-journal-v2:' + account + ':';
  const cacheKey = prefix + 'cache';
  const pendingPrefix = prefix + 'op:';
  const inMemory = new Map();
  let snapshot = { cursor: 0, entries: new Map() };
  let running;
  let timer;

  function loadCache() {
    try {
      const value = JSON.parse(localStorage.getItem(cacheKey));
      if (value && value.cursor > snapshot.cursor) snapshot = { cursor: value.cursor, entries: new Map(value.entries) };
    } catch {
      // The server can rebuild a cleared or invalid cache.
    }
  }

  function pending() {
    const operations = new Map(inMemory);
    try {
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith(pendingPrefix)) continue;
        const operation = JSON.parse(localStorage.getItem(key));
        if (operation) operations.set(operation.id, operation);
      }
    } catch {
      // Unsaved changes in this tab remain available in memory.
    }
    return [...operations.values()].sort((a, b) => a.order.localeCompare(b.order));
  }

  function state() {
    const result = new Map(snapshot.entries);
    for (const { key, value } of pending()) result.set(key, value);
    return result;
  }

  function queue(delay = 150) {
    clearTimeout(timer);
    timer = setTimeout(sync, delay);
  }

  function change(entries) {
    const order = new Date().toISOString() + '-' + crypto.randomUUID();
    let stored = true;
    entries.forEach(({ key, value, id }, index) => {
      const operation = { id: id || crypto.randomUUID(), key, value, order: order + '-' + String(index).padStart(5, '0') };
      try {
        localStorage.setItem(pendingPrefix + operation.id, JSON.stringify(operation));
      } catch {
        inMemory.set(operation.id, operation);
        stored = false;
      }
    });
    onChange(state());
    onStatus(stored ? 'Saving…' : 'Keep this tab open until synced', stored ? '' : 'warn');
    queue();
  }

  async function request(path, options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(endpoint + path, { cache: 'no-store', credentials,
        signal: controller.signal, ...options, headers: journalHeaders(options?.headers) });
      if (response.status === 401 && pagesTransport) pagesTransport.onExpired();
      if (response.status === 409) throw Object.assign(Error('Account changed · refresh this tab'), { status: 409 });
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
        throw Error(response.status === 401 || response.redirected ? 'Sign in again to sync' : 'Could not reach sync');
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async function pull() {
    let more;
    do {
      const { events, more: remainder } = await request('?after=' + snapshot.cursor);
      for (const event of events) {
        snapshot.entries.set(event.key, event.value);
        snapshot.cursor = event.seq;
      }
      more = remainder;
    } while (more);
  }

  async function exchange() {
    loadCache();
    const sent = pending();
    for (let offset = 0; offset < sent.length; offset += batchSize) {
      const operations = sent.slice(offset, offset + batchSize).map(({ id, key, value }) => ({ id, key, value }));
      await request('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operations }) });
    }
    await pull();
    loadCache();
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ cursor: snapshot.cursor, entries: [...snapshot.entries] }));
    } catch {
      // The database still holds all acknowledged progress.
    }
    for (const operation of sent) {
      inMemory.delete(operation.id);
      try {
        const key = pendingPrefix + operation.id;
        const current = JSON.parse(localStorage.getItem(key));
        if (current?.order === operation.order) localStorage.removeItem(key);
      } catch {
        // Retrying an acknowledged operation is safe.
      }
    }
    onChange(state());
    if (pending().length) {
      onStatus('Saving…');
      queue();
    } else {
      onStatus('Synced privately');
    }
    return true;
  }

  function sync() {
    if (!running) running = exchange().catch(error => {
      if (error.status === 409) onStatus(error.message, 'warn');
      else if (inMemory.size) onStatus('Keep this tab open until synced', 'warn');
      else if (pending().length) onStatus('Saved here · waiting to sync', 'warn');
      else onStatus(navigator.onLine ? error.message : 'Offline · device copy', 'warn');
      return false;
    }).finally(() => { running = undefined; });
    return running;
  }

  loadCache();
  addEventListener('storage', event => {
    if (!event.key?.startsWith(prefix)) return;
    loadCache();
    onChange(state());
    if (event.key.startsWith(pendingPrefix) && event.newValue && pending().length) queue(750);
  });
  addEventListener('focus', () => { onChange(state()); sync(); });
  addEventListener('online', sync);
  addEventListener('pagehide', () => {
    const operations = pending().slice(0, 3).map(({ id, key, value }) => ({ id, key, value }));
    if (operations.length) fetch(endpoint, { method: 'POST', credentials, keepalive: true,
      headers: journalHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ operations }) }).catch(() => {});
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { onChange(state()); sync(); } });
  setInterval(() => { if (!document.hidden) sync(); }, 8000);
  return { state, change, sync };
}
