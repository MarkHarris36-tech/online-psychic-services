/*
 * AI Tarot Reader (Selene) — online-psychic-services.com
 * Віджет: питання -> розклад -> тасування -> відкриття карт -> стрімінгове тлумачення -> уточнення.
 * Без залежностей. Текст відповіді ШІ рендериться лише через textContent (без innerHTML).
 */
(function () {
  'use strict';

  var MAX_QUESTION = 400;
  var MAX_FOLLOWUP = 300;
  var MAX_FOLLOWUPS = 6;
  var REVERSED_CHANCE = 30; // %
  var PROD_HOST = 'online-psychic-services.com';
  var PROD_API = 'https://online-psychic-services.com/api/tarot/read';

  var MAJOR = ['The Fool', 'The Magician', 'The High Priestess', 'The Empress', 'The Emperor', 'The Hierophant', 'The Lovers', 'The Chariot', 'Strength', 'The Hermit', 'Wheel of Fortune', 'Justice', 'The Hanged Man', 'Death', 'Temperance', 'The Devil', 'The Tower', 'The Star', 'The Moon', 'The Sun', 'Judgement', 'The World'];
  var RANKS = ['Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Page', 'Knight', 'Queen', 'King'];
  var SUITS = ['Wands', 'Cups', 'Swords', 'Pentacles'];
  var SUIT_GLYPH = { Wands: '✶', Cups: '☾', Swords: '†', Pentacles: '✦' };
  var ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI'];

  var SPREADS = {
    one: { label: 'One card', hint: 'A quick focus for today', positions: ['Your card'] },
    three: { label: 'Three cards', hint: 'Past, present, future', positions: ['Past', 'Present', 'Future'] },
    celtic: { label: 'Celtic Cross', hint: 'Ten cards, the full picture', positions: ['Present', 'Challenge', 'Foundation', 'Recent past', 'Crown', 'Near future', 'Self', 'Environment', 'Hopes and fears', 'Outcome'] }
  };

  function slugify(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  var DECK = (function () {
    var d = [];
    MAJOR.forEach(function (n, i) {
      d.push({ slug: slugify(n), name: n, arcana: 'major', suit: '', number: i, mark: ROMAN[i] });
    });
    SUITS.forEach(function (s) {
      RANKS.forEach(function (r, i) {
        d.push({ slug: slugify(r + ' of ' + s), name: r + ' of ' + s, arcana: 'minor', suit: s, number: i + 1, mark: SUIT_GLYPH[s] });
      });
    });
    return d;
  })();

  /* ---------- випадковість ---------- */
  function randInt(n) {
    var c = window.crypto || window.msCrypto;
    if (c && c.getRandomValues) {
      var limit = Math.floor(4294967296 / n) * n;
      var buf = new Uint32Array(1);
      do { c.getRandomValues(buf); } while (buf[0] >= limit);
      return buf[0] % n;
    }
    return Math.floor(Math.random() * n);
  }

  function drawCards(count) {
    var pool = DECK.slice();
    for (var i = pool.length - 1; i > 0; i--) {
      var j = randInt(i + 1);
      var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    return pool.slice(0, count).map(function (c) {
      return { slug: c.slug, name: c.name, arcana: c.arcana, suit: c.suit, number: c.number, mark: c.mark, reversed: randInt(100) < REVERSED_CHANCE };
    });
  }

  /* ---------- DOM-помічники ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  var uid = 0;

  /* Безпечний міні-markdown: абзаци, **жирний**, рядки з # / - / * */
  function renderText(target, text) {
    clear(target);
    var blocks = String(text || '').replace(/\r/g, '').split(/\n{2,}/);
    blocks.forEach(function (block) {
      block = block.trim();
      if (!block) return;
      var lines = block.split('\n');
      var p = el('p');
      lines.forEach(function (line, idx) {
        line = line.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/^\s*[-*•]\s+/, '• ');
        if (idx > 0) p.appendChild(document.createElement('br'));
        var parts = line.split(/(\*\*[^*]+\*\*)/g);
        parts.forEach(function (part) {
          if (!part) return;
          if (part.length > 4 && part.slice(0, 2) === '**' && part.slice(-2) === '**') {
            p.appendChild(el('strong', null, part.slice(2, -2)));
          } else {
            p.appendChild(document.createTextNode(part.replace(/\*\*/g, '').replace(/(^|\s)\*(?=\S)|(\S)\*(?=\s|$)/g, '$1$2')));
          }
        });
      });
      target.appendChild(p);
    });
  }

  /* ---------- віджет ---------- */
  function Widget(root) {
    this.root = root;
    this.id = ++uid;
    this.compact = root.getAttribute('data-compact') === '1';
    this.cardsUrl = (root.getAttribute('data-cards-url') || '/wp-content/themes/ops-theme/assets/cards/').replace(/\/?$/, '/');
    this.dataUrl = root.getAttribute('data-meanings-url') || '/wp-content/themes/ops-theme/assets/data/tarot-cards.json';
    this.meaningBase = (root.getAttribute('data-meaning-base') || '/tarot-card-meanings/').replace(/\/?$/, '/');
    this.fullUrl = root.getAttribute('data-full-url') || '';
    this.api = root.getAttribute('data-api') || (location.hostname.slice(-PROD_HOST.length) === PROD_HOST ? '/api/tarot/read' : PROD_API);
    this.meanings = null;
    this.reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.reset(true);
    this.build();
  }

  Widget.prototype.reset = function (first) {
    if (this.abort) { try { this.abort.abort(); } catch (e) { /* noop */ } }
    this.abort = null;
    this.question = '';
    this.spread = '';
    this.cards = [];
    this.revealed = 0;
    this.history = [];
    this.followups = 0;
    this.transcript = [];
    this.busy = false;
    this.offline = false;
    this.lastReading = '';
    if (!first) this.build();
  };

  Widget.prototype.build = function () {
    var self = this;
    var root = this.root;
    clear(root);
    root.classList.add('ait');
    if (this.compact) root.classList.add('ait--compact');
    var p = 'ait' + this.id + '-';

    var head = el('div', 'ait-head');
    var av = el('span', 'ait-avatar', '☾');
    av.setAttribute('aria-hidden', 'true');
    var who = el('div', 'ait-who');
    who.appendChild(el('strong', 'ait-name', 'Selene'));
    who.appendChild(el('span', 'ait-role', 'AI Tarot Reader'));
    head.appendChild(av);
    head.appendChild(who);
    head.appendChild(el('span', 'ait-badge', 'AI · for entertainment'));
    root.appendChild(head);

    var live = el('div', 'ait-sr');
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    this.live = live;
    root.appendChild(live);

    /* Крок 1: питання */
    var s1 = el('section', 'ait-step ait-step--ask');
    s1.setAttribute('aria-labelledby', p + 'h1');
    var intro = el('div', 'ait-bubble ait-bubble--selene');
    var h1 = el('p', 'ait-step-title', 'Hello, I’m Selene.');
    h1.id = p + 'h1';
    h1.tabIndex = -1;
    intro.appendChild(h1);
    intro.appendChild(el('p', null, 'I’m an AI, not a human psychic, and I can’t see your future. I read the cards as symbols for reflection and entertainment. What would you like to explore?'));
    s1.appendChild(intro);
    var form = el('form', 'ait-form');
    form.setAttribute('novalidate', '');
    var lab = el('label', 'ait-label', 'Your question');
    lab.setAttribute('for', p + 'q');
    var ta = el('textarea', 'ait-input');
    ta.id = p + 'q';
    ta.rows = this.compact ? 2 : 3;
    ta.maxLength = MAX_QUESTION;
    ta.placeholder = 'e.g. What should I focus on in my career this month?';
    ta.setAttribute('aria-describedby', p + 'qh');
    var qh = el('p', 'ait-hint', 'Keep it open-ended. Please don’t include names or personal details. 0/' + MAX_QUESTION);
    qh.id = p + 'qh';
    ta.addEventListener('input', function () { qh.textContent = 'Keep it open-ended. Please don’t include names or personal details. ' + ta.value.length + '/' + MAX_QUESTION; });
    var err = el('p', 'ait-error');
    err.setAttribute('role', 'alert');
    var next = el('button', 'ait-btn ait-btn--primary', 'Continue');
    next.type = 'submit';
    form.appendChild(lab); form.appendChild(ta); form.appendChild(qh); form.appendChild(err); form.appendChild(next);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var q = ta.value.replace(/\s+/g, ' ').trim();
      if (q.length < 3) { err.textContent = 'Please type a short question (at least 3 characters).'; ta.focus(); return; }
      err.textContent = '';
      self.question = q;
      self.showSpreads();
    });
    s1.appendChild(form);
    root.appendChild(s1);
    this.stepAsk = s1;

    /* Крок 2: розклад */
    var s2 = el('section', 'ait-step ait-step--spread');
    s2.hidden = true;
    s2.setAttribute('aria-labelledby', p + 'h2');
    var h2 = el('p', 'ait-step-title', 'Choose your spread');
    h2.id = p + 'h2';
    h2.tabIndex = -1;
    s2.appendChild(h2);
    var qEcho = el('p', 'ait-qecho');
    this.qEcho = qEcho;
    s2.appendChild(qEcho);
    var opts = el('div', 'ait-spreads');
    opts.setAttribute('role', 'group');
    opts.setAttribute('aria-labelledby', p + 'h2');
    Object.keys(SPREADS).forEach(function (key) {
      var sp = SPREADS[key];
      var b = el('button', 'ait-spread');
      b.type = 'button';
      b.appendChild(el('span', 'ait-spread-name', sp.label));
      b.appendChild(el('span', 'ait-spread-hint', sp.hint));
      b.addEventListener('click', function () { self.startDraw(key); });
      opts.appendChild(b);
    });
    s2.appendChild(opts);
    var back = el('button', 'ait-btn ait-btn--ghost', 'Edit question');
    back.type = 'button';
    back.addEventListener('click', function () { self.show('ask'); ta.focus(); });
    s2.appendChild(back);
    root.appendChild(s2);
    this.stepSpread = s2;

    /* Крок 3: карти + розклад */
    var s3 = el('section', 'ait-step ait-step--table');
    s3.hidden = true;
    s3.setAttribute('aria-labelledby', p + 'h3');
    var h3 = el('p', 'ait-step-title', 'Shuffling the deck…');
    h3.id = p + 'h3';
    h3.tabIndex = -1;
    this.tableTitle = h3;
    s3.appendChild(h3);
    var shuffle = el('div', 'ait-shuffle');
    shuffle.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < 5; i++) shuffle.appendChild(el('span', 'ait-shuffle-card'));
    this.shuffleEl = shuffle;
    s3.appendChild(shuffle);
    var table = el('ol', 'ait-table');
    this.tableEl = table;
    s3.appendChild(table);
    var tools = el('div', 'ait-tools');
    var all = el('button', 'ait-btn ait-btn--ghost', 'Reveal all cards');
    all.type = 'button';
    all.addEventListener('click', function () { self.revealAll(); });
    this.revealAllBtn = all;
    tools.appendChild(all);
    s3.appendChild(tools);
    root.appendChild(s3);
    this.stepTable = s3;

    /* Крок 4: розмова */
    var s4 = el('section', 'ait-step ait-step--chat');
    s4.hidden = true;
    s4.setAttribute('aria-label', 'Your reading');
    var log = el('div', 'ait-log');
    this.logEl = log;
    s4.appendChild(log);
    var fform = el('form', 'ait-form ait-follow');
    fform.setAttribute('novalidate', '');
    var fl = el('label', 'ait-label', 'Ask Selene a follow-up question');
    fl.setAttribute('for', p + 'f');
    var fi = el('input', 'ait-input ait-input--line');
    fi.type = 'text';
    fi.id = p + 'f';
    fi.maxLength = MAX_FOLLOWUP;
    fi.autocomplete = 'off';
    fi.placeholder = 'e.g. What does the last card mean for me?';
    var fcount = el('p', 'ait-hint');
    var ferr = el('p', 'ait-error');
    ferr.setAttribute('role', 'alert');
    var fb = el('button', 'ait-btn ait-btn--primary', 'Ask');
    fb.type = 'submit';
    var row = el('div', 'ait-follow-row');
    row.appendChild(fi); row.appendChild(fb);
    fform.appendChild(fl); fform.appendChild(row); fform.appendChild(fcount); fform.appendChild(ferr);
    this.followForm = fform; this.followInput = fi; this.followCount = fcount; this.followErr = ferr; this.followBtn = fb;
    fform.addEventListener('submit', function (e) {
      e.preventDefault();
      var q = fi.value.replace(/\s+/g, ' ').trim();
      if (q.length < 2) { ferr.textContent = 'Please type your question.'; return; }
      if (self.busy) return;
      ferr.textContent = '';
      fi.value = '';
      self.askFollowup(q);
    });
    s4.appendChild(fform);
    var actions = el('div', 'ait-tools ait-actions');
    var copy = el('button', 'ait-btn ait-btn--ghost', 'Copy reading');
    copy.type = 'button';
    copy.addEventListener('click', function () { self.copyReading(copy); });
    var save = el('button', 'ait-btn ait-btn--ghost', 'Save as text file');
    save.type = 'button';
    save.addEventListener('click', function () { self.saveReading(); });
    var again = el('button', 'ait-btn ait-btn--dark', 'New reading');
    again.type = 'button';
    again.addEventListener('click', function () { self.reset(false); var t = self.root.querySelector('.ait-input'); if (t) t.focus(); });
    actions.appendChild(copy); actions.appendChild(save); actions.appendChild(again);
    s4.appendChild(actions);
    s4.appendChild(el('p', 'ait-fine', 'Selene is an AI. Readings are for entertainment and self-reflection, not advice on health, legal, money or safety decisions. Questions you type are sent to an AI service to generate the reading.'));
    root.appendChild(s4);
    this.stepChat = s4;

    if (this.compact && this.fullUrl) {
      var more = el('p', 'ait-more');
      var a = el('a', null, 'Open the full AI Tarot Reader');
      a.href = this.fullUrl;
      more.appendChild(a);
      root.appendChild(more);
    }
    this.updateFollowCount();
  };

  Widget.prototype.show = function (name) {
    this.stepAsk.hidden = name !== 'ask';
    this.stepSpread.hidden = name !== 'spread';
    this.stepTable.hidden = name !== 'table';
    this.stepChat.hidden = name !== 'chat';
    // залишаємо стіл видимим, коли йде розмова
    if (name === 'chat') this.stepTable.hidden = false;
  };

  Widget.prototype.announce = function (msg) {
    var live = this.live;
    live.textContent = '';
    window.setTimeout(function () { live.textContent = msg; }, 30);
  };

  Widget.prototype.showSpreads = function () {
    this.qEcho.textContent = '“' + this.question + '”';
    this.show('spread');
    var h = this.stepSpread.querySelector('.ait-step-title');
    if (h) h.focus();
  };

  Widget.prototype.startDraw = function (key) {
    var self = this;
    this.spread = key;
    var sp = SPREADS[key];
    this.cards = drawCards(sp.positions.length).map(function (c, i) { c.position = sp.positions[i]; return c; });
    this.revealed = 0;
    this.stepTable.classList.remove('is-done');
    this.stepTable.setAttribute('data-spread', key);
    clear(this.tableEl);
    this.revealAllBtn.hidden = true;
    this.tableEl.hidden = true;
    this.tableTitle.textContent = 'Shuffling the deck…';
    this.shuffleEl.hidden = false;
    this.show('table');
    this.tableTitle.focus();
    this.announce('Shuffling the deck.');
    this.preloadMeanings();
    var wait = this.reducedMotion ? 150 : 1800;
    window.setTimeout(function () { self.layCards(); }, wait);
  };

  Widget.prototype.layCards = function () {
    var self = this;
    this.shuffleEl.hidden = true;
    this.tableEl.hidden = false;
    this.revealAllBtn.hidden = false;
    this.tableTitle.textContent = 'Tap each card to turn it over';
    this.cards.forEach(function (c, i) {
      var li = el('li', 'ait-slot');
      var btn = el('button', 'ait-card');
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Reveal card ' + (i + 1) + ' of ' + self.cards.length + ': ' + c.position);
      var inner = el('span', 'ait-card-inner');
      var back = el('span', 'ait-face ait-face--back');
      back.setAttribute('aria-hidden', 'true');
      back.appendChild(el('span', 'ait-back-mark', '✦'));
      var front = el('span', 'ait-face ait-face--front');
      front.setAttribute('aria-hidden', 'true');
      var art = el('span', 'ait-art' + (c.reversed ? ' is-reversed' : ''));
      var fb = el('span', 'ait-fallback');
      fb.appendChild(el('span', 'ait-fallback-mark', c.mark));
      fb.appendChild(el('span', 'ait-fallback-name', c.name));
      art.appendChild(fb);
      var img = new Image();
      img.className = 'ait-img';
      img.alt = '';
      img.decoding = 'async';
      img.addEventListener('load', function () { art.classList.add('has-img'); });
      img.addEventListener('error', function () { art.classList.remove('has-img'); if (img.parentNode) img.parentNode.removeChild(img); });
      img.src = self.cardsUrl + c.slug + '.webp';
      art.appendChild(img);
      front.appendChild(art);
      inner.appendChild(back); inner.appendChild(front);
      btn.appendChild(inner);
      var cap = el('span', 'ait-cap');
      cap.appendChild(el('span', 'ait-pos', c.position));
      cap.hidden = true;
      var link = el('a', 'ait-cardlink', c.name);
      link.href = self.meaningBase + c.slug + '/';
      cap.appendChild(link);
      cap.appendChild(el('span', 'ait-orient', c.reversed ? 'Reversed' : 'Upright'));
      btn.addEventListener('click', function () { self.reveal(i, btn, cap); });
      li.appendChild(btn);
      li.appendChild(cap);
      self.tableEl.appendChild(li);
    });
    var first = this.tableEl.querySelector('.ait-card');
    if (first) first.focus();
    this.announce(this.cards.length + (this.cards.length === 1 ? ' card is' : ' cards are') + ' laid face down. Select each to reveal it.');
  };

  Widget.prototype.reveal = function (i, btn, cap) {
    if (btn.classList.contains('is-flipped')) return;
    var c = this.cards[i];
    btn.classList.add('is-flipped');
    btn.disabled = true;
    btn.setAttribute('aria-label', c.position + ': ' + c.name + (c.reversed ? ', reversed' : ', upright'));
    cap.hidden = false;
    this.revealed++;
    this.announce('Card ' + (i + 1) + ', ' + c.position + ': ' + c.name + (c.reversed ? ', reversed.' : ', upright.'));
    if (this.revealed >= this.cards.length) this.afterReveal();
    else {
      var nextBtn = this.tableEl.querySelectorAll('.ait-card:not(.is-flipped)')[0];
      if (nextBtn) nextBtn.focus();
    }
  };

  Widget.prototype.revealAll = function () {
    var self = this;
    var slots = this.tableEl.querySelectorAll('.ait-slot');
    Array.prototype.forEach.call(slots, function (slot, i) {
      var btn = slot.querySelector('.ait-card');
      if (btn && !btn.classList.contains('is-flipped')) self.reveal(i, btn, slot.querySelector('.ait-cap'));
    });
  };

  Widget.prototype.afterReveal = function () {
    var self = this;
    this.revealAllBtn.hidden = true;
    this.tableTitle.textContent = 'Your cards';
    this.stepTable.classList.add('is-done');
    window.setTimeout(function () { self.requestReading(); }, this.reducedMotion ? 0 : 700);
  };

  /* ---------- повідомлення ---------- */
  Widget.prototype.addBubble = function (who, text) {
    var b = el('div', 'ait-bubble ait-bubble--' + who);
    var label = el('span', 'ait-sr', who === 'selene' ? 'Selene says: ' : 'You asked: ');
    b.appendChild(label);
    var body = el('div', 'ait-bubble-body');
    if (text) renderText(body, text);
    b.appendChild(body);
    this.logEl.appendChild(b);
    return { bubble: b, body: body };
  };

  Widget.prototype.payloadCards = function () {
    return this.cards.map(function (c) { return { slug: c.slug, name: c.name, reversed: c.reversed, position: c.position }; });
  };

  Widget.prototype.setBusy = function (on) {
    this.busy = on;
    this.followBtn.disabled = on;
    this.followInput.disabled = on;
    this.logEl.setAttribute('aria-busy', on ? 'true' : 'false');
  };

  Widget.prototype.updateFollowCount = function () {
    var left = MAX_FOLLOWUPS - this.followups;
    if (left <= 0) {
      this.followCount.textContent = 'You have used all ' + MAX_FOLLOWUPS + ' follow-up questions. Start a new reading to continue.';
      this.followInput.disabled = true;
      this.followBtn.disabled = true;
    } else {
      this.followCount.textContent = left + ' follow-up question' + (left === 1 ? '' : 's') + ' left';
    }
  };

  Widget.prototype.requestReading = function () {
    var self = this;
    this.show('chat');
    clear(this.logEl);
    this.addBubble('user', this.question);
    var target = this.addBubble('selene', '');
    var typing = el('span', 'ait-typing', 'Selene is reading the cards…');
    target.body.appendChild(typing);
    this.setBusy(true);
    this.announce('Selene is reading your cards.');
    this.stream({
      question: this.question, spread: this.spread, cards: this.payloadCards()
    }, target).then(function (text) {
      self.history = [{ role: 'assistant', content: text }];
      self.transcript.push({ who: 'Selene', text: text });
      self.finishTurn(target, true);
    }).catch(function (e) {
      self.fallbackReading(target, e);
    });
  };

  Widget.prototype.askFollowup = function (q) {
    var self = this;
    this.addBubble('user', q);
    this.transcript.push({ who: 'You', text: q });
    var target = this.addBubble('selene', '');
    target.body.appendChild(el('span', 'ait-typing', 'Selene is thinking…'));
    this.setBusy(true);
    this.followups++;
    var hist = this.history.slice(-6);
    this.stream({
      question: this.question, spread: this.spread, cards: this.payloadCards(),
      history: hist, followup: q, followupCount: this.followups - 1
    }, target).then(function (text) {
      self.history.push({ role: 'user', content: q });
      self.history.push({ role: 'assistant', content: text });
      self.transcript.push({ who: 'Selene', text: text });
      self.finishTurn(target, false);
    }).catch(function (e) {
      if (e && e.code === 'followup_limit') {
        self.followups = MAX_FOLLOWUPS;
        renderText(target.body, e.message);
        self.finishTurn(target, false);
        return;
      }
      var text = self.offlineFollowup(q);
      self.history.push({ role: 'user', content: q });
      self.history.push({ role: 'assistant', content: text });
      self.transcript.push({ who: 'Selene (offline)', text: text });
      renderText(target.body, text);
      self.finishTurn(target, false);
    });
  };

  Widget.prototype.finishTurn = function (target, isFirst) {
    this.setBusy(false);
    this.updateFollowCount();
    target.bubble.scrollIntoView({ block: 'nearest', behavior: this.reducedMotion ? 'auto' : 'smooth' });
    this.announce(isFirst ? 'Your reading is ready.' : 'Selene has replied.');
    if (isFirst) {
      var h = target.bubble;
      h.tabIndex = -1;
      h.focus({ preventScroll: true });
    } else if (!this.followInput.disabled) {
      this.followInput.focus({ preventScroll: true });
    }
  };

  /* ---------- мережа: SSE ---------- */
  Widget.prototype.stream = function (payload, target) {
    var self = this;
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    this.abort = ctrl;
    var timer = window.setTimeout(function () { if (ctrl) ctrl.abort(); }, 70000);
    return fetch(this.api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
      body: JSON.stringify(payload),
      signal: ctrl ? ctrl.signal : undefined,
      credentials: 'omit'
    }).then(function (res) {
      var ct = res.headers.get('Content-Type') || '';
      if (!res.ok || ct.indexOf('text/event-stream') === -1) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          var err = new Error(j.error || 'The reader is unavailable right now.');
          err.code = j.code || ('http_' + res.status);
          err.status = res.status;
          throw err;
        });
      }
      if (!res.body || !res.body.getReader) throw new Error('Streaming not supported');
      var reader = res.body.getReader();
      var dec = new TextDecoder();
      var buf = '';
      var full = '';
      var raf = 0;
      var started = false;
      function paint() {
        raf = 0;
        renderText(target.body, full);
        target.bubble.scrollIntoView({ block: 'nearest' });
      }
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return finish();
          buf += dec.decode(r.value, { stream: true });
          var idx;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            var evt = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            var line = evt.split('\n').filter(function (l) { return l.indexOf('data:') === 0; }).map(function (l) { return l.slice(5).trim(); }).join('');
            if (!line) continue;
            if (line === '[DONE]') return finish();
            try {
              var j = JSON.parse(line);
              if (j.error) throw new Error('empty');
              if (j.delta) { full += j.delta; started = true; if (!raf) raf = window.requestAnimationFrame(paint); }
            } catch (e) {
              if (e.message === 'empty') throw e;
            }
          }
          return pump();
        });
      }
      function finish() {
        if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
        if (!started || !full.trim()) throw new Error('Empty reading');
        renderText(target.body, full);
        return full;
      }
      return pump();
    }).then(function (v) {
      window.clearTimeout(timer);
      self.abort = null;
      return v;
    }, function (e) {
      window.clearTimeout(timer);
      self.abort = null;
      throw e;
    });
  };

  /* ---------- офлайн-тлумачення ---------- */
  Widget.prototype.preloadMeanings = function () {
    var self = this;
    if (this.meanings !== null) return Promise.resolve(this.meanings);
    if (this.meaningsPromise) return this.meaningsPromise;
    this.meaningsPromise = fetch(this.dataUrl, { credentials: 'omit' }).then(function (r) {
      if (!r.ok) throw new Error('no data');
      return r.json();
    }).then(function (arr) {
      var map = {};
      (Array.isArray(arr) ? arr : (arr && arr.cards) || []).forEach(function (c) { if (c && c.slug) map[c.slug] = c; });
      self.meanings = map;
      return map;
    }).catch(function () {
      self.meanings = {};
      return self.meanings;
    });
    return this.meaningsPromise;
  };

  function firstText(v) {
    if (Array.isArray(v)) return v.join(', ');
    return typeof v === 'string' ? v : '';
  }
  function sentence(s) {
    s = String(s || '').trim();
    if (!s) return '';
    return /[.!?]$/.test(s) ? s : s + '.';
  }

  Widget.prototype.focusKey = function () {
    var q = (this.question || '').toLowerCase();
    if (/\b(love|relationship|partner|dating|romance|ex|marriage|crush|heart)\b/.test(q)) return 'love';
    if (/\b(career|job|work|business|money|promotion|boss|study|school|project)\b/.test(q)) return 'career';
    return 'advice';
  };

  Widget.prototype.offlineReading = function () {
    var self = this;
    var m = this.meanings || {};
    var key = this.focusKey();
    var out = ['I couldn’t reach my live reading service just now, so here is a reading built from the card-meaning library instead. As always, it is for reflection and entertainment.'];
    this.cards.forEach(function (c) {
      var d = m[c.slug] || {};
      var core = c.reversed ? (d.reversed || '') : (d.upright || '');
      var kw = firstText(c.reversed ? d.keywords_reversed : d.keywords_upright);
      var line = '**' + c.position + ': ' + c.name + (c.reversed ? ' (reversed)' : '') + '**\n';
      if (core) line += sentence(core);
      else if (kw) line += 'Themes here: ' + kw + '.';
      else line += c.reversed ? 'Reversed, this card often points to energy that is blocked, internal or asking for another look.' : 'This card asks you to notice what it brings into focus for your question.';
      if (d[key] && !c.reversed) line += ' ' + sentence(d[key]);
      out.push(line);
    });
    var last = this.cards[this.cards.length - 1];
    var ld = m[last.slug] || {};
    var closing = '**Putting it together**\nRead these cards as a mirror for your question: “' + this.question + '”. ';
    closing += ld.advice ? sentence(ld.advice) + ' ' : 'Notice which card stirs the strongest reaction in you and begin there. ';
    closing += 'What is one small step you could take this week?';
    out.push(closing);
    return out.join('\n\n');
  };

  Widget.prototype.offlineFollowup = function (q) {
    var m = this.meanings || {};
    var ql = q.toLowerCase();
    var pick = this.cards.filter(function (c) { return ql.indexOf(c.name.toLowerCase()) >= 0; })[0] || this.cards[this.cards.length - 1];
    var d = m[pick.slug] || {};
    var base = (pick.reversed ? d.reversed : d.upright) || d.summary || '';
    var text = 'I can’t reach my live reading service right now, so I can only share what the card library says. Looking at **' + pick.name + (pick.reversed ? ' (reversed)' : '') + '**: ';
    text += base ? sentence(base) + ' ' : 'consider what this card’s symbolism stirs in you. ';
    if (d.advice) text += sentence(d.advice);
    return text.trim();
  };

  Widget.prototype.fallbackReading = function (target, err) {
    var self = this;
    var limited = err && err.status === 429;
    this.offline = true;
    this.preloadMeanings().then(function () {
      var text = limited
        ? (err.message || 'Too many readings right now. Please try again in a few minutes.') + '\n\nIn the meantime, here is a reading from the card-meaning library.\n\n' + self.offlineReading()
        : self.offlineReading();
      renderText(target.body, text);
      self.history = [{ role: 'assistant', content: text }];
      self.transcript.push({ who: 'Selene (offline)', text: text });
      self.finishTurn(target, true);
    });
  };

  /* ---------- збереження ---------- */
  Widget.prototype.readingText = function () {
    var lines = [];
    lines.push('AI Tarot Reading - Online Psychic Services');
    lines.push('Reader: Selene (AI). For entertainment and self-reflection only.');
    lines.push('');
    lines.push('Question: ' + this.question);
    lines.push('Spread: ' + (SPREADS[this.spread] ? SPREADS[this.spread].label : ''));
    lines.push('');
    this.cards.forEach(function (c) { lines.push('- ' + c.position + ': ' + c.name + (c.reversed ? ' (reversed)' : ' (upright)')); });
    lines.push('');
    this.transcript.forEach(function (t) {
      lines.push(t.who + ':');
      lines.push(String(t.text).replace(/\*\*/g, ''));
      lines.push('');
    });
    lines.push('https://online-psychic-services.com/ai-tarot-reader/');
    return lines.join('\n');
  };

  Widget.prototype.copyReading = function (btn) {
    var self = this;
    var text = this.readingText();
    var done = function (ok) {
      var old = 'Copy reading';
      btn.textContent = ok ? 'Copied' : 'Copy failed';
      self.announce(ok ? 'Reading copied to clipboard.' : 'Could not copy. Use Save as text file instead.');
      window.setTimeout(function () { btn.textContent = old; }, 2000);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(legacyCopy(text)); });
    } else {
      done(legacyCopy(text));
    }
  };

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  Widget.prototype.saveReading = function () {
    var blob = new Blob([this.readingText()], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'tarot-reading.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    this.announce('Reading saved as a text file.');
  };

  function init() {
    var nodes = document.querySelectorAll('[data-ai-tarot]');
    Array.prototype.forEach.call(nodes, function (n) {
      if (n.getAttribute('data-ait-ready')) return;
      n.setAttribute('data-ait-ready', '1');
      new Widget(n);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
