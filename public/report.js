// Renders the 5100 Main report: one header tab per workbook tab.
(function () {
  const tabsEl = document.getElementById("tabs");
  const reportEl = document.getElementById("report");
  let data = null;

  const el = (tag, attrs = {}, text) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    return n;
  };

  function classify(row, index, sheet) {
    if (!row.length) return "gap";
    if (row.length === 1) {
      const c = row[0];
      if (c.k === "sec") return "sec";
      if (c.k === "warn") return "warn";
      if (index === 0 && sheet.titleUsed !== true) return "title";
      if (!c.n && (c.t.length > 70 || c.t.includes("\n") || (!c.b && sheet.cols > 1))) return "para";
    }
    return "cells";
  }

  function renderSheet(sheet) {
    const wrap = el("article", { class: "sheet", "aria-labelledby": "sheet-title" });
    const rows = sheet.rows.slice();

    // Title + lede come from the sheet's first rows
    let title = sheet.name;
    if (rows.length && rows[0].length === 1 && !rows[0][0].k && !rows[0][0].n) {
      title = rows.shift()[0].t;
      if (rows.length && rows[0].length === 1 && !rows[0][0].b && !rows[0][0].k) {
        const h = el("h2", { id: "sheet-title" }, title);
        wrap.append(h, el("p", { class: "lede" }, rows.shift()[0].t));
        title = null;
      }
    }
    if (title) wrap.append(el("h2", { id: "sheet-title" }, title));

    const widths = sheet.widths.map((w) => Math.min(w, 48)); // wide prose columns wrap instead of scrolling
    const total = widths.reduce((a, b) => a + b, 0);
    const table = el("table", { class: "grid", style: `min-width:${Math.round(total * 7.5)}px` });
    const colgroup = el("colgroup");
    widths.forEach((w) => colgroup.append(el("col", { style: `width:${((w / total) * 100).toFixed(2)}%` })));
    table.append(colgroup);
    const tbody = el("tbody");

    // drop leading blank rows after title/lede
    while (rows.length && !rows[0].length) rows.shift();

    rows.forEach((row, i) => {
      const type = classify(row, i + 2, { ...sheet, titleUsed: true });
      const tr = el("tr", { class: type === "cells" ? null : type });
      if (type === "gap") {
        tr.append(el("td", { colspan: sheet.cols }));
      } else if (type === "sec" || type === "warn" || type === "para") {
        const c = row[0];
        const td = el("td", { colspan: sheet.cols - c.c, class: c.b ? "b" : null }, c.t);
        if (c.c > 0) tr.append(el("td", { colspan: c.c }));
        tr.append(td);
      } else {
        // If the row's last cell is long text, let it span to the end so notes stay readable
        let col = 0;
        row.forEach((c, j) => {
          if (c.c > col) { tr.append(el("td", { colspan: c.c - col })); col = c.c; }
          const isLast = j === row.length - 1;
          const span = isLast && !c.n ? sheet.cols - c.c : 1;
          const cls = [c.n ? "num" : "", c.neg ? "neg" : "", c.b ? "b" : "", c.k || ""].filter(Boolean).join(" ") || null;
          tr.append(el("td", { class: cls, colspan: span > 1 ? span : null }, c.t));
          col = c.c + span;
        });
        if (col < sheet.cols) tr.append(el("td", { colspan: sheet.cols - col }));
      }
      tbody.append(tr);
    });

    table.append(tbody);
    const scroll = el("div", { class: "sheet-scroll", tabindex: "0", role: "region", "aria-label": `${sheet.name} table` });
    scroll.append(table);
    wrap.append(scroll);
    return wrap;
  }

  let analytics = null;

  function setActive(slug) {
    tabsEl.querySelectorAll("a").forEach((a) => {
      if (a.dataset.slug === slug) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    let active = tabsEl.querySelector('[aria-current="page"]');
    const otherBtn = tabsEl.querySelector(".tab-more");
    if (otherBtn) {
      const inOther = otherItems.some((o) => o.slug === slug);
      otherBtn.classList.toggle("on", inOther);
      const item = otherItems.find((o) => o.slug === slug);
      otherBtn.querySelector(".tab-more-sel").textContent = item ? `: ${item.name}` : "";
      if (inOther) active = otherBtn;
    }
    if (active) active.scrollIntoView({ block: "nearest", inline: "nearest" });
    closeMenu();
  }

  /* ---------- "Other" dropdown (workbook tabs and workspace lists) ---------- */
  // Order as requested; workbook sheets are matched by name so a renamed slug still lands here.
  const OTHER = [
    { match: (n) => n === "Statement Log" },
    { match: (n) => n === "Assumptions" },
    { match: (n) => /^Forecast/i.test(n), label: "Forecast Model" },
    { match: (n) => n === "Loan & Closing" },
    { match: (n) => n === "Schwab Tracker" },
    { match: (n) => /^Matt/i.test(n) },
    { match: (n) => /^Real #/i.test(n) },
    { work: "discussion" },
    { work: "watch" },
  ];
  let otherItems = [];
  let menu = null, menuY = 0;
  function closeMenu() {
    if (!menu) return;
    menu.remove(); menu = null;
    const b = tabsEl.querySelector(".tab-more");
    if (b) b.setAttribute("aria-expanded", "false");
  }
  function openMenu(btn) {
    closeMenu();
    menu = el("ul", { class: "tab-menu", role: "menu", id: "other-menu" });
    const current = decodeURIComponent(location.hash.replace(/^#/, ""));
    otherItems.forEach((o) => {
      const li = el("li", { role: "none" });
      const a = el("a", { href: `#${o.slug}`, role: "menuitem", "data-slug": o.slug }, o.name);
      if (o.slug === current) a.setAttribute("aria-current", "page");
      a.addEventListener("click", () => closeMenu());
      li.append(a); menu.append(li);
    });
    const r = btn.getBoundingClientRect();
    menu.style.top = `${Math.round(r.bottom)}px`;
    menu.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - 248)))}px`;
    document.body.append(menu);
    menuY = window.scrollY;
    btn.setAttribute("aria-expanded", "true");
    const first = menu.querySelector("a");
    if (first) first.focus();
    menu.addEventListener("keydown", (e) => {
      const links = [...menu.querySelectorAll("a")], i = links.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); links[(i + 1) % links.length].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); links[(i - 1 + links.length) % links.length].focus(); }
      else if (e.key === "Escape") { e.preventDefault(); closeMenu(); btn.focus(); }
      else if (e.key === "Tab") closeMenu();
    });
  }
  document.addEventListener("click", (e) => { if (menu && !menu.contains(e.target) && !e.target.closest(".tab-more")) closeMenu(); });
  window.addEventListener("resize", closeMenu);
  window.addEventListener("scroll", () => { if (menu && Math.abs(window.scrollY - menuY) > 24) closeMenu(); }, { passive: true });

  const aiTabs = () => (window.BSAI ? window.BSAI.tabs.map((t) => ({ ...t, render: (r) => window.BSAI.render(t.slug, r) })) : []);
  const propTabs = () => (window.BSProps ? window.BSProps.tabs.map((t) => ({ ...t, render: (r) => window.BSProps.render(t.slug, r) })) : []);
  const wealthTabs = () => (window.BSWealth ? window.BSWealth.tabs.map((t) => ({ ...t, render: (r) => window.BSWealth.render(t.slug, r) })) : []);
  const splitTabs = () => (window.BSSplit ? window.BSSplit.tabs.map((t) => ({ ...t, render: (r) => window.BSSplit.render(t.slug, r) })) : []);
  const inputTabs = () => (window.BSInputs ? window.BSInputs.tabs.map((t) => ({ ...t, render: (r) => window.BSInputs.render(t.slug, r) })) : []);
  const workTabs = () => wealthTabs().concat(splitTabs()).concat(aiTabs()).concat(propTabs()).concat(window.BSWork ? window.BSWork.tabs.map((t) => ({ ...t, render: (r) => window.BSWork.render(t.slug, r) })) : []).concat(inputTabs());

  function show(slug) {
    if (!slug && window.BSWealth) slug = "overview"; // the Overview is the landing page
    const workTab = workTabs().find((t) => t.slug === slug);
    if (workTab) {
      setActive(workTab.slug);
      try { workTab.render(reportEl); }
      catch (e) { console.error(e); reportEl.replaceChildren(el("p", { class: "report-state" }, "This view couldn't be drawn. Refresh the page to try again.")); }
      document.title = `${workTab.name} | Blue Sky Investment Group`;
      return;
    }
    const replaced = workTabs().find((t) => t.replaces === slug);
    if (replaced) { location.replace(`#${replaced.slug}`); return; }
    const alias = window.BSDash && window.BSDash.aliases && window.BSDash.aliases[slug];
    if (alias) { location.replace(`#${alias}`); if (slug === "tax") setTimeout(() => { const t = document.getElementById("tax"); if (t) t.scrollIntoView(); }, 300); return; }
    const dashTab = analytics && window.BSDash && window.BSDash.tabs.find((t) => t.slug === slug);
    if (dashTab || (!slug && analytics && window.BSDash)) {
      const t = dashTab || window.BSDash.tabs[0];
      setActive(t.slug);
      try { window.BSDash.render(t.slug, reportEl, analytics); }
      catch (e) { console.error(e); reportEl.replaceChildren(el("p", { class: "report-state" }, "This view couldn't be drawn. Refresh the page to try again.")); }
      document.title = `${t.name} | Blue Sky Investment Group`;
      return;
    }
    if (!data) return;
    const sheet = data.sheets.find((s) => s.slug === slug) || data.sheets[0];
    setActive(sheet.slug);
    reportEl.replaceChildren(renderSheet(sheet));
    const meta = el("p", { class: "sheet-meta" }, `From ${data.source}`);
    reportEl.firstChild.append(meta);
    document.title = `${sheet.name} | Blue Sky Investment Group`;
  }

  function route() {
    show(decodeURIComponent(location.hash.replace(/^#/, "")));
  }

  const getJson = (url) => fetch(url, { credentials: "same-origin" }).then((r) => {
    if (r.status === 401) { location.replace("/"); throw new Error("signed out"); }
    return r.ok ? r.json() : null;
  });

  const loadScript = (src, ready) => (ready ? Promise.resolve() : new Promise((res) => {
    const sc = document.createElement("script");
    sc.src = src;
    sc.onload = res; sc.onerror = res;
    document.head.append(sc);
  }));
  const loadWork = Promise.all([loadScript("/props.js", window.BSProps), loadScript("/workspace.js", window.BSWork), loadScript("/ai.js", window.BSAI), loadScript("/wealth.js", window.BSWealth), loadScript("/split.js", window.BSSplit), loadScript("/inputs.js", window.BSInputs)]);

  // The AI Assistant saved something: reload the data behind the affected tabs.
  window.addEventListener("bs:data-changed", (e) => {
    const what = e.detail || [];
    if (what.includes("portfolio")) getJson("/api/analytics").then((a) => { if (a) { analytics = a; window.BSAnalytics = a; } }).catch(() => {});
    if (what.includes("properties") && window.BSProps) window.BSProps.load(true).catch(() => {});
    if (what.includes("inputs") && window.BSInputs) window.BSInputs.load(true).catch(() => {});
  });

  Promise.all([getJson("/api/analytics").catch(() => null), getJson("/api/report").catch(() => null), loadWork])
    .then(([a, r]) => {
      analytics = a;
      window.BSAnalytics = a;
      data = r;
      if (!analytics && !data && !workTabs().length) throw new Error("load failed");
      const ul = el("ul");
      const hidden = new Set(workTabs().map((t) => t.replaces).filter(Boolean));
      const addTab = (slug, name) => { const li = el("li"); li.append(el("a", { href: `#${slug}`, "data-slug": slug }, name)); ul.append(li); };
      const sheets = data ? data.sheets.filter((s) => !hidden.has(s.slug)) : [];
      const works = workTabs();
      otherItems = [];
      const inOther = new Set();
      OTHER.forEach((o) => {
        if (o.work) { const t = works.find((x) => x.slug === o.work); if (t) { otherItems.push({ slug: t.slug, name: t.name }); inOther.add(t.slug); } return; }
        const sh = sheets.find((x) => o.match(x.name));
        if (sh) { otherItems.push({ slug: sh.slug, name: o.label || sh.name }); inOther.add(sh.slug); }
      });
      const W = (slug) => works.find((t) => t.slug === slug);
      if (W("overview")) addTab("overview", W("overview").name);
      if (analytics && window.BSDash) window.BSDash.tabs.forEach((t) => addTab(t.slug, t.name));
      if (W("cashflow")) addTab("cashflow", W("cashflow").name);
      works.filter((t) => !inOther.has(t.slug) && t.slug !== "overview" && t.slug !== "cashflow").forEach((t) => addTab(t.slug, t.name));
      if (otherItems.length) {
        const li = el("li", { class: "tab-more-li" });
        const btn = el("button", { type: "button", class: "tab-more", "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": "other-menu" });
        btn.append(document.createTextNode("Other"), el("span", { class: "tab-more-sel" }), el("span", { class: "tab-caret", "aria-hidden": "true" }, "▾"));
        btn.addEventListener("click", () => (menu ? closeMenu() : openMenu(btn)));
        btn.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { e.preventDefault(); openMenu(btn); } });
        li.append(btn); ul.append(li);
      }
      const restSheets = sheets.filter((s) => !inOther.has(s.slug));
      if (restSheets.length) {
        ul.append(el("li", { class: "tab-sep", "aria-hidden": "true" }));
        restSheets.forEach((s) => addTab(s.slug, s.name));
      }
      tabsEl.replaceChildren(ul);
      window.addEventListener("hashchange", () => { route(); window.scrollTo({ top: 0 }); });
      route();
    })
    .catch((err) => {
      if (err.message === "signed out") return;
      reportEl.replaceChildren(el("p", { class: "report-state" }, "The report couldn't be loaded. Refresh the page to try again."));
    });
})();
