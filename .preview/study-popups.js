"use strict";
(() => {
  // src/shared/study-cycle.ts
  var emptyStudyCycleState = () => ({ activeId: null, cycles: [] });

  // src/shared/study-trail.ts
  var ITEM = /^[-*+]\s+\[( |x|X)\]\s+(?:\[([A-Za-z0-9][\w.-]{0,39})\]\s+)?(.+)$/;
  var DISCIPLINE = /^###\s+(?:\[[^\]]+\]\s+)?(.+?)(?:\s+[—–-]\s+\d+\s*h)?\s*$/;
  function parseStudyTrail(source) {
    if (source === null) return { found: false, topics: [] };
    const topics = [];
    let period = "";
    let discipline = "";
    for (const raw of source.replace(/^\uFEFF/, "").split(/\r?\n/)) {
      const line = raw.trim();
      if (/^##\s/.test(line)) {
        period = line.replace(/^##\s+/, "").trim();
        discipline = "";
        continue;
      }
      const heading = DISCIPLINE.exec(line);
      if (heading) {
        discipline = heading[1].trim();
        continue;
      }
      if (/^#\s/.test(line)) continue;
      const item = ITEM.exec(line);
      if (!item || !discipline) continue;
      const title = item[3].trim().replace(/\.$/, "").slice(0, 180);
      const id = item[2] ?? null;
      topics.push({ id, title, done: item[1] !== " ", discipline, period, index: 0, total: 0, label: id ? `[${id}] ${title}` : title });
    }
    const counts = /* @__PURE__ */ new Map();
    for (const topic of topics) {
      const key2 = `${topic.period}
${topic.discipline}`;
      topic.index = (counts.get(key2) ?? 0) + 1;
      counts.set(key2, topic.index);
    }
    for (const topic of topics) topic.total = counts.get(`${topic.period}
${topic.discipline}`);
    return { found: true, topics };
  }
  function studyTrailBoard(trail, state) {
    const lists = /* @__PURE__ */ new Map();
    for (const topic of trail.topics) {
      const key2 = `${topic.period}
${topic.discipline}`;
      let list = lists.get(key2);
      if (!list) {
        list = { key: key2, discipline: topic.discipline, period: topic.period, cards: [], open: 0, current: false };
        lists.set(key2, list);
      }
      const card = trailCard(topic, state);
      if (card.state === "current") list.current = true;
      if (card.state !== "completed" && card.state !== "checked") list.open++;
      list.cards.push(card);
    }
    return [...lists.values()];
  }
  var sameTopic = (topic, label) => {
    const clean = label.trim();
    const id = /^\[([^\]]+)\]/.exec(clean)?.[1];
    return clean === topic.label || id !== void 0 && id === topic.id;
  };
  function trailCard(topic, state) {
    const mine = state.cycles.filter((cycle) => sameTopic(topic, cycle.topic)).sort((a, b) => b.updatedAt - a.updatedAt);
    const active = mine.find((cycle) => cycle.id === state.activeId);
    if (active) return { topic, state: "current", cycleId: active.id, cycleStage: active.stage };
    const kept = mine.find((cycle) => cycle.stage !== "completed");
    if (kept) return { topic, state: "kept", cycleId: kept.id, cycleStage: kept.stage };
    const completed = mine.find((cycle) => cycle.stage === "completed");
    if (completed) return { topic, state: "completed", cycleId: completed.id, cycleStage: completed.stage };
    return { topic, state: topic.done ? "checked" : "new" };
  }
  function studyTopicStart(state, label) {
    const active = state.cycles.find((cycle) => cycle.id === state.activeId);
    const clean = label.trim();
    const id = /^\[([^\]]+)\]/.exec(clean)?.[1];
    const matches = (topic) => topic.trim() === clean || id !== void 0 && /^\[([^\]]+)\]/.exec(topic.trim())?.[1] === id;
    if (active && matches(active.topic)) return { kind: "open" };
    const kept = state.cycles.filter((cycle) => cycle.id !== state.activeId && cycle.stage !== "completed" && matches(cycle.topic)).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (kept) return { kind: "resume", cycleId: kept.id };
    return { kind: "new", setAside: !!active };
  }
  var STUDY_TRAIL_STATE_LABEL = {
    current: "Ciclo atual",
    kept: "Ciclo guardado",
    completed: "Conclu\xEDdo",
    checked: "Marcado na trilha",
    new: "N\xE3o iniciado"
  };

  // src/renderer/src/ui/a11y.ts
  var FOCUSABLE = [
    "a[href]",
    "button:not([disabled])",
    'input:not([disabled]):not([type="hidden"])',
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]'
  ].join(",");
  function focusables(root) {
    return [...root.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
  }
  function isTyping(el = document.activeElement) {
    return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el instanceof HTMLElement && (el.isContentEditable || el.getAttribute("role") === "combobox");
  }
  var nextId = 0;
  function idOf(el) {
    if (!el.id) el.id = `a11y-${++nextId}`;
    return el.id;
  }
  function trapTab(el) {
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Tab" || e.defaultPrevented) return;
      const list = focusables(el);
      const a = document.activeElement;
      if (!list.length) {
        e.preventDefault();
        el.focus();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && (a === first || a === el || !el.contains(a))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (a === last || !el.contains(a))) {
        e.preventDefault();
        first.focus();
      }
    });
  }
  function asDialog(el, opts = {}) {
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", String(opts.modal ?? true));
    el.tabIndex = -1;
    labelDialog(el, opts);
    if (!el.dataset.trap) {
      el.dataset.trap = "1";
      trapTab(el);
    }
  }
  function labelDialog(el, opts) {
    const titles = opts.title ? Array.isArray(opts.title) ? opts.title : [opts.title] : [];
    if (titles.length) el.setAttribute("aria-labelledby", titles.map(idOf).join(" "));
    else el.removeAttribute("aria-labelledby");
    if (opts.label) el.setAttribute("aria-label", opts.label);
    if (opts.description) el.setAttribute("aria-describedby", idOf(opts.description));
    else el.removeAttribute("aria-describedby");
  }
  var FocusReturn = class {
    back = null;
    /** Call when the dialog opens. Focus already inside `el` is not remembered. */
    save(el) {
      const a = document.activeElement;
      if (a instanceof HTMLElement && a !== document.body && !el.contains(a)) this.back = a;
    }
    /** Call when it closes: focus goes back if it was inside `el` (or got lost) and the old element is still there. */
    restore(el) {
      const back = this.back;
      this.back = null;
      const a = document.activeElement;
      if (!back || !back.isConnected || back.getClientRects().length === 0) return;
      if (a && a !== document.body && !el.contains(a)) return;
      back.focus({ preventScroll: true });
    }
  };
  var watched = /* @__PURE__ */ new Map();
  var observer = null;
  function checkWatched() {
    for (const [el, w] of watched) {
      if (el.isConnected && !w.seen) {
        w.seen = true;
        w.onShown();
      } else if (!el.isConnected && w.seen) {
        watched.delete(el);
        w.onGone();
      }
    }
    if (!watched.size && observer) {
      observer.disconnect();
      observer = null;
    }
  }
  function modalA11y(backdrop, box, title) {
    asDialog(box, { title });
    const focus = new FocusReturn();
    focus.save(box);
    watched.set(backdrop, {
      seen: false,
      // Runs after the caller's own .focus() calls, which happen right after append.
      onShown: () => {
        if (!box.contains(document.activeElement)) box.focus({ preventScroll: true });
      },
      onGone: () => focus.restore(box)
    });
    if (!observer) {
      observer = new MutationObserver(checkWatched);
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }
  function rove(items, current) {
    items.forEach((el, i) => el.tabIndex = i === current ? 0 : -1);
  }
  var live = null;
  function mountLiveRegions(root = document.body) {
    if (live) return;
    const region = (politeness) => {
      const el = document.createElement("div");
      el.className = "sr-only";
      el.setAttribute("aria-live", politeness);
      el.setAttribute("aria-atomic", "true");
      el.setAttribute("role", politeness === "assertive" ? "alert" : "status");
      el.dataset.live = politeness;
      root.append(el);
      return el;
    };
    live = { polite: region("polite"), assertive: region("assertive") };
  }
  function announce(text, politeness = "polite") {
    if (!live) mountLiveRegions();
    const el = live[politeness];
    el.textContent = "";
    setTimeout(() => el.textContent = text, 60);
  }

  // src/renderer/src/ui/dom.ts
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === void 0 || v === null || v === false) continue;
      if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "class") el.className = String(v);
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, String(v));
    }
    for (const c of children.flat()) {
      if (c === null || c === void 0 || c === false) continue;
      el.append(c instanceof Node ? c : String(c));
    }
    return el;
  }
  var ICONS = {
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    radio: '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5M19.1 4.9C23 8.8 23 15.1 19.1 19"/><circle cx="12" cy="12" r="2"/>',
    volume: '<path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    home: '<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    walk: '<circle cx="13" cy="4" r="2"/><path d="m7 21 3-6 2 2v4M10 15l1-5 3 3 3 1M8 10l3-2 3 1"/>',
    folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    terminal: '<path d="m4 17 6-6-6-6M12 19h8"/>',
    fire: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 11h-6"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3 6 1 1 2-2M3 12l1 1 2-2M3 18l1 1 2-2"/>',
    plug: '<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    zoomIn: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/>',
    zoomOut: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3M8 11h6"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
    gauge: '<path d="m12 14 4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/>',
    coin: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .9-3 2s1.3 1.7 3 2 3 .9 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6v2M12 16v2"/>',
    compact: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
    reply: '<path d="M9 17 4 12l5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
    report: '<path d="M3 3v18h18"/><path d="M8 17v-5M13 17V8M18 17v-8"/>',
    kanban: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 7v7M12 7v4M16 7v9"/>',
    pin: '<path d="M12 17v5"/><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3z"/>',
    trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    edit: '<path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    bot: '<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V4M8 14h.01M16 14h.01"/>',
    clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
    archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
    branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="7" r="2"/><path d="M6 7v10M18 9c0 5-12 3-12 8"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    pr: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="19" r="2"/><path d="M6 7v10M18 17V9a3 3 0 0 0-3-3h-4M13 4l-2 2 2 2"/>',
    power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'
  };
  function icon(name, size = 18) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.classList.add("icon");
    svg.innerHTML = ICONS[name] ?? "";
    return svg;
  }

  // src/renderer/src/ui/modals/common.ts
  function modal(title, body, footer, onClose, wide = false, head) {
    const heading = h("div", { class: "modal-title" }, title);
    const headChildren = [heading];
    if (head) {
      headChildren.push(head, h("span", { class: "grow" }));
    }
    headChildren.push(h("button", { class: "icon-btn", title: "Fechar (Esc)", "aria-label": "Fechar", onclick: onClose }, icon("x", 18)));
    const box = h(
      "div",
      { class: `modal card${wide ? " modal-wide" : ""}` },
      h("div", { class: "modal-head" }, ...headChildren),
      h("div", { class: "modal-body" }, ...body),
      h("div", { class: "modal-foot" }, ...footer)
    );
    const backdrop = h("div", { class: "backdrop" }, box);
    modalA11y(backdrop, box, heading);
    backdrop.addEventListener("pointerdown", (e) => {
      if (e.target === backdrop) onClose();
    });
    backdrop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") onClose();
      e.stopPropagation();
    });
    return backdrop;
  }
  function cleanError(err) {
    return err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(err);
  }

  // src/renderer/src/ui/study-library.ts
  var UNIT = { pdf: "p\xE1gina", pptx: "slide", md: "se\xE7\xE3o", txt: "linha" };
  function studySourceItem(r, toast2, compact = false) {
    const unit = UNIT[r.kind];
    const sections = r.startHeading ? ` (${r.startHeading}${r.endHeading && r.endHeading !== r.startHeading ? ` \u2192 ${r.endHeading}` : ""})` : "";
    const page = r.kind === "pdf" ? r.start : void 0;
    const open2 = () => void window.office.openStudySource(r.path, page).catch((err) => toast2(cleanError(err), "err"));
    return h(
      "li",
      { class: `study-source study-source-${r.level}` },
      h(
        "div",
        { class: "study-source-line" },
        h("span", {}, "Estude: "),
        h("button", { class: "study-source-title", type: "button", title: page ? `Abrir na p\xE1gina ${page}` : "Abrir", onclick: open2 }, r.title),
        h("span", {}, `, ${r.range}${sections}`),
        h("span", { class: `study-source-level study-source-level-${r.level}`, title: `Pontua\xE7\xE3o local ${r.score}/100` }, r.label)
      ),
      compact ? null : h(
        "div",
        { class: "study-source-range" },
        h("span", {}, `Comece: ${unit} ${r.start}`),
        h("span", {}, `Pare: ${unit} ${r.end}`),
        h("span", { class: "field-hint" }, r.path)
      ),
      compact ? null : h("p", { class: "study-source-snippet" }, r.snippet),
      h(
        "button",
        {
          class: "btn btn-small",
          type: "button",
          onclick: open2
        },
        page ? `Abrir na p. ${page}` : "Abrir"
      )
    );
  }
  var STATUS_LABEL = {
    lida: "Lida",
    ocr: "Precisa de OCR",
    lendo: "Lendo\u2026",
    "so-nome": "S\xF3 pelo nome",
    grande: "Grande demais",
    ilegivel: "Ileg\xEDvel"
  };
  var STATUS_ORDER = ["ilegivel", "ocr", "lendo", "grande", "so-nome", "lida"];
  var fileSize = (bytes) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  function inventoryRow(s) {
    const detail = [s.ext.replace(".", "").toUpperCase() || "sem extens\xE3o", fileSize(s.size)];
    if (s.pages) detail.push(s.blankPages ? `${s.pages} p\xE1ginas, ${s.blankPages} sem texto` : `${s.pages} p\xE1ginas`);
    return h(
      "li",
      { class: `study-inv-row study-inv-${s.status}` },
      h("div", { class: "study-inv-main" }, h("b", {}, s.name), h("span", { class: "field-hint" }, s.path)),
      h("span", { class: "study-inv-detail" }, detail.join(" \xB7 ")),
      h("span", { class: `study-inv-status study-inv-status-${s.status}` }, STATUS_LABEL[s.status])
    );
  }
  function inventoryView(inv, verify, busy) {
    if (inv.missingFolder) return [h("p", { class: "field-hint" }, "A pasta \u201Cstudy sources\u201D ainda n\xE3o existe no vault.")];
    const count = (status) => inv.sources.filter((s) => s.status === status).length;
    const pending = count("ocr") + count("lendo");
    const chips = STATUS_ORDER.filter((status) => count(status)).map(
      (status) => h("span", { class: `study-inv-chip study-inv-status-${status}` }, `${count(status)} \xB7 ${STATUS_LABEL[status]}`)
    );
    const sorted = [...inv.sources].sort(
      (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.path.localeCompare(b.path, "pt-BR")
    );
    return [
      h(
        "div",
        { class: "study-inv-summary" },
        h("b", {}, `${inv.sources.length} fonte${inv.sources.length === 1 ? "" : "s"}`),
        ...chips,
        h("div", { class: "grow" }),
        h(
          "button",
          { class: "btn btn-small btn-primary", type: "button", disabled: busy, onclick: verify },
          busy ? "Verificando\u2026" : pending ? `Verificar e integrar (${pending})` : "Verificar de novo"
        )
      ),
      ...inv.complete ? [] : [h("p", { class: "field-hint" }, "Algumas pastas ou atalhos n\xE3o foram percorridos.")],
      sorted.length ? h("ul", { class: "study-inv-list" }, ...sorted.map(inventoryRow)) : h("p", { class: "field-hint" }, "Nenhum arquivo na pasta.")
    ];
  }
  function studySourceList(result, toast2, compact = false, limit = 12) {
    if (!result.recommendations.length)
      return h(
        "p",
        { class: "field-hint" },
        `Cora n\xE3o encontrou fontes locais para \u201C${result.query}\u201D.${result.warning ? ` ${result.warning}` : ""}`
      );
    return h(
      "div",
      {},
      h("ol", { class: "study-sources-list" }, ...result.recommendations.slice(0, limit).map((r) => studySourceItem(r, toast2, compact))),
      result.warning && !compact ? h("p", { class: "field-hint" }, result.warning) : null
    );
  }
  function librarySection(title, note, list) {
    return h(
      "section",
      { class: "study-library-section", "aria-label": title },
      h("h3", { class: "study-section-title" }, title),
      h("p", { class: "field-hint study-note" }, note),
      list
    );
  }
  function openStudyLibrary(root, toast2, topic = "") {
    let inventory = null;
    let result = null;
    let sources = null;
    let asking = false;
    let checking = false;
    const query = h("input", {
      class: "input",
      maxlength: "200",
      value: topic.replace(/^\s*\[[^\]]+\]\s*/, ""),
      placeholder: "Ex.: fila, estrutura de dados, introdu\xE7\xE3o para iniciante",
      "aria-label": "Pedido para a Cora"
    });
    const button = h("button", { class: "btn btn-primary", type: "submit" });
    const sourcesList = h("div", { class: "study-library-list", role: "status" });
    const hitsList = h("div", { class: "study-library-list", role: "status" });
    const inventoryList = h("div", { class: "study-library-list study-library-inventory", role: "status" });
    const empty = (text) => h("p", { class: "field-hint study-library-empty" }, text);
    const render = () => {
      button.disabled = asking;
      button.textContent = asking ? "Procurando\u2026" : "Pedir \xE0 Cora";
      sourcesList.replaceChildren(
        sources ? studySourceList(sources, toast2) : empty(asking ? "Procurando fontes\u2026" : "Fa\xE7a um pedido para ver as fontes em ordem.")
      );
      if (!result) hitsList.replaceChildren(empty(asking ? "Procurando trechos\u2026" : "Os trechos encontrados aparecem aqui."));
      else {
        const hits = result.hits.map(
          (hit) => h(
            "article",
            { class: "study-cycle-source-hit" },
            h("b", {}, hit.title),
            h("p", {}, hit.excerpt),
            h("span", { class: "field-hint" }, hit.line ? `${hit.sourceRef} \xB7 linha ${hit.line}` : hit.sourceRef)
          )
        );
        hitsList.replaceChildren(
          ...result.warning ? [h("p", { class: "field-hint" }, result.warning)] : [],
          ...hits.length ? hits : [empty("Cora n\xE3o encontrou trechos locais correspondentes.")]
        );
      }
      inventoryList.replaceChildren(...inventory ? inventoryView(inventory, () => void check(true), checking) : [empty("Lendo a pasta\u2026")]);
    };
    const check = async (verify) => {
      if (checking) return;
      checking = true;
      render();
      try {
        inventory = await window.office.studySourceInventory(verify);
        if (verify) toast2(inventory.ocrQueued ? `${inventory.ocrQueued} PDF(s) escaneado(s) no OCR, em segundo plano.` : "Nada pendente de OCR.", "ok");
        announce(`${inventory.sources.length} fontes.`);
      } catch (error) {
        toast2(cleanError(error), "err");
      } finally {
        checking = false;
        render();
      }
    };
    const ask = async () => {
      const q2 = query.value.trim();
      if (!q2 || asking) return;
      asking = true;
      sources = null;
      result = null;
      render();
      const fail = (error) => {
        toast2(cleanError(error), "err");
        return null;
      };
      const [found, hits] = await Promise.all([
        window.office.recommendStudySources([q2]).then((list) => list[0] ?? null, fail),
        window.office.searchStudyLibrary(q2).catch(fail)
      ]);
      sources = found;
      result = hits;
      announce(`${sources?.recommendations.length ?? 0} fontes recomendadas e ${result?.hits.length ?? 0} trechos encontrados.`);
      asking = false;
      render();
    };
    const form = h(
      "form",
      {
        class: "study-cycle-library-search",
        onsubmit: (e) => {
          e.preventDefault();
          void ask();
        }
      },
      query,
      button
    );
    const el = modal(
      "Biblioteca \xB7 Cora",
      [
        h(
          "p",
          { class: "field-hint study-note" },
          "Diga o tema e o que voc\xEA precisa: Cora ordena as fontes de \u201Cstudy sources\u201D (.md, .txt, .pptx e .pdf) com a p\xE1gina de in\xEDcio e de fim e procura trechos nelas. Nada vai ao Claude."
        ),
        form,
        librarySection("Pedir fontes", "Da mais para a menos relevante, com onde come\xE7ar e onde parar.", sourcesList),
        librarySection("Pesquisar trechos", "Passagens dos arquivos locais que falam do pedido. Separe termos com v\xEDrgula.", hitsList),
        librarySection(
          "Fontes dispon\xEDveis",
          "\u201CVerificar e integrar\u201D termina de ler os PDFs novos e manda os escaneados para o OCR, em segundo plano.",
          inventoryList
        )
      ],
      [h("div", { class: "grow" }), h("button", { class: "btn", type: "button", onclick: () => el.remove() }, "Fechar")],
      () => el.remove()
    );
    el.classList.add("study-library-modal");
    el.querySelector(".modal")?.classList.add("study-popup");
    root.append(el);
    render();
    query.focus();
    void check(false);
    if (query.value.trim()) void ask();
  }

  // src/shared/study-bank-stats.ts
  var NO_DISCIPLINE = "Sem disciplina";
  var NO_TOPIC = "Sem t\xF3pico";
  var key = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim().replace(/[.;:]+$/, "");
  var byCount = (name) => (a, b) => b.count - a.count || name(a).localeCompare(name(b), "pt-BR");
  function studyBankStats(questions, trailTopics) {
    const index = /* @__PURE__ */ new Map();
    const add = (k, topic) => {
      if (k && !index.has(k)) index.set(k, topic);
    };
    for (const topic of trailTopics) {
      add(key(topic.label), topic);
      add(key(topic.title), topic);
      if (topic.id) {
        add(key(topic.id), topic);
        add(key(`[${topic.id}]`), topic);
      }
    }
    const find = (raw) => {
      const k = key(raw);
      if (!k) return void 0;
      const direct = index.get(k);
      if (direct) return direct;
      const code = /^\[([^\]]+)\]\s*(.*)$/.exec(k);
      return code ? index.get(code[1].trim()) ?? (code[2] ? index.get(code[2]) : void 0) : void 0;
    };
    const byOrigin = { enem: 0, concurso: 0, livro: 0, web: 0, ia: 0 };
    const byAnswer = { verified: 0, unverified: 0, missing: 0 };
    const groups = /* @__PURE__ */ new Map();
    for (const question of questions) {
      byOrigin[question.originKind]++;
      byAnswer[question.answerStatus]++;
      const match = find(question.topic);
      const discipline = match?.discipline || NO_DISCIPLINE;
      const topic = match ? match.title : question.topic.trim() || NO_TOPIC;
      const topics = groups.get(discipline) ?? /* @__PURE__ */ new Map();
      topics.set(topic, (topics.get(topic) ?? 0) + 1);
      groups.set(discipline, topics);
    }
    const disciplines = [...groups].map(([discipline, topics]) => {
      const list = [...topics].map(([topic, count]) => ({ topic, count })).sort(byCount((t) => t.topic));
      return { discipline, count: list.reduce((sum, t) => sum + t.count, 0), topics: list };
    });
    disciplines.sort(byCount((d) => d.discipline));
    return { total: questions.length, byOrigin, byAnswer, disciplines };
  }

  // src/renderer/src/ui/study-questions.ts
  var ORIGIN_LABEL = { enem: "ENEM", concurso: "Concurso", livro: "Livro", web: "Web", ia: "IA" };
  var ANSWER_LABEL = { verified: "verificado", unverified: "n\xE3o verificado", missing: "sem gabarito" };
  var chip = (label, count, kind = "") => h("span", { class: `study-bank-chip${kind ? ` study-bank-chip-${kind}` : ""}` }, h("b", {}, String(count)), ` ${label}`);
  function bankStatsView(stats) {
    if (!stats.total) return [h("p", { class: "field-hint" }, "O banco ainda n\xE3o tem quest\xF5es salvas.")];
    return [
      h(
        "div",
        { class: "study-bank-total" },
        h("b", {}, String(stats.total)),
        h("span", {}, stats.total === 1 ? "quest\xE3o no banco" : "quest\xF5es no banco")
      ),
      h(
        "div",
        { class: "study-bank-row", role: "group", "aria-label": "Por origem" },
        h("span", { class: "study-bank-cap" }, "Origem"),
        ...Object.keys(ORIGIN_LABEL).map((k) => chip(ORIGIN_LABEL[k], stats.byOrigin[k]))
      ),
      h(
        "div",
        { class: "study-bank-row", role: "group", "aria-label": "Por estado do gabarito" },
        h("span", { class: "study-bank-cap" }, "Gabarito"),
        ...Object.keys(ANSWER_LABEL).map((k) => chip(ANSWER_LABEL[k], stats.byAnswer[k], k))
      ),
      h(
        "div",
        { class: "study-bank-disciplines", role: "group", "aria-label": "Por disciplina" },
        h("span", { class: "study-bank-cap" }, "Por disciplina"),
        ...stats.disciplines.map(
          (d) => h(
            "details",
            { class: "study-bank-discipline" },
            h("summary", {}, h("span", { class: "study-bank-dname" }, d.discipline), h("b", {}, String(d.count))),
            h("ul", {}, ...d.topics.map((t) => h("li", {}, h("span", {}, t.topic), h("b", {}, String(t.count)))))
          )
        )
      )
    ];
  }
  function openStudyQuestions(root, toast2) {
    const topic = h("input", {
      class: "input",
      type: "search",
      maxlength: "200",
      placeholder: "Ex.: Probabilidade condicional",
      "aria-label": "T\xF3pico para buscar quest\xF5es"
    });
    const results = h("div", { class: "study-question-results", "aria-live": "polite" });
    const search = h("button", { class: "btn btn-primary", type: "button" }, "Buscar quest\xF5es");
    const generate = h("button", { class: "btn", type: "button", disabled: true }, "Gerar quest\xF5es com IA");
    const save = h("button", { class: "btn", type: "button", disabled: true }, "Salvar sele\xE7\xE3o no banco");
    const reviewConsent = h("input", {
      type: "checkbox",
      "aria-label": "Confirmo que revisei proced\xEAncia e licen\xE7a e selecionei apenas conte\xFAdo que posso guardar"
    });
    const bankStats = h("div", { class: "study-bank-body", role: "status" }, h("p", { class: "field-hint" }, "Lendo o banco\u2026"));
    const body = h(
      "div",
      { class: "study-questions-body" },
      h(
        "section",
        { class: "study-bank-stats", "aria-label": "Banco em n\xFAmeros" },
        h("h3", { class: "study-section-title" }, "Banco em n\xFAmeros"),
        bankStats
      ),
      h(
        "p",
        { class: "field-hint" },
        "O banco local vem primeiro. WebSearch e IA n\xE3o verificam proced\xEAncia, licen\xE7a ou direitos. Quest\xF5es ficam como candidatas at\xE9 revis\xE3o e salvamento expl\xEDcitos."
      ),
      h("label", { class: "field" }, h("span", { class: "field-label" }, "T\xF3pico"), topic),
      results,
      // The consent goes with what it is about (the candidates), inside the body: in the footer it
      // was squeezed out of the modal, over the scene.
      h(
        "label",
        { class: "study-questions-consent" },
        reviewConsent,
        h(
          "span",
          {},
          "Revisei proced\xEAncia/licen\xE7a e selecionei apenas conte\xFAdo que posso guardar. Para licen\xE7a incerta, escolha somente metadados/URL, sem enunciado."
        )
      )
    );
    let token = "";
    let candidates = [];
    let done = false;
    const close2 = () => {
      if (!done) {
        done = true;
        el.remove();
      }
    };
    const el = modal(
      "Buscar quest\xF5es",
      [body],
      [generate, save, search],
      close2
    );
    el.querySelector(".modal")?.classList.add("study-popup", "study-questions-modal");
    const renderCandidates = (groups) => {
      const checkboxes = [];
      const sections = groups.filter((group) => group.rows.length).map(
        ({ label, rows, selectable }) => h(
          "section",
          {},
          h("h3", {}, label),
          ...rows.map((question) => {
            const check = selectable ? h("input", { type: "checkbox", "aria-label": `Selecionar quest\xE3o ${question.id}` }) : null;
            if (check) {
              checkboxes.push(check);
              check.onchange = () => {
                save.disabled = !reviewConsent.checked || !checkboxes.some((item) => item.checked);
              };
            }
            return h(
              "article",
              { class: "study-question-candidate" },
              h(
                "label",
                {},
                ...check ? [check] : [],
                h("strong", {}, `${question.topic} \xB7 ${question.originKind.toUpperCase()} \xB7 ${question.answerStatus}`)
              ),
              h("p", {}, question.sourceOnly ? "Somente metadados e URL; n\xE3o h\xE1 trecho de quest\xE3o salvo." : question.question),
              h(
                "p",
                { class: "field-hint" },
                `Fonte: ${question.sourceTitle} \xB7 acesso ${question.sourceVisibility} \xB7 ${question.sourceUrl ?? question.sourceReference ?? "sem link"} \xB7 ${question.attribution} \xB7 Licen\xE7a informada (n\xE3o verificada): ${question.license} \xB7 ${question.verifiedByUser ? `revisada por voc\xEA em ${question.verifiedAt}` : "proced\xEAncia/licen\xE7a n\xE3o revisadas"}`
              ),
              ...!question.sourceOnly && question.answer ? [
                h(
                  "details",
                  {},
                  h("summary", {}, "Ver gabarito"),
                  h("p", {}, question.answer),
                  ...question.rationale ? [h("p", {}, question.rationale)] : []
                )
              ] : []
            );
          })
        )
      );
      results.replaceChildren(...sections.length ? sections : [h("p", {}, "Nenhuma quest\xE3o encontrada para esse t\xF3pico.")]);
      save.disabled = checkboxes.length === 0 || !reviewConsent.checked;
      reviewConsent.onchange = () => {
        save.disabled = !reviewConsent.checked || !checkboxes.some((item) => item.checked);
      };
      save.onclick = async () => {
        const selected = checkboxes.flatMap((check, index) => check.checked ? [candidates[index]] : []);
        if (!selected.length || !token) return;
        save.disabled = true;
        try {
          await window.office.saveStudyQuestions(token, selected, reviewConsent.checked);
          done = true;
          el.remove();
          toast2(`${selected.length} quest\xE3o(\xF5es) salvas no banco.`, "ok");
        } catch (error) {
          toast2(cleanError(error), "err");
          save.disabled = false;
        }
      };
    };
    search.onclick = async () => {
      const query = topic.value.trim();
      if (!query) {
        topic.focus();
        return;
      }
      search.disabled = true;
      generate.disabled = true;
      save.disabled = true;
      reviewConsent.checked = false;
      token = "";
      candidates = [];
      results.replaceChildren(h("p", { role: "status" }, "Buscando quest\xF5es\u2026"));
      try {
        const response = await window.office.searchStudyQuestions(query);
        token = response.token;
        candidates = [...response.sourceCandidates, ...response.web];
        generate.disabled = !response.localScanComplete || !response.canGenerate;
        search.textContent = response.status === "error" ? "Tentar novamente" : "Buscar quest\xF5es";
        const statusMessage = h(
          "p",
          { class: "field-hint", role: response.status === "error" ? "alert" : "status" },
          {
            found: "Busca conclu\xEDda; confira as fontes antes de salvar.",
            insufficient: "A busca terminou, mas ainda h\xE1 poucos resultados.",
            noResults: "A busca terminou sem resultados.",
            error: "A busca falhou. Tente novamente; n\xE3o foram geradas quest\xF5es.",
            incomplete: "Busca local incompleta. Refine o t\xF3pico ou escolha uma fonte antes de continuar."
          }[response.status]
        );
        renderCandidates([
          { label: "Banco local \u2014 priorizado por origem (j\xE1 salvo)", rows: response.local, selectable: false },
          {
            label: "Trechos locais encontrados \u2014 revisar fonte/licen\xE7a",
            rows: response.sourceCandidates,
            selectable: response.localScanComplete
          },
          {
            label: "Candidatas da web \u2014 URL/licen\xE7a n\xE3o verificadas; confirme na fonte",
            rows: response.web,
            selectable: response.localScanComplete
          }
        ]);
        results.prepend(statusMessage);
        if (response.warning) results.insertBefore(h("p", { class: "field-hint" }, response.warning), statusMessage.nextSibling);
      } catch (error) {
        search.textContent = "Tentar novamente";
        results.replaceChildren(h("p", { role: "alert" }, cleanError(error)));
      } finally {
        search.disabled = false;
      }
    };
    generate.onclick = async () => {
      if (!token || generate.disabled) return;
      generate.disabled = true;
      save.disabled = true;
      reviewConsent.checked = false;
      results.replaceChildren(h("p", { role: "status" }, "Gerando candidatas marcadas como IA\u2026"));
      try {
        const response = await window.office.generateStudyQuestions(token);
        candidates = [...candidates, ...response.generated];
        generate.disabled = !response.canGenerate;
        generate.textContent = response.status === "error" ? "Tentar gera\xE7\xE3o novamente" : "Gerar quest\xF5es com IA";
        const generationStatus = h(
          "p",
          { role: response.status === "error" ? "alert" : "status" },
          response.warning ?? "Quest\xF5es de IA geradas; gabaritos n\xE3o verificados."
        );
        renderCandidates([
          {
            label: "Trechos locais encontrados \u2014 revisar fonte/licen\xE7a",
            rows: candidates.filter((row) => row.originKind === "enem" || row.originKind === "concurso" || row.originKind === "livro"),
            selectable: true
          },
          {
            label: "Candidatas da web \u2014 URL/licen\xE7a n\xE3o verificadas; confirme na fonte",
            rows: candidates.filter((row) => row.originKind === "web"),
            selectable: true
          },
          { label: "Candidatas geradas por IA \u2014 gabaritos n\xE3o verificados", rows: response.generated, selectable: true }
        ]);
        results.prepend(generationStatus);
      } catch (error) {
        generate.disabled = false;
        generate.textContent = "Tentar gera\xE7\xE3o novamente";
        results.replaceChildren(h("p", { role: "alert" }, cleanError(error)));
      }
    };
    el.querySelector(".modal-foot")?.classList.add("study-modal-foot");
    root.append(el);
    topic.focus();
    const trail = window.office.readStudyTrail().then(
      (t) => t.topics,
      () => []
    );
    void Promise.all([window.office.readStudyQuestions(), trail]).then(([bank, topics]) => bankStats.replaceChildren(...bankStatsView(studyBankStats(bank.questions, topics)))).catch(
      (error) => bankStats.replaceChildren(h("p", { class: "field-hint" }, `N\xE3o foi poss\xEDvel ler o banco: ${cleanError(error)}`))
    );
  }

  // src/renderer/src/ui/study-trail-board.ts
  var chosenList;
  var STAGE = {
    diagnosis: "diagn\xF3stico",
    "review-required": "erros e d\xFAvidas",
    practice: "pr\xE1tica e fontes",
    "retest-ready": "reteste liberado",
    retest: "reteste",
    completed: "conclu\xEDdo"
  };
  async function openStudyTrailBoard(root, toast2, onStart) {
    let trail;
    let state;
    try {
      ;
      [trail, state] = await Promise.all([window.office.readStudyTrail(), window.office.readStudyCycle()]);
    } catch (error) {
      toast2(cleanError(error), "err");
      return;
    }
    root.querySelector("[data-study-trail-board]")?.remove();
    const lists = studyTrailBoard(trail, state);
    if (!lists.some((list) => list.key === chosenList)) chosenList = (lists.find((list) => list.current) ?? lists[0])?.key;
    const nav = h("nav", { class: "tk-lists", "aria-label": "Disciplinas da trilha" }, h("div", { class: "tk-lists-cap" }, "Disciplinas"));
    const panel = h("section", { class: "tk-panel", tabindex: "-1" });
    const focusBack = new FocusReturn();
    const close2 = () => board.remove();
    const start = (card2) => {
      close2();
      onStart(card2.topic.label);
    };
    const card = (item) => {
      const { topic } = item;
      const plan = studyTopicStart(state, topic.label);
      const action = plan.kind === "open" ? "Abrir o ciclo atual" : plan.kind === "resume" ? "Retomar com este t\xF3pico" : "Come\xE7ar com este t\xF3pico";
      const detail = plan.kind === "open" ? "Este \xE9 o ciclo atual: abre onde voc\xEA parou." : plan.kind === "resume" ? "H\xE1 um ciclo guardado deste t\xF3pico: ele volta exatamente onde parou." : plan.setAside ? "O ciclo atual fica guardado (nada se perde) e o diagn\xF3stico deste t\xF3pico come\xE7a com as quest\xF5es do banco." : "Abre o diagn\xF3stico deste t\xF3pico com as quest\xF5es do banco que falam dele.";
      return h(
        "li",
        {
          class: `tcard tk-card trail-card trail-${item.state}`,
          tabindex: "0",
          "data-focus-key": topic.label,
          "aria-label": `${topic.title}. ${STUDY_TRAIL_STATE_LABEL[item.state]}. T\xF3pico ${topic.index} de ${topic.total}.`,
          onkeydown: (event) => {
            if (event.key === "Enter" && event.target === event.currentTarget) {
              event.preventDefault();
              start(item);
            }
          }
        },
        h(
          "div",
          { class: "tk-top" },
          h("span", { class: "tk-pos", title: "Posi\xE7\xE3o na disciplina" }, `#${topic.index}`),
          h("span", { class: `tk-state trail-state-${item.state}` }, STUDY_TRAIL_STATE_LABEL[item.state]),
          item.cycleStage && item.state !== "completed" ? h("span", { class: "tk-sub" }, STAGE[item.cycleStage] ?? item.cycleStage) : null,
          h("span", { class: "grow" })
        ),
        h("div", { class: "tcard-title tk-title" }, topic.title),
        h(
          "div",
          { class: "tk-actions trail-detail" },
          h("div", { class: "tk-sub" }, `${topic.discipline} \xB7 ${topic.period} \xB7 t\xF3pico ${topic.index} de ${topic.total}`),
          h("div", { class: "tk-sub" }, detail),
          h(
            "button",
            {
              class: `btn btn-small${plan.kind === "open" ? "" : " btn-primary"}`,
              type: "button",
              onclick: (event) => {
                event.stopPropagation();
                start(item);
              }
            },
            action
          )
        )
      );
    };
    const paint = () => {
      const list = lists.find((item) => item.key === chosenList);
      panel.replaceChildren(
        ...list ? [
          h(
            "div",
            { class: "tk-panel-head" },
            h("h3", {}, list.discipline),
            h("span", { class: "tk-sub" }, `${list.period} \xB7 ${list.open} em aberto de ${list.cards.length}`)
          ),
          h("ul", { class: "tk-cards", "aria-label": `T\xF3picos de ${list.discipline}` }, ...list.cards.map(card))
        ] : []
      );
      for (const btn of nav.querySelectorAll(".tk-lbtn")) {
        const on = btn.dataset.list === chosenList;
        btn.classList.toggle("on", on);
        btn.setAttribute("aria-current", String(on));
      }
      const cards = [...panel.querySelectorAll(".tk-card")];
      const current = cards.findIndex((el) => el.classList.contains("trail-current"));
      if (cards.length) rove(cards, Math.max(0, current));
      if (current >= 0) cards[current].classList.add("tk-sel");
    };
    const listButton = (list) => h(
      "button",
      { class: "tk-lbtn", type: "button", "data-list": list.key, onclick: () => (chosenList = list.key, paint()) },
      h(
        "span",
        { class: "grow trail-lname", title: `${list.discipline} \xB7 ${list.period}` },
        h("span", { class: "trail-lname-text" }, list.discipline),
        h("span", { class: "tk-sub trail-lperiod" }, list.period)
      ),
      list.current ? h("span", { class: "tk-lbadge today" }, "atual") : null,
      h("span", { class: "tk-lcount", title: "T\xF3picos em aberto" }, String(list.open))
    );
    nav.append(...lists.map(listButton));
    const openTotal = lists.reduce((sum, list) => sum + list.open, 0);
    const board = h(
      "div",
      { class: "board tasks-board study-trail-board study-popup", tabindex: "-1", "data-study-trail-board": "true" },
      h(
        "div",
        { class: "board-head" },
        h("div", { class: "board-title" }, icon("list", 18), "Trilha de estudos"),
        h("span", { class: "board-count" }, `${openTotal} t\xF3pico${openTotal === 1 ? "" : "s"} em aberto`),
        h("span", { class: "grow" }),
        h("button", { class: "icon-btn", type: "button", title: "Fechar (Esc)", onclick: close2 }, icon("x", 16))
      ),
      lists.length ? h("div", { class: "board-body tk-board" }, nav, panel) : h(
        "div",
        { class: "board-body tk-board" },
        h(
          "div",
          { class: "empty-box panelbox" },
          h("b", {}, trail.found ? "A trilha n\xE3o tem t\xF3picos" : "trilha zettel.md n\xE3o encontrada"),
          h("span", {}, "Os t\xF3picos s\xE3o as caixas de sele\xE7\xE3o sob cada disciplina (### \u2026) do arquivo trilha zettel.md do vault.")
        )
      )
    );
    asDialog(board, { label: "Trilha de estudos" });
    const select = (event) => {
      const el = event.target instanceof HTMLElement ? event.target.closest(".tk-card") : null;
      if (!el) return;
      for (const other of board.querySelectorAll(".tk-card.tk-sel")) if (other !== el) other.classList.remove("tk-sel");
      el.classList.add("tk-sel");
    };
    board.addEventListener("focusin", select);
    board.addEventListener("click", select);
    const onKey = (event) => {
      if (!board.isConnected || isTyping() || event.altKey || event.metaKey || event.ctrlKey) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close2();
        return;
      }
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown" && event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const buttons = [...nav.querySelectorAll(".tk-lbtn")];
      const cards = [...panel.querySelectorAll(".tk-card")];
      if (active && nav.contains(active)) {
        if (event.key === "ArrowRight") return void cards[0]?.focus();
        if (event.key === "ArrowLeft") return;
        const at2 = Math.max(0, Math.min(buttons.length - 1, buttons.indexOf(active) + (event.key === "ArrowDown" ? 1 : -1)));
        buttons[at2]?.focus();
        chosenList = buttons[at2]?.dataset.list;
        paint();
        return;
      }
      if (event.key === "ArrowLeft") return void buttons.find((b) => b.dataset.list === chosenList)?.focus();
      if (event.key === "ArrowRight") return;
      const at = cards.indexOf(active?.closest(".tk-card") ?? cards[0]);
      cards[Math.max(0, Math.min(cards.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
    };
    window.addEventListener("keydown", onKey, true);
    const observer2 = new MutationObserver(() => {
      if (board.isConnected) return;
      observer2.disconnect();
      window.removeEventListener("keydown", onKey, true);
      focusBack.restore(board);
    });
    focusBack.save(board);
    root.append(board);
    observer2.observe(root, { childList: true });
    paint();
    (panel.querySelector(".tk-card.tk-sel") ?? nav.querySelector(".tk-lbtn.on") ?? board).focus({
      preventScroll: true
    });
    announce(`Trilha de estudos aberta: ${lists.length} disciplina${lists.length === 1 ? "" : "s"}.`);
  }

  // .preview/study-popups.ts
  var TRAIL = [
    "## 1\xBA per\xEDodo",
    "### [P1-LMD] L\xF3gica e Matem\xE1tica Discreta \u2014 90 h",
    "- [x] [P1-LMD-01] Proposi\xE7\xF5es e conectivos",
    "- [ ] [P1-LMD-02] Tabelas-verdade",
    "- [ ] [P1-LMD-03] Conjuntos e rela\xE7\xF5es",
    "### [P1-ALG] Algoritmos e L\xF3gica de Programa\xE7\xE3o \u2014 90 h",
    "- [x] [P1-ALG-01] Vari\xE1veis e tipos",
    "- [ ] [P1-ALG-02] Estruturas de decis\xE3o",
    "- [ ] [P1-ALG-03] La\xE7os de repeti\xE7\xE3o",
    "## 2\xBA per\xEDodo",
    "### [P2-ED] Estrutura de Dados e T\xE9cnicas de Programa\xE7\xE3o \u2014 45 h",
    "- [x] [P2-ED-01] Listas encadeadas",
    "- [ ] [P2-ED-02] Pilhas",
    "- [ ] [P2-ED-03] Recurs\xE3o",
    "- [ ] [P2-ED-04] \xC1rvores bin\xE1rias",
    "- [ ] [P2-ED-05] Filas",
    "### [P2-BD] Banco de Dados \u2014 60 h",
    "- [ ] [P2-BD-01] Modelo entidade-relacionamento",
    "- [ ] [P2-BD-02] Normaliza\xE7\xE3o",
    "## 3\xBA per\xEDodo",
    "### [P3-ES] Engenharia de Software \u2014 60 h",
    "- [ ] [P3-ES-01] Requisitos",
    "- [ ] [P3-ES-02] Testes de software"
  ].join("\n");
  var n = 0;
  var q = (topic, originKind, answerStatus) => ({
    id: `q-preview-${String(++n).padStart(8, "0")}`,
    topic,
    tags: [],
    question: `Quest\xE3o de exemplo sobre ${topic}: qual alternativa descreve corretamente o conceito?`,
    answer: "Alternativa C",
    answerStatus,
    originKind,
    sourceTitle: originKind === "enem" ? "ENEM 2019" : originKind === "livro" ? "Cormen, Algoritmos" : "Prova FCC 2022",
    sourceVisibility: "public",
    sourceUrl: "https://example.org/questao",
    attribution: "Banca",
    license: "desconhecida"
  });
  var BANK = [
    ...Array.from({ length: 9 }, (_, i) => q("[P2-ED-05] Filas", ["enem", "concurso", "livro"][i % 3], ["verified", "unverified"][i % 2])),
    ...Array.from({ length: 6 }, (_, i) => q("Pilhas", ["livro", "ia"][i % 2], ["verified", "missing", "unverified"][i % 3])),
    ...Array.from({ length: 4 }, () => q("\xE1rvores bin\xE1rias", "web", "unverified")),
    ...Array.from({ length: 5 }, (_, i) => q("Tabelas-verdade", "concurso", i < 3 ? "verified" : "unverified")),
    ...Array.from({ length: 2 }, () => q("P1-LMD-01", "enem", "verified")),
    ...Array.from({ length: 3 }, () => q("Normaliza\xE7\xE3o", "ia", "unverified")),
    ...Array.from({ length: 3 }, () => q("Termodin\xE2mica", "enem", "missing")),
    q("\xD3ptica geom\xE9trica", "livro", "verified")
  ];
  var rec = (title, kind, level, label, start, end) => ({
    path: `study sources/${title}.${kind}`,
    title,
    kind,
    start,
    end,
    range: kind === "pdf" ? `p. ${start}\u2013${end}` : kind === "pptx" ? `slides ${start}\u2013${end}` : `se\xE7\xF5es ${start}\u2013${end}`,
    score: level * 19,
    level,
    label,
    snippet: "Uma fila \xE9 uma estrutura FIFO: o primeiro elemento a entrar \xE9 o primeiro a sair. As opera\xE7\xF5es b\xE1sicas s\xE3o enfileirar e desenfileirar\u2026"
  });
  var wait = (value, ms = 400) => new Promise((resolve) => setTimeout(() => resolve(value), ms));
  window.office = {
    readStudyTrail: () => wait(parseStudyTrail(TRAIL), 100),
    readStudyCycle: () => wait(emptyStudyCycleState(), 50),
    readStudyQuestions: () => wait({ questions: BANK, unknownLines: [] }),
    openStudySource: () => Promise.resolve(),
    studySourceInventory: (verify) => wait({
      complete: true,
      ocrQueued: verify ? 2 : 0,
      sources: [
        { path: "study sources/ED/Filas e pilhas.pdf", name: "Filas e pilhas.pdf", ext: ".pdf", size: 24e5, status: "lida", pages: 48 },
        { path: "study sources/ED/Aula 05 - Filas.pptx", name: "Aula 05 - Filas.pptx", ext: ".pptx", size: 9e5, status: "lida" },
        { path: "study sources/BD/Prova antiga escaneada.pdf", name: "Prova antiga escaneada.pdf", ext: ".pdf", size: 81e5, status: "ocr", pages: 12, blankPages: 12 },
        { path: "study sources/LMD/Resumo.md", name: "Resumo.md", ext: ".md", size: 12e3, status: "lida" },
        { path: "study sources/Livros/Cormen.epub", name: "Cormen.epub", ext: ".epub", size: 15e6, status: "so-nome" },
        { path: "study sources/ES/apostila.pdf", name: "apostila.pdf", ext: ".pdf", size: 6e7, status: "grande" },
        { path: "study sources/velho.doc", name: "velho.doc", ext: ".doc", size: 4e4, status: "ilegivel" }
      ]
    }),
    recommendStudySources: ([query]) => wait([
      {
        query,
        recommendations: [
          rec("Filas e pilhas", "pdf", 5, "Muito relevante", 12, 18),
          rec("Aula 05 - Filas", "pptx", 4, "Relevante", 3, 9),
          rec("Resumo", "md", 3, "Pode ajudar", 2, 4),
          rec("Cormen", "pdf", 2, "Pouco relevante", 230, 241),
          rec("Apostila ED", "pdf", 1, "S\xF3 menciona", 40, 41)
        ]
      }
    ]),
    searchStudyLibrary: (query) => wait({
      token: "t",
      query,
      complete: true,
      hits: [1, 2, 3, 4].map((i) => ({
        id: `h${i}`,
        sourceRef: `study sources/ED/Filas e pilhas.pdf#p${10 + i}`,
        title: `Filas e pilhas \u2014 p\xE1gina ${10 + i}`,
        excerpt: "Em uma fila circular, os \xEDndices de in\xEDcio e fim voltam ao zero quando chegam ao fim do vetor, reaproveitando as posi\xE7\xF5es livres.",
        line: 0,
        score: 80 - i
      }))
    }),
    searchStudyQuestions: (query) => wait({
      token: "tok",
      status: "found",
      localScanComplete: true,
      canGenerate: true,
      local: BANK.slice(0, 2),
      sourceCandidates: [q(query, "livro", "unverified")],
      web: [q(query, "web", "unverified")]
    }),
    generateStudyQuestions: () => wait({ status: "found", canGenerate: false, generated: [q("Filas", "ia", "unverified")] }),
    saveStudyQuestions: () => wait(void 0)
  };
  var ui = document.getElementById("ui");
  var toast = (text) => {
    const el = document.getElementById("toast");
    el.textContent = text;
    el.hidden = false;
    setTimeout(() => el.hidden = true, 2500);
  };
  var close = () => ui.replaceChildren();
  var open = {
    questions: () => openStudyQuestions(ui, toast),
    library: () => openStudyLibrary(ui, toast, "[P2-ED-05] Filas"),
    libraryEmpty: () => openStudyLibrary(ui, toast),
    trail: () => void openStudyTrailBoard(ui, toast, (topic) => toast(`Come\xE7ar: ${topic}`))
  };
  for (const button of document.querySelectorAll("[data-open]"))
    button.onclick = () => {
      close();
      open[button.dataset.open]();
    };
  open[location.hash.slice(1) || "questions"]?.();
})();
