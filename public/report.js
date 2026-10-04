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
    const active = tabsEl.querySelector('[aria-current="page"]');
    if (active) active.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  const workTabs = () => (window.BSWork ? window.BSWork.tabs : []);

  function show(slug) {
    const workTab = workTabs().find((t) => t.slug === slug);
    if (workTab) {
      setActive(workTab.slug);
      try { window.BSWork.render(workTab.slug, reportEl); }
      catch (e) { console.error(e); reportEl.replaceChildren(el("p", { class: "report-state" }, "This view couldn't be drawn. Refresh the page to try again.")); }
      document.title = `${workTab.name} | Blue Sky Investment Group`;
      return;
    }
    const replaced = workTabs().find((t) => t.replaces === slug);
    if (replaced) { location.replace(`#${replaced.slug}`); return; }
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

  const loadWork = window.BSWork ? Promise.resolve() : new Promise((res) => {
    const sc = document.createElement("script");
    sc.src = "/workspace.js";
    sc.onload = res; sc.onerror = res;
    document.head.append(sc);
  });

  Promise.all([getJson("/api/analytics").catch(() => null), getJson("/api/report").catch(() => null), loadWork])
    .then(([a, r]) => {
      analytics = a;
      data = r;
      if (!analytics && !data && !workTabs().length) throw new Error("load failed");
      const ul = el("ul");
      const hidden = new Set(workTabs().map((t) => t.replaces).filter(Boolean));
      if (analytics && window.BSDash) {
        window.BSDash.tabs.forEach((t) => {
          const li = el("li");
          li.append(el("a", { href: `#${t.slug}`, "data-slug": t.slug }, t.name));
          ul.append(li);
        });
      }
      if (workTabs().length) {
        workTabs().forEach((t) => {
          const li = el("li");
          li.append(el("a", { href: `#${t.slug}`, "data-slug": t.slug }, t.name));
          ul.append(li);
        });
      }
      if (data) {
        ul.append(el("li", { class: "tab-sep", "aria-hidden": "true" }));
        data.sheets.filter((s) => !hidden.has(s.slug)).forEach((s) => {
          const li = el("li");
          li.append(el("a", { href: `#${s.slug}`, "data-slug": s.slug }, s.name));
          ul.append(li);
        });
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
