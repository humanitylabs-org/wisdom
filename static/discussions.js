/* Wisdom Ask AI. Domain-only overlay; load the shared WizardApp client first.
 * configure({base, getContext, navigateTo}) -> WisdomDiscussion
 * open(anchor | {scope:'chapter'} | threadId | {id}) / list(entryId?) / refresh() -> Promise
 * has(entryId, bodySha256, start, end) / hasChapter(entryId, bodySha256) -> cached boolean; isOpen()/close().
 * navigateTo(thread) is optional; receives the persisted anchor, never chapter body.
 * Dispatches wisdom:discussions with {threads} after index changes.
 */
(() => {
  'use strict';
  const $ = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const button = (text, cls, fn) => {
    const b = $('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b;
  };
  const safeURL = value => {
    try { const u = new URL(value); return /^https?:$/.test(u.protocol) ? u.href : null; } catch (_) { return null; }
  };
  // Deliberately small Markdown renderer: all model text is text, never HTML.
  // Links are HTTP(S)-only; raw HTML/images remain inert, including mid-stream fragments.
  function inline(text, target) {
    const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^\s)]+\))/g;
    let at = 0, m;
    while ((m = re.exec(text))) {
      target.append(document.createTextNode(text.slice(at, m.index)));
      const t = m[0]; let el;
      if (t[0] === '`') el = $('code', '', t.slice(1, -1));
      else if (t.startsWith('**')) el = $('strong', '', t.slice(2, -2));
      else {
        const parts = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t), url = safeURL(parts[2]);
        el = url ? $('a', '', parts[1]) : $('span', '', parts[1]);
        if (url) { el.href = url; el.target = '_blank'; el.rel = 'noopener noreferrer'; }
        else if (/^#\/read\/[a-zA-Z0-9_-]+$/.test(parts[2])) {
          el = button(parts[1], 'wd-citation', e => {
            const details = e.currentTarget.closest('.wd-message')?.querySelector('.wd-sources');
            if (details) { details.open = true; details.querySelector('summary').focus({preventScroll:true}); details.scrollIntoView({block:'nearest'}); }
          });
          el.setAttribute('aria-label', 'Show cited chapter: ' + parts[1]);
        }
      }
      target.append(el); at = re.lastIndex;
    }
    target.append(document.createTextNode(text.slice(at)));
  }
  function markdown(text) {
    const fragment = document.createDocumentFragment(); let code = null, list = null;
    for (const line of String(text || '').split('\n')) {
      if (/^```/.test(line)) {
        list = null;
        if (code) code = null;
        else { const pre = $('pre'); code = $('code'); pre.append(code); fragment.append(pre); }
        continue;
      }
      if (code) { code.append(document.createTextNode(line + '\n')); continue; }
      const item = /^\s*(?:[-*]|\d+\.)\s+(.+)$/.exec(line);
      if (item) {
        if (!list) { list = $('ul'); fragment.append(list); }
        const li = $('li'); inline(item[1], li); list.append(li); continue;
      }
      list = null;
      if (!line.trim()) continue;
      const heading = /^(#{1,4})\s+(.+)$/.exec(line), quote = /^>\s?(.*)$/.exec(line);
      const el = $(heading ? 'h4' : quote ? 'blockquote' : 'p');
      inline(heading ? heading[2] : quote ? quote[1] : line, el); fragment.append(el);
    }
    return fragment;
  }

  let options = {base: './'}, base, root, panel, headerTitle, subtitle, quoteBox, quoteText;
  let body, messages, empty, emptyText, starters, footer, composer, send, sendIcon, sendLabel, web, status, notice, jump, chapterMode = null;
  // Static, app-owned glyphs only; model/user text never reaches innerHTML.
  const ICON = {
    send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2.5"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>',
    globe: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.2-3.6-8.5S9.6 5.9 12 3.5z"/></svg>'
  };
  const glyph = (cls, svg) => { const el = $('span', cls); el.innerHTML = svg; return el; };
  let index = [], configured = null, thread = null, view = 'thread', scope;
  let opened = false, revision = 0, timer, monitor, updateHold, focusReturn;
  let opening = null, openingKey = null, openingChapter, openingController = null, nativePending = false;
  let loading = false, busy = false, pollError = '', actionError = '', retryAction, turnVersion = 0;
  let persisted = {}, storageWarning = '', currentKey = null, lastAnchor = null;
  const active = new Set();
  const draft = () => currentKey ? (persisted[currentKey] ||= {}) : {};
  const storageKey = () => 'wisdom.discussions.v1:' + base.pathname;
  function loadLocal() {
    try { persisted = JSON.parse(localStorage.getItem(storageKey()) || '{}'); if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted)) persisted = {}; }
    catch (_) { persisted = {}; storageWarning = 'Draft storage unavailable. Keep this tab open until you send.'; }
  }
  function saveLocal() {
    try { localStorage.setItem(storageKey(), JSON.stringify(persisted)); storageWarning = ''; }
    catch (_) { storageWarning = 'Draft could not be saved on this device. Keep this tab open until you send.'; }
    syncHold();
  }
  function syncHold() {
    const unsaved = busy || (nativePending && loading) || active.size > 0 || Object.values(persisted).some(d => d && (d.text || d.pending));
    if (unsaved && !updateHold && window.WizardApp?.update) updateHold = WizardApp.update.hold('Wisdom discussion draft or reply');
    if (!unsaved && updateHold) { updateHold.release(); updateHold = null; }
    if (active.size && (!opened || view === 'list') && !monitor) monitor = setTimeout(async () => {
      monitor = null;
      try { await refresh(); } catch (_) { /* Preserve hold until completion is confirmed. */ }
      syncHold();
    }, 3000);
  }
  async function api(path = '', payload, signal) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
    if (navigator.onLine === false) { clearTimeout(timeout); throw new Error('Offline. Your question is kept; retry when connected.'); }
    try {
      const response = await fetch(new URL('api/discussions' + path, base), {
        method: payload === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: payload === undefined ? {'Accept': 'application/json'} : {'Accept': 'application/json', 'Content-Type': 'application/json'},
        body: payload === undefined ? undefined : JSON.stringify(payload), signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
      });
      let result; try { result = await response.json(); } catch (_) { throw new Error('The server returned an unreadable response.'); }
      if (!response.ok) { const error = new Error(typeof result.error === 'string' ? result.error : result.error?.message || 'Request failed (' + response.status + ').'); error.status = response.status; throw error; }
      return result;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('The connection timed out. Your question is kept.');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  const route = id => '/' + encodeURIComponent(id);
  function configure(config = {}) {
    if (opened) close();
    options = {...options, ...config};
    base = new URL(options.base || './', location.href);
    if (base.origin !== location.origin) throw new Error('Wisdom discussions require a same-origin API.');
    base.search = ''; base.hash = ''; if (!base.pathname.endsWith('/')) base.pathname += '/';
    loadLocal(); syncHold(); return window.WisdomDiscussion;
  }
  function build() {
    if (root) return;
    root = $('div', 'wd-overlay'); root.hidden = true;
    const scrim = button('', 'wd-scrim', close); scrim.tabIndex = -1; scrim.setAttribute('aria-label', 'Close discussion');
    panel = $('section', 'wd-panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Passage discussion'); panel.tabIndex = -1;
    const grip = button('', 'wd-grip', () => setExpanded(!panel.classList.contains('wd-expanded')));
    grip.setAttribute('aria-label', 'Expand or shrink discussion');
    const header = $('header', 'wd-header'), titleGroup = $('div', 'wd-heading');
    headerTitle = $('h2', '', 'Ask AI'); subtitle = $('p', 'wd-subtitle'); titleGroup.append(headerTitle, subtitle);
    const closeButton = button('', 'wd-close', close); closeButton.append(glyph('wd-glyph', ICON.close)); closeButton.setAttribute('aria-label', 'Close discussion');
    header.append(titleGroup, closeButton);
    body = $('div', 'wd-body');
    quoteBox = $('details', 'wd-quote'); quoteBox.open = true;
    const summary = $('summary', '', 'Selected passage'); quoteText = $('blockquote'); quoteBox.append(summary, quoteText);
    quoteBox.addEventListener('toggle', () => { if (currentKey && !loading) { draft().quoteOpen = quoteBox.open; saveLocal(); } });
    notice = $('div', 'wd-notice'); notice.setAttribute('role', 'status');
    empty = $('div', 'wd-empty'); emptyText = $('p'); starters = $('div', 'wd-starters');
    empty.append(emptyText, starters);
    messages = $('div', 'wd-messages'); messages.setAttribute('aria-label', 'Discussion messages');
    body.append(quoteBox, notice, empty, messages);
    body.addEventListener('scroll', () => {
      if (view !== 'thread' || !currentKey) return;
      draft().scroll = body.scrollTop; draft().atBottom = nearBottom(); saveLocal(); jump.hidden = !thread?.messages?.length || nearBottom();
    }, {passive:true});
    jump = button('Latest reply ↓', 'wd-jump', () => { body.scrollTop = body.scrollHeight; jump.hidden = true; }); jump.hidden = true;
    footer = $('footer', 'wd-footer');
    // One compact chat composer: web toggle, auto-growing field, round send/stop.
    const webLabel = $('label', 'wd-web'); webLabel.title = 'Search the web';
    web = $('input'); web.type = 'checkbox'; web.setAttribute('aria-label', 'Search the web');
    web.addEventListener('change', () => { draft().web = web.checked; saveLocal(); });
    webLabel.append(web, glyph('wd-glyph', ICON.globe));
    const form = $('form', 'wd-composer'); composer = $('textarea'); composer.rows = 1; composer.maxLength = 8000;
    composer.placeholder = 'Ask about this passage…'; composer.setAttribute('aria-label', 'Your question');
    composer.addEventListener('input', changed); composer.addEventListener('focus', () => setExpanded(true));
    composer.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!send.disabled) form.requestSubmit(); }
    });
    send = $('button', 'wd-send'); send.type = 'submit';
    sendIcon = glyph('wd-glyph', ICON.send); sendLabel = $('span', 'wd-sr', 'Send'); send.append(sendIcon, sendLabel);
    form.append(webLabel, composer, send); form.addEventListener('submit', e => { e.preventDefault(); thread?.active ? stop() : ask(); });
    status = $('div', 'wd-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    footer.append(form, status);
    panel.append(grip, header, body, jump, footer); root.append(scrim, panel); document.body.append(root);
    panel.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); back(); }
      if (e.key !== 'Tab' || !matchMedia('(max-width: 899px)').matches) return;
      const all = [...panel.querySelectorAll('button, textarea, input, summary, a[href]')].filter(el => !el.disabled && el.getClientRects().length);
      if (!all.length) return;
      const first = all[0], last = all[all.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    window.addEventListener('online', () => {
      renderState(); schedulePoll(0);
      // Recheck readiness, never automatically resubmit an uncertain question.
      refresh().then(() => renderState()).catch(() => {});
    });
    window.addEventListener('offline', renderState);
    let outsidePress = null;
    document.addEventListener('pointerdown', e => { outsidePress = opened && !panel.contains(e.target) ? revision : null; }, true);
    document.addEventListener('click', e => { if (outsidePress === revision && opened && !panel.contains(e.target)) close(); outsidePress = null; }, true);
    window.addEventListener('wisdom:route', e => {
      if (opened && view === 'thread' && openingChapter !== e.detail?.entry_id) close();
    });
    // Keep the generic host fallback; Wisdom itself signals domain navigation
    // synchronously, including pushState paths that never fire hashchange.
    window.addEventListener('hashchange', () => {
      if (opened && view === 'thread' && openingChapter !== options.getContext?.().entry_id) close();
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) schedulePoll(0); });
    window.visualViewport?.addEventListener('resize', viewport);
    window.visualViewport?.addEventListener('scroll', viewport);
  }
  function viewport() {
    if (!root) return;
    const vv = window.visualViewport;
    root.style.setProperty('--wd-viewport', (vv?.height || innerHeight) + 'px');
    root.style.setProperty('--wd-top', (vv?.offsetTop || 0) + 'px');
  }
  function setExpanded(value) { panel?.classList.toggle('wd-expanded', value); }
  function show() {
    if (!base) configure(); build();
    if (!opened) {
      focusReturn = document.activeElement; opened = true; root.hidden = false;
      if (!window.WizardApp?.back) storageWarning = 'Shared WizardApp client is missing. System Back and update protection are unavailable.';
      panel.focus({preventScroll:true});
    }
    viewport(); dispatchEvent(new Event('wisdom:discussion-open'));
  }
  function back() {
    if (!opened) return false;
    if (document.activeElement === composer) { composer.blur(); return true; }
    const detail = [...body.querySelectorAll('.wd-sources[open]')].pop();
    if (detail) { detail.open = false; return true; }
    close(); return true;
  }
  function close() {
    if (!opened) return;
    if (currentKey && view === 'thread') { draft().scroll = body.scrollTop; saveLocal(); }
    openingController?.abort(); openingController = null;
    composer?.blur(); opened = false; revision++; opening = null; openingKey = null; nativePending = false; busy = false; clearTimeout(timer); root.hidden = true;
    dispatchEvent(new Event('wisdom:discussion-close'));
    if (focusReturn?.isConnected) focusReturn.focus({preventScroll:true});
    syncHold();
  }
  // Passage threads discuss a selection; chapter threads (end-of-chapter button) discuss the whole chapter.
  // One-word commands (James, 22 Oct): the chip's word is exactly what goes into the composer; the server prompt says what each means.
  const STARTERS = {
    passage: ['Explain, explore, or question this passage.', 'Ask about this passage…', [['Explain', 'Explain this passage in plain language.'], ['Give example', 'Give me a concrete example of the idea in this passage.'], ['Challenge', 'What is the strongest challenge to the idea in this passage?']]],
    chapter: ['Talk through the whole chapter.', 'Ask about this chapter…', [['Big idea', 'What is the one big idea of this chapter, in plain language?'], ['Apply it', 'How could I apply the idea of this chapter in my own life this week?'], ['Challenge', 'What is the strongest challenge to the argument of this chapter?']]]
  };
  function mode(chapter) {
    if (chapterMode === chapter) return;
    chapterMode = chapter;
    const [text, placeholder, chips] = STARTERS[chapter ? 'chapter' : 'passage'];
    emptyText.textContent = text; composer.placeholder = placeholder;
    panel.setAttribute('aria-label', chapter ? 'Chapter discussion' : 'Passage discussion');
    starters.replaceChildren(...chips.map(([label, question]) => button(label, 'wd-chip', () => { if (!composer.value.trim()) { composer.value = question; changed(); } composer.focus({preventScroll:true}); setExpanded(true); })));
  }
  const isChapter = t => t?.scope === 'chapter';
  function nearBottom() { return body.scrollHeight - body.clientHeight - body.scrollTop < 88; }
  function changed() {
    if (!currentKey) return;
    draft().text = composer.value; draft().anchor = lastAnchor; saveLocal(); grow(); renderState();
  }
  function grow() { composer.style.height = 'auto'; composer.style.height = Math.min(composer.scrollHeight, 136) + 'px'; }
  function cacheThread(t) {
    if (t.active) active.add(t.id); else active.delete(t.id);
    const row = {...t, message_count: t.messages?.length || 0, preview: t.messages?.at(-1)?.content || ''};
    delete row.messages;
    const at = index.findIndex(x => x.id === t.id); if (at < 0) index.unshift(row); else index[at] = {...index[at], ...row};
    dispatchEvent(new CustomEvent('wisdom:discussions', {detail:{threads:index.slice()}})); syncHold();
  }
  async function refresh() {
    if (!base) configure();
    const data = await api(); index = Array.isArray(data.threads) ? data.threads : []; configured = data.configured;
    active.clear(); for (const t of index) if (t.active) active.add(t.id); syncHold();
    dispatchEvent(new CustomEvent('wisdom:discussions', {detail:{threads:index.slice()}}));
    return index;
  }
  function has(entryId, hash, start, end) { return index.some(t => !isChapter(t) && String(t.entry_id) === String(entryId) && t.body_sha256 === hash && t.start === start && t.end === end); }
  function hasChapter(entryId, hash) { return index.some(t => isChapter(t) && String(t.entry_id) === String(entryId) && t.body_sha256 === hash && (t.message_count > 0 || !!t.session_id)); }
  function payloadFor(anchor) {
    const chapter = anchor?.scope === 'chapter', ctx = options.getContext?.() || {}, a = {...ctx, ...anchor};
    const payload = chapter ? {entry_id:a.entry_id, body_sha256:a.body_sha256, scope:'chapter'} : {entry_id:a.entry_id, body_sha256:a.body_sha256, start:a.start, end:a.end, text:a.text};
    if (!chapter && a.highlight_id !== undefined) payload.highlight_id = a.highlight_id;
    return payload;
  }
  /* Hosted in Wizard, Ask AI is the owner's real Chats thread laid over the reader (James, 22 Oct 2026: "we already
   * have a fully functional chat interface"): voice into the composer, attachments, models, Stop, queued replies and
   * history all come from Chats. Wisdom only finds (or creates once) the thread for this passage or chapter and hands
   * the passage over as a quoted item riding with the first message. Standalone, or on a shell without the bridge,
   * the in-app sheet below still works. */
  const byId = anchor => typeof anchor === 'string' || typeof anchor === 'number' || anchor?.id;
  function chatsAvailable() { try { return !!(window.WizardApp?.hosted && window.WizardApp.nav?.threadAgents === true && typeof window.WizardApp.nav?.openThread === 'function'); } catch (_) { return false; } }
  function open(anchor) { return openSheet(anchor, chatsAvailable()); }
  function openSheet(anchor, inChats = false) {
    if (!base) configure();
    // Capture context now, not after a save/paint/network wait or chapter change.
    const target = byId(anchor) ? {id:String(anchor?.id ?? anchor)} : payloadFor(anchor);
    const identity = byId(target) ? 'id:' + target.id : 'anchor:' + JSON.stringify([target.entry_id, target.body_sha256, target.scope || 'passage', target.start, target.end, target.text]);
    if (opened && view === 'thread' && opening && openingKey === identity) return opening;
    const cached = byId(target) ? index.find(t => String(t.id) === target.id) : index.find(t => String(t.entry_id) === String(target.entry_id) && t.body_sha256 === target.body_sha256 && isChapter(t) === (target.scope === 'chapter') && (isChapter(t) || (t.start === target.start && t.end === target.end)));
    openingController?.abort();
    show(); const own = ++revision; clearTimeout(timer); view = 'thread'; loading = true; thread = null; busy = false; nativePending = inChats;
    const controller = new AbortController(); openingController = controller;
    // One total opening budget covers both admission calls, not 12 seconds each.
    const deadline = setTimeout(() => controller.abort(), 12000);
    currentKey = byId(target) ? target.id : String(cached?.id || persisted[identity]?.thread_id || identity);
    // A create may have committed while its response was lost. After reload the
    // index knows the canonical ID, but the written draft still has its anchor key.
    const anchorDraftKey = !byId(target) ? identity : Object.keys(persisted).find(key => {
      const a = persisted[key]?.anchor;
      return key.startsWith('anchor:') && a && cached && a.entry_id === cached.entry_id && a.body_sha256 === cached.body_sha256 && (a.scope === 'chapter' ? isChapter(cached) : a.start === cached.start && a.end === cached.end);
    });
    if (anchorDraftKey && anchorDraftKey !== currentKey && persisted[anchorDraftKey] && !persisted[anchorDraftKey].thread_id) {
      persisted[currentKey] = {...persisted[currentKey], ...persisted[anchorDraftKey]};
      persisted[anchorDraftKey] = {thread_id:currentKey};
    }
    const provisional = currentKey;
    lastAnchor = target; openingKey = identity; openingChapter = options.getContext?.().entry_id; actionError = ''; pollError = ''; retryAction = null;
    const chapter = (cached || target).scope === 'chapter'; mode(chapter);
    headerTitle.textContent = chapter ? 'Discuss with AI' : 'Ask AI';
    subtitle.textContent = cached?.chapter_title || options.getContext?.().chapter_title || (chapter ? 'Opening chapter…' : 'Opening passage…');
    body.replaceChildren(quoteBox, notice, empty, messages); messages.replaceChildren();
    quoteText.textContent = cached?.quote || target.text || ''; jump.hidden = true;
    footer.hidden = false; quoteBox.hidden = chapter || !quoteText.textContent; quoteBox.open = draft().quoteOpen ?? true; empty.hidden = false;
    composer.value = draft().text || ''; web.checked = draft().web ?? false;
    setExpanded(Boolean(composer.value)); renderState(); grow();
    if (inChats) composer.focus({preventScroll:true});
    const task = (async () => {
      // Let the existing panel paint before persistence or network work begins.
      await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
      try {
        if (!opened || own !== revision) return;
        const t = byId(target) ? await api(route(target.id), undefined, controller.signal) : await api('', target, controller.signal);
        if (!opened || own !== revision) return;
        cacheThread(t);
        const key = String(t.id), local = persisted[provisional];
        if (provisional !== key) {
          persisted[key] = {...persisted[key], ...local};
          persisted[identity] = {thread_id:key};
        }
        thread = t; currentKey = key;
        if (inChats) {
          saveLocal();
          const r = await api(route(t.id) + '/thread', {}, controller.signal);
          if (!opened || own !== revision || controller.signal.aborted) return;
          // Read at admission time: typing during either request belongs to the
          // owner. It is a draft, never quoted reference data and never auto-sent.
          const text = composer.value;
          if (text && WizardApp.nav.threadDrafts !== true) throw new Error('Update Wizard to carry this draft into Chats. Your question stays here.');
          const accepted = WizardApp.nav.openThread(r.session_id, {reply:r.reply, ...(r.agent ? {agent:r.agent} : {}), ...(WizardApp.nav.threadDrafts === true ? {draft:{text}} : {})});
          if (accepted !== true) throw new Error('Chats could not take this question. A saved Chats draft may already be waiting. Your question stays here; try again after checking Chats.');
          // A true return with draft admission confirms the shared durable store
          // readback. Do not clear anything before that acknowledgement.
          if (draft().text === text) delete draft().text;
          saveLocal();
          const at = index.findIndex(x => x.id === t.id); if (at >= 0) index[at] = {...index[at], session_id:r.session_id};
          dispatchEvent(new CustomEvent('wisdom:discussions', {detail:{threads:index.slice()}}));
          close(); return true;
        }
        loading = false;
        if (typeof t.configured === 'boolean') configured = t.configured;
        // The field was usable during hydration: never replace input or its caret.
        const focused = document.activeElement === composer, start = composer.selectionStart, end = composer.selectionEnd;
        reconcile(t);
        const text = draft().text || '';
        if (composer.value !== text) composer.value = text;
        if (focused) composer.setSelectionRange(Math.min(start, text.length), Math.min(end, text.length));
        web.checked = draft().web ?? t.web_enabled ?? false;
        mode(isChapter(t)); headerTitle.textContent = isChapter(t) ? 'Discuss with AI' : 'Ask AI';
        quoteBox.hidden = isChapter(t); quoteBox.open = draft().quoteOpen ?? !(t.messages?.length);
        setExpanded(Boolean(focused || t.messages?.length || composer.value || t.active));
        saveLocal(); renderThread(true); grow();
        if (configured === null) refresh().then(() => { if (opened && own === revision) renderState(); }).catch(() => {});
        schedulePoll();
      } catch (e) {
        if (!opened || own !== revision) return;
        loading = false; actionError = e.message || 'Chats could not open. Your question is kept here.'; retryAction = () => openSheet(target, inChats); renderState();
      } finally {
        clearTimeout(deadline);
        if (openingController === controller) openingController = null;
        if (own === revision) opening = null;
      }
    })();
    opening = task; return task;
  }
  // A GET carrying the durable request identity confirms delivery, even after a
  // lost POST response or reload. Clearing only the matching text keeps newer edits.
  function reconcile(t) {
    if (typeof t.configured === 'boolean') configured = t.configured;
    const key = String(t.id), local = persisted[key], pending = local?.pending;
    if (!pending || !t.messages?.some(m => m.role === 'user' && m.request_id === pending.request_id)) return;
    delete local.pending;
    if (local.text?.trim() === pending.question.trim()) local.text = '';
    if (opened && currentKey === key && composer.value.trim() === pending.question.trim()) composer.value = local.text || '';
    saveLocal();
  }
  function connectionButton(value) {
    try {
      const url = new URL(value, location.origin);
      if (url.origin !== location.origin || !url.pathname.startsWith('/')) return null;
      const link = $('a', 'wd-text-button wd-connect', 'Models and connections');
      link.href = url.href; link.target = '_top'; return link;
    } catch (_) { return null; }
  }
  function messageNode(m) {
    const article = $('article', 'wd-message wd-' + (m.role === 'user' ? 'user' : 'assistant'));
    article.dataset.messageId = String(m.id);
    const text = $('div', 'wd-answer'); text.append(markdown(m.content)); article.append(text);
    if (m.role === 'assistant' && m.state === 'complete' && m.model && m.tested_on && m.model !== m.tested_on) article.append($('p', 'wd-model-caption', 'Answered by ' + m.model));
    if (m.role !== 'user' && ['streaming', 'pending', 'running'].includes(m.state)) article.append($('span', 'wd-caret', '●'));
    if (m.sources?.length) {
      const details = $('details', 'wd-sources'); details.append($('summary', '', 'Sources used · ' + m.sources.length));
      for (const s of m.sources) {
        const row = $('div', 'wd-source'), url = safeURL(s.url), title = s.title || s.label || 'Source';
        const label = $(url ? 'a' : 'strong', '', title);
        if (url) { label.href = url; label.target = '_blank'; label.rel = 'noopener noreferrer'; }
        row.append(label); if (s.text) row.append($('p', '', s.text)); details.append(row);
      }
      article.append(details);
    }
    if (m.error || ['error', 'failed', 'interrupted', 'cancelled', 'stopped'].includes(m.state)) {
      const box = $('div', 'wd-turn-error');
      box.append($('p', '', m.error || (['interrupted', 'cancelled', 'stopped'].includes(m.state) ? 'Reply stopped. The partial answer is saved.' : 'The model could not finish this reply.')));
      const connect = m.fix_url && connectionButton(m.fix_url);
      if (connect) box.append(connect);
      if (!thread.active && m.role !== 'user') {
        const at = thread.messages.findIndex(x => x.id === m.id);
        const q = thread.messages.slice(0, at).reverse().find(x => x.role === 'user');
        if (q) box.append(button('Retry this question', 'wd-text-button', async () => {
          if (busy) return;
          const own = revision;
          if (draft().pending) await ask(); // Confirm uncertain delivery with its original ID first.
          if (opened && own === revision && !draft().pending && !thread?.active) ask(q.content, true);
        }));
      }
      article.append(box);
    }
    return article;
  }
  function renderThread(initial = false) {
    if (!thread || !opened || view !== 'thread') return;
    const bottom = initial ? Boolean(thread.messages?.length) && draft().atBottom !== false : nearBottom(), oldScroll = body.scrollTop;
    subtitle.textContent = thread.chapter_title || 'Selected passage'; quoteText.textContent = thread.quote || '';
    empty.hidden = Boolean(thread.messages?.length); quoteBox.hidden = isChapter(thread);
    // Patch only changed messages. Never replace the composer or disturb its selection/focus.
    const nodes = new Map([...messages.children].map(n => [n.dataset.messageId, n]));
    for (const m of thread.messages || []) {
      const signature = JSON.stringify([m, thread.active, thread.detached, thread.model]);
      let node = nodes.get(String(m.id)); nodes.delete(String(m.id));
      if (node?.dataset.signature === signature) continue;
      const next = messageNode(m); next.dataset.signature = signature;
      if (node) {
        const oldDetails = node.querySelector('details'), nextDetails = next.querySelector('details');
        if (oldDetails && nextDetails) nextDetails.open = oldDetails.open;
        node.replaceWith(next);
      } else messages.append(next);
    }
    for (const node of nodes.values()) node.remove();
    renderState();
    body.scrollTop = bottom ? body.scrollHeight : initial ? (draft().scroll || 0) : oldScroll;
    jump.hidden = !thread.messages?.length || bottom || nearBottom();
  }
  function renderState() {
    if (!root || !opened) return;
    notice.replaceChildren();
    const addNotice = text => { if (text) notice.append($('p', '', text)); };
    addNotice(storageWarning);
    if (thread?.detached) addNotice('Earlier edition. This discussion uses the original passage and chapter saved when you started it.');
    if (configured === false) addNotice('The independent AI is not configured yet. You can read discussions and keep a draft.');
    if (actionError) {
      addNotice(actionError);
      if (retryAction) notice.append(button('Try again', 'wd-text-button', retryAction));
    }
    if (pollError) { addNotice('Connection lost. The reply may still be running. ' + pollError); notice.append(button('Reconnect', 'wd-text-button', () => schedulePoll(0))); }
    if (currentKey && draft().pending && !busy) {
      addNotice('Delivery not confirmed. Retry safely to check this same question; it will not be sent twice.');
      notice.append(button('Retry delivery', 'wd-text-button', () => ask()));
    }
    const running = !nativePending && Boolean(thread?.active), offline = navigator.onLine === false;
    const disabled = nativePending || loading || busy || !thread || offline;
    // A slow connection must never take away the place to write a question.
    composer.disabled = false;
    web.disabled = disabled || running || Boolean(currentKey && draft().pending);
    const label = running ? 'Stop' : busy ? 'Sending…' : offline ? 'Offline' : 'Send';
    if (sendLabel.textContent !== label) { sendLabel.textContent = label; send.setAttribute('aria-label', label); }
    if (send.dataset.mode !== (running ? 'stop' : 'send')) { send.dataset.mode = running ? 'stop' : 'send'; sendIcon.innerHTML = running ? ICON.stop : ICON.send; }
    send.disabled = running ? busy || offline : disabled || (!composer.value.trim() && !(currentKey && draft().pending));
    for (const b of starters.querySelectorAll('button')) b.disabled = busy || running;
    notice.hidden = !notice.childNodes.length;
    status.textContent = loading ? (nativePending ? 'Opening Chats… You can write now.' : 'Opening saved discussion…') : nativePending ? 'Your question is kept here until Chats can open.' : running ? 'Replying · saved as it arrives' : busy ? 'Saving your question…' : offline ? 'Offline · your draft stays here' : thread?.detached ? 'Earlier edition · original chapter context' : '';
    status.hidden = !status.textContent;
    syncHold();
  }
  function schedulePoll(delay = 1000) {
    clearTimeout(timer);
    if (!opened || view !== 'thread' || !thread?.active || document.hidden) return;
    const id = thread.id, own = revision, turnAt = turnVersion;
    timer = setTimeout(async () => {
      try {
        const t = await api(route(id));
        if (turnAt !== turnVersion) return;
        cacheThread(t);
        if (!opened || own !== revision) return;
        if (busy) { schedulePoll(); return; }
        thread = t; reconcile(t); pollError = ''; renderThread(); schedulePoll();
      } catch (e) {
        if (!opened || own !== revision || turnAt !== turnVersion) return;
        pollError = e.message; renderState(); schedulePoll(4000);
      }
    }, delay);
  }
  async function ask(question, explicitRetry = false) {
    if (nativePending) return;
    if (!thread || (thread.active && !draft().pending) || busy || navigator.onLine === false) return;
    const id = thread.id, key = currentKey, own = revision, local = draft();
    if (explicitRetry && local.pending) return;
    const text = typeof question === 'string' ? question : composer.value.trim();
    if (!text && !local.pending) return;
    const payload = local.pending || {question:text, request_id:crypto.randomUUID(), web_enabled:web.checked};
    const turnAt = ++turnVersion;
    local.pending = payload; local.anchor = lastAnchor; saveLocal(); busy = true; actionError = ''; retryAction = null; clearTimeout(timer);
    setExpanded(true); renderState();
    try {
      const accepted = await api(route(id) + '/ask', payload); if (turnAt === turnVersion) cacheThread(accepted);
      // The POST has returned: do not lock the composer/Stop behind its readback.
      if (opened && own === revision && turnAt === turnVersion) { thread = accepted; busy = false; renderThread(); schedulePoll(); }
      const t = await api(route(id)); if (turnAt === turnVersion) cacheThread(t); reconcile(t);
      if (!opened || own !== revision || turnAt !== turnVersion) return;
      thread = t;
      grow(); if (t.messages?.length === 2 && !isChapter(t)) quoteBox.open = false;
      renderThread(); refresh().catch(() => {});
    } catch (e) {
      // An uncertain POST keeps its exact request ID. A definite rejection can
      // be corrected and sent again; neither case discards the written question.
      if ((e.status === 400 || e.status === 403) && local.pending?.request_id === payload.request_id) { delete local.pending; saveLocal(); }
      if (opened && own === revision && turnAt === turnVersion) { actionError = e.message; }
    } finally {
      if (own === revision && turnAt === turnVersion) { busy = false; renderState(); schedulePoll(); }
      else { syncHold(); }
    }
  }
  async function stop() {
    if (nativePending) return;
    if (!thread?.active || busy) return;
    const id = thread.id, own = revision, turnAt = ++turnVersion; busy = true; actionError = ''; renderState(); clearTimeout(timer);
    try {
      await api(route(id) + '/stop', {}); const t = await api(route(id));
      if (turnAt === turnVersion) cacheThread(t); reconcile(t);
      if (opened && own === revision && turnAt === turnVersion) { thread = t; renderThread(); }
    } catch (e) { if (opened && own === revision && turnAt === turnVersion) actionError = 'Could not confirm Stop. ' + e.message; }
    finally { if (own === revision && turnAt === turnVersion) { busy = false; renderState(); schedulePoll(); } }
  }
  async function list(entryId) {
    openingController?.abort(); openingController = null; nativePending = false;
    show(); const own = ++revision; clearTimeout(timer); view = 'list'; scope = entryId;
    currentKey = null; thread = null; loading = false; busy = false; actionError = ''; pollError = '';
    headerTitle.textContent = 'Discussions'; subtitle.textContent = entryId == null ? 'Across your reading' : 'This chapter';
    footer.hidden = true; jump.hidden = true; setExpanded(true);
    body.replaceChildren($('p', 'wd-list-message', 'Loading saved discussions…'));
    try {
      await refresh(); if (!opened || own !== revision) return;
      body.replaceChildren();
      const rows = index.filter(t => scope == null || String(t.entry_id) === String(scope));
      if (!rows.length) body.append($('h3', 'wd-list-message', 'A conversation starts with a passage or a chapter.'), $('p', 'wd-list-message', 'Select text and choose Ask AI, or choose Discuss with AI at the end of a chapter. Saved discussions will appear here.'));
      for (const t of rows) {
        const row = button('', 'wd-thread-row', async () => {
          if (options.navigateTo) {
            try { await options.navigateTo(t); } catch (_) { /* Stored snapshot remains available even if the chapter has gone. */ }
          }
          if (opened && own === revision) open({id:t.id});
        });
        row.append($('span', 'wd-row-chapter', t.chapter_title || 'Saved passage'), isChapter(t) ? $('span', 'wd-row-scope', 'Whole chapter') : $('blockquote', '', t.quote || ''), $('p', 'wd-row-preview', t.preview || 'No messages yet'));
        const date = t.updated ? new Date(typeof t.updated === 'number' && t.updated < 1e12 ? t.updated * 1000 : t.updated) : null;
        const when = date && !Number.isNaN(date.getTime()) ? ' · ' + date.toLocaleDateString(undefined, {month:'short', day:'numeric'}) : '';
        row.append($('span', 'wd-row-meta', (t.message_count || 0) + ' messages' + when + (persisted[t.id]?.text ? ' · Draft' : '')));
        body.append(row);
      }
    } catch (e) {
      if (opened && own === revision) body.replaceChildren($('p', 'wd-list-message', e.message), button('Try again', 'wd-text-button', () => list(entryId)));
    }
  }
  // Parent's existing WizardApp.back.register must prioritize back() when isOpen().
  // consumeBack is the same honest domain step, not a popstate/history implementation.
  window.WisdomDiscussion = Object.freeze({configure, open, list, has, hasChapter, back, consumeBack:back, isOpen:() => opened, close, refresh});
})();
