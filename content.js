// content.js
// Injects the collapsible "Fantasy Game Finder" dialog in the bottom-left
// corner, AUTO-detects the sport and AUTO-scrapes the roster from the current
// fantasy page, and matches roster players against today's games for the
// selected sport (NBA / NFL / NHL).
//
// Requires teams.js (loaded first): globalThis.fghNormalizeTeam,
// fghFindTeamInText, FGH_SPORTS.

(function () {
  if (window.__fghLoaded) return;
  window.__fghLoaded = true;

  const SPORTS = {
    nba: { label: "NBA", emoji: "🏀" },
    nfl: { label: "NFL", emoji: "🏈" },
    nhl: { label: "NHL", emoji: "🏒" },
    ncaaf: { label: "NCAAF", emoji: "🎓" }
  };

  // Which league tabs to show. NCAAF is a Fantrax-only sport, so it only
  // appears when we're on a Fantrax page.
  function availableSports() {
    return detectPlatform() === "fantrax" ? ["nba", "nfl", "nhl", "ncaaf"] : ["nba", "nfl", "nhl"];
  }
  const rosterKey = (sport) => `fgh_roster_${sport}`; // [{ name, team }]
  const UI_KEY = "fgh_ui"; // { collapsed, sport, auto }
  const LEGACY_KEY = "fgh_roster"; // pre-multisport (NBA only)
  const MIN_AUTO = 3; // min players before auto-scan is allowed to overwrite

  // ---------------------------------------------------------------------------
  // Storage helpers
  // ---------------------------------------------------------------------------
  const store = {
    get(keys) {
      return new Promise((r) => chrome.storage.local.get(keys, r));
    },
    set(obj) {
      return new Promise((r) => chrome.storage.local.set(obj, r));
    }
  };

  // ---------------------------------------------------------------------------
  // Platform + sport detection
  // ---------------------------------------------------------------------------
  function detectPlatform() {
    const h = location.hostname;
    if (h.includes("fantasy.espn.com")) return "espn";
    if (h.includes("fantrax.com")) return "fantrax";
    if (h.includes("yahoo.com")) return "yahoo";
    return "unknown";
  }

  // Sport from the page. Returns a supported sport key or null.
  function detectSportFromUrl() {
    // Fantrax tags the active sport on <fx-nav class="nav <sport>"> (e.g.
    // "nav nhl" / "nav ncaaf"). This is exact, so prefer it.
    const nav = document.querySelector("fx-nav");
    if (nav) {
      for (const c of nav.classList) {
        if (SPORTS[c]) return c;
      }
    }
    const h = location.hostname.toLowerCase();
    // Yahoo uses per-sport subdomains (basketball./football./hockey.)
    if (h.startsWith("basketball.")) return "nba";
    if (h.startsWith("football.")) return "nfl";
    if (h.startsWith("hockey.")) return "nhl";
    const p = (location.pathname + " " + location.search + " " + document.title).toLowerCase();
    // Fantrax ?sport=NBA style
    const m = location.search.match(/sport=([a-z]+)/i);
    if (m) {
      const s = m[1].toLowerCase();
      if (s.includes("nba") || s.includes("basket")) return "nba";
      if (s.includes("nfl") || s.includes("foot")) return "nfl";
      if (s.includes("nhl") || s.includes("hock")) return "nhl";
    }
    if (/\b(nba|basketball)\b/.test(p)) return "nba";
    if (/\b(nfl|football)\b/.test(p)) return "nfl";
    if (/\b(nhl|hockey)\b/.test(p)) return "nhl";
    return null;
  }

  // ---------------------------------------------------------------------------
  // Roster scraping (best effort) -- gather candidate rows ONCE, then test
  // them against each sport's team map.
  // ---------------------------------------------------------------------------
  // "First Last" (two+ capitalized words), allowing accents, apostrophes, dots.
  const NAME_RE = /[A-ZÀ-Þ][A-Za-zÀ-ÿ'.-]+(?:\s+[A-ZÀ-Þ][A-Za-zÀ-ÿ'.-]+)+/;
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "PATH", "OPTION", "HEAD", "TEMPLATE"]);

  // From a leaf "team cell", climb a few ancestors to find the player name in
  // the same row/card (the name usually sits in a sibling cell).
  function climbName(el) {
    let node = el;
    for (let d = 0; d < 6 && node; d++) {
      const c = node.parentElement;
      if (!c) break;
      const a = c.querySelector("a, [class*='name' i]");
      let nm = a ? (a.textContent || "").trim() : "";
      if (!NAME_RE.test(nm)) {
        const m = (c.textContent || "").match(NAME_RE);
        nm = m ? m[0] : "";
      }
      if (nm) return nm.replace(/\s+/g, " ").trim();
      node = c;
    }
    return "";
  }

  // Generic leaf scan: short leaf "cells" whose text names a team. Used only as
  // a fallback for unknown layouts -- it can pick up opponent columns or team
  // names in hidden tooltips, so structured extraction is preferred when known.
  function collectLeaves() {
    const leaves = [];
    const body = document.body;
    if (!body) return leaves;
    let all;
    try {
      all = body.querySelectorAll(":not(:has(*))"); // leaf elements
    } catch (_) {
      all = body.querySelectorAll("*"); // :has() unsupported -> coarse fallback
    }
    for (const el of all) {
      if (SKIP_TAGS.has(el.tagName)) continue;
      if (el.children && el.children.length) continue;
      const text = (el.textContent || "").trim();
      if (text.length < 2 || text.length > 18) continue; // team cells are short
      leaves.push({ text, el });
      if (leaves.length > 6000) break;
    }
    return leaves;
  }

  // Candidate collection. Uses precise, per-platform selectors where the layout
  // is known (so we read the player's OWN team, not the opponent column or a
  // tooltip), and falls back to the generic leaf scan only when that comes up
  // short -- e.g. an unknown layout.
  function getCandidates() {
    const platform = detectPlatform();
    const rows = [];
    const pushRow = (text, name) => rows.push({ text: (text || "").trim(), name: (name || "").trim() });

    if (platform === "fantrax") {
      // Each player is a <scorer>; name in .scorer__info__name, team in
      // .scorer__info__positions (which excludes the separate Opp column).
      document.querySelectorAll("scorer").forEach((s) => {
        const nameEl = s.querySelector(".scorer__info__name, a");
        const posEl = s.querySelector(".scorer__info__positions");
        pushRow(posEl ? posEl.textContent : s.textContent, nameEl ? nameEl.textContent : "");
      });
    } else if (platform === "espn") {
      document.querySelectorAll("tr.Table__TR, tr").forEach((row) => {
        const a = row.querySelector(".player-column__athlete a, a[href*='/player/'], a");
        pushRow(row.innerText || row.textContent, a ? a.textContent : "");
      });
    } else if (platform === "yahoo") {
      document.querySelectorAll("tr").forEach((row) => {
        const a = row.querySelector(".ysf-player-name a, a[href*='/players/'], a");
        pushRow(row.innerText || row.textContent, a ? a.textContent : "");
      });
    } else {
      document.querySelectorAll("tr, [role='row']").forEach((row) => {
        const a = row.querySelector("a");
        pushRow(row.innerText || row.textContent, a ? a.textContent : "");
      });
    }

    // Only fall back to the (noisier) generic leaf scan if we found too little.
    const leaves = rows.length < 3 ? collectLeaves() : [];
    return { rows, leaves };
  }

  // For sports without a hardcoded map (NCAAF), pull the team out of a
  // "POS - TEAM" style cell: take the text after the last dash, else the last
  // token. The value (abbr or name) is matched against the scoreboard later.
  function extractTeamString(text) {
    if (!text) return "";
    const m = text.match(/[-–—]\s*([A-Za-z.&'’ ]{2,40})\s*$/);
    if (m) return m[1].trim();
    const toks = text.trim().split(/\s+/);
    return toks.length ? toks[toks.length - 1] : "";
  }

  function buildRosterForSport(sport, cands) {
    const mapped = globalThis.fghHasMap(sport);
    const byName = new Map();
    const add = (name, team) => {
      name = (name || "").replace(/\s+/g, " ").trim();
      if (!name || !team) return;
      const k = name.toLowerCase();
      if (!byName.has(k)) byName.set(k, { name, team });
    };

    for (const r of cands.rows) {
      const team = mapped ? globalThis.fghFindTeamInText(sport, r.text) : extractTeamString(r.text);
      if (!team) continue;
      let name = r.name;
      if (!NAME_RE.test(name)) {
        const m = r.text.match(NAME_RE);
        name = m ? m[0] : r.text.split("\n")[0].slice(0, 40);
      }
      add(name, team);
    }

    // Leaf fallback only helps mapped sports (it keys off the team map).
    if (mapped) {
      for (const lf of cands.leaves) {
        const team =
          globalThis.fghNormalizeTeam(sport, lf.text) ||
          globalThis.fghFindTeamInText(sport, lf.text);
        if (!team) continue;
        add(climbName(lf.el), team);
      }
    }

    return Array.from(byName.values());
  }

  // Content-based sport detection: whichever MAPPED sport matches the most
  // players. NCAAF is excluded here (it has no map, so it would match every
  // row); on Fantrax the sport is read exactly from <fx-nav> instead.
  function detectBest(cands) {
    let best = { sport: null, roster: [] };
    for (const s of globalThis.FGH_DETECT_SPORTS) {
      const r = buildRosterForSport(s, cands);
      if (r.length > best.roster.length) best = { sport: s, roster: r };
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Matching
  // ---------------------------------------------------------------------------
  const normKey = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  // For map-less sports (NCAAF): does a scraped team string refer to this side
  // of the game? Compare against the scoreboard's abbr / location / short /
  // full name (exact, plus containment for longer name strings).
  function teamMatchesSide(teamStr, side) {
    const t = normKey(teamStr);
    if (!t) return false;
    if (t === normKey(side.abbr)) return true;
    if (t === normKey(side.loc)) return true;
    if (t === normKey(side.short)) return true;
    if (t === normKey(side.name)) return true;
    if (t.length >= 4) {
      const d = normKey(side.name);
      const l = normKey(side.loc);
      if ((d && d.includes(t)) || (l && l.includes(t))) return true;
    }
    return false;
  }

  function matchGames(sport, games, roster) {
    if (!globalThis.fghHasMap(sport)) {
      return games.map((g) => {
        const players = roster
          .filter((p) => teamMatchesSide(p.team, g.home) || teamMatchesSide(p.team, g.away))
          .map((p) => p.name);
        return { ...g, players, count: players.length };
      });
    }

    const byTeam = new Map();
    for (const p of roster) {
      if (!p.team) continue;
      if (!byTeam.has(p.team)) byTeam.set(p.team, []);
      byTeam.get(p.team).push(p.name);
    }
    return games.map((g) => {
      const homeCode =
        globalThis.fghNormalizeTeam(sport, g.home.abbr) ||
        globalThis.fghNormalizeTeam(sport, g.home.name);
      const awayCode =
        globalThis.fghNormalizeTeam(sport, g.away.abbr) ||
        globalThis.fghNormalizeTeam(sport, g.away.name);
      const players = []
        .concat(byTeam.get(homeCode) || [])
        .concat(byTeam.get(awayCode) || []);
      return { ...g, homeCode, awayCode, players, count: players.length };
    });
  }

  function sameRoster(a, b) {
    if (a.length !== b.length) return false;
    const key = (r) => r.map((p) => p.name.toLowerCase() + "|" + p.team).sort().join(",");
    return key(a) === key(b);
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------
  const CSS = `
    :host { all: initial; }
    .wrap {
      position: fixed; left: 16px; bottom: 16px; z-index: 2147483647;
      width: 320px; max-width: calc(100vw - 32px);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      color: #e9edf1; background: #12161c;
      border: 1px solid #2a3340; border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,.45);
      overflow: hidden;
    }
    .hdr {
      display: flex; align-items: center; gap: 6px;
      padding: 10px 12px; cursor: pointer; user-select: none;
      background: linear-gradient(180deg,#1b2129,#12161c);
      border-bottom: 1px solid #2a3340;
    }
    .hdr .title { font-size: 13px; font-weight: 700; flex: 1; letter-spacing: .2px; }
    .hdr .chip { font-size: 11px; background:#233; color:#9fe8c7; padding:2px 7px; border-radius:999px; }
    .iconbtn {
      background: transparent; border: 0; color: #9fb0c3; cursor: pointer;
      font-size: 14px; line-height: 1; padding: 4px 5px; border-radius: 6px;
    }
    .iconbtn:hover { background: #222c38; color: #fff; }
    .iconbtn.on { color:#ffd34d; background:#2a2410; }
    .tabs { display:flex; gap:4px; padding:8px; border-bottom:1px solid #2a3340; }
    .tab {
      flex:1; font-size:12px; font-weight:700; cursor:pointer; text-align:center;
      background:#161b22; color:#9fb0c3; border:1px solid #2a3340; border-radius:8px; padding:6px 0;
    }
    .tab:hover { background:#1d2430; }
    .tab.active { background:#2f7d5b; border-color:#2f7d5b; color:#eafff4; }
    .body { max-height: 56vh; overflow: auto; }
    .collapsed .body, .collapsed .tabs { display: none; }
    .games { list-style: none; margin: 0; padding: 6px; display: flex; flex-direction: column; gap: 6px; }
    .game {
      border: 1px solid #222c38; border-radius: 9px; padding: 8px 10px;
      background: #161b22; position: relative;
    }
    .game .match { font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
    .game .meta { font-size: 11px; color: #8696a7; margin-top: 2px; }
    .game .names { font-size: 11px; color: #c7d3df; margin-top: 6px; line-height: 1.45; }
    .badge {
      margin-left: auto; font-size: 12px; font-weight: 800; min-width: 20px; text-align: center;
      padding: 1px 8px; border-radius: 999px; background: #2a3340; color: #9fb0c3;
    }
    .live { color:#ff6b6b; font-weight:700; }
    .game.hit { border-color: #2f7d5b; background: #15241d; }
    .game.hit .badge { background: #2f7d5b; color: #eafff4; }
    .game.hot { border-color: #e0a106; background: #241f12; }
    .game.hot .badge { background: #e0a106; color: #1b1405; }
    .empty { padding: 16px; font-size: 12px; color: #8696a7; text-align: center; }
    .footer { display:flex; gap:6px; padding: 8px; border-top: 1px solid #2a3340; background:#12161c; }
    .btn {
      flex:1; font-size: 12px; font-weight:600; cursor:pointer;
      background:#223; color:#cfe0ff; border:1px solid #33465f; border-radius:8px; padding:7px 8px;
    }
    .btn:hover { background:#2a3550; }
    .btn.primary { background:#2f7d5b; border-color:#2f7d5b; color:#eafff4; }
    .btn.primary:hover { filter:brightness(1.08); }
    .status { padding: 8px 10px 4px; font-size: 11px; color: #8696a7; }
    .editor { padding: 8px; display:none; }
    .editor.open { display:block; }
    .editor textarea {
      width: 100%; box-sizing: border-box; height: 120px; resize: vertical;
      background:#0d1116; color:#e9edf1; border:1px solid #2a3340; border-radius:8px;
      font: 12px/1.4 ui-monospace, Menlo, Consolas, monospace; padding:8px;
    }
    .editor .hint { font-size: 11px; color:#8696a7; margin: 4px 2px 8px; }
  `;

  let host, root;
  const state = {
    collapsed: true, // start minimized; expands on click (persisted once toggled)
    sport: "nba",
    auto: true,
    rawGames: {}, // sport -> raw games
    games: [], // matched games for current sport
    rosters: {}, // sport -> [{name, team}]
    locked: {}, // sport -> true (user hand-edited; don't auto-overwrite until nav)
    editing: false,
    status: ""
  };

  const roster = () => state.rosters[state.sport] || [];
  const uiObj = () => ({ collapsed: state.collapsed, sport: state.sport, auto: state.auto });

  function buildUI() {
    host = document.createElement("div");
    host.id = "fgh-host";
    root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CSS;
    root.appendChild(style);
    const wrap = document.createElement("div");
    wrap.className = "wrap";
    root.appendChild(wrap);
    document.documentElement.appendChild(host);
    render();
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function gameRowHTML(g) {
    const cls = g.count >= 3 ? "hot" : g.count >= 1 ? "hit" : "";
    const live = g.state === "in" ? `<span class="live">● LIVE</span>` : "";
    const score =
      (g.state === "in" || g.state === "post") && g.away.score !== ""
        ? ` ${esc(g.away.score)}–${esc(g.home.score)}`
        : "";
    const names = g.players.length
      ? `<div class="names">⭐ ${g.players.map(esc).join(", ")}</div>`
      : "";
    return `
      <li class="game ${cls}">
        <div class="match">
          <span>${esc(g.away.abbr || g.away.name)} @ ${esc(g.home.abbr || g.home.name)}</span>
          <span class="badge">${g.count}</span>
        </div>
        <div class="meta">${live} ${esc(g.detail)}${score}</div>
        ${names}
      </li>`;
  }

  function render() {
    const wrap = root.querySelector(".wrap");
    const meta = SPORTS[state.sport];
    const totalMatched = state.games.reduce((a, g) => a + (g.count > 0 ? 1 : 0), 0);
    const sorted = state.games.slice().sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      const order = { in: 0, pre: 1, post: 2 };
      return (order[a.state] ?? 3) - (order[b.state] ?? 3);
    });

    let list;
    if (!state.games.length) {
      list = `<div class="empty">No ${meta.label} games for today.<br>Click <b>⟳</b>, or check back on a game day.</div>`;
    } else {
      list = `<ul class="games">${sorted.map(gameRowHTML).join("")}</ul>`;
    }

    const editorText = roster().map((p) => `${p.name}, ${p.team}`).join("\n");
    const tabs = availableSports()
      .map((s) => `<div class="tab ${s === state.sport ? "active" : ""}" data-sport="${s}">${SPORTS[s].emoji} ${SPORTS[s].label}</div>`)
      .join("");

    wrap.className = "wrap" + (state.collapsed ? " collapsed" : "");
    wrap.innerHTML = `
      <div class="hdr" data-act="toggle">
        <span class="title">${meta.emoji} Fantasy Game Finder</span>
        <span class="chip">${roster().length} players</span>
        <button class="iconbtn ${state.auto ? "on" : ""}" data-act="auto" title="Auto-scan: ${state.auto ? "on" : "off"}">⚡</button>
        <button class="iconbtn" data-act="refresh" title="Refresh games">⟳</button>
        <button class="iconbtn" data-act="toggle" title="Collapse / expand">${state.collapsed ? "▴" : "▾"}</button>
      </div>
      <div class="tabs">${tabs}</div>
      <div class="body">
        <div class="status">${esc(state.status || `${totalMatched} ${meta.label} game(s) with your players`)}</div>
        ${list}
        <div class="editor ${state.editing ? "open" : ""}">
          <div class="hint">One player per line: <code>Name, TEAM</code> (e.g. <code>Josh Allen, BUF</code>). Saving pins this roster so auto-scan won't overwrite it until you navigate.</div>
          <textarea spellcheck="false">${esc(editorText)}</textarea>
        </div>
      </div>
      <div class="footer">
        <button class="btn primary" data-act="scan">Rescan now</button>
        <button class="btn" data-act="edit">${state.editing ? "Save roster" : "Edit roster"}</button>
      </div>
    `;

    wrap.querySelectorAll("[data-act]").forEach((el) =>
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onAction(el.getAttribute("data-act"));
      })
    );
    wrap.querySelectorAll(".tab").forEach((el) =>
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        switchSport(el.getAttribute("data-sport"));
      })
    );
  }

  async function switchSport(sport) {
    if (!SPORTS[sport] || sport === state.sport) return;
    state.sport = sport;
    state.editing = false;
    state.status = "";
    await store.set({ [UI_KEY]: uiObj() });
    if (state.rawGames[sport]) {
      recompute();
      render();
    } else {
      await loadGames(false);
    }
  }

  async function onAction(act) {
    if (act === "toggle") {
      state.collapsed = !state.collapsed;
      await store.set({ [UI_KEY]: uiObj() });
      render();
    } else if (act === "auto") {
      state.auto = !state.auto;
      await store.set({ [UI_KEY]: uiObj() });
      render();
      if (state.auto) scheduleScan(200);
    } else if (act === "refresh") {
      await loadGames(true);
    } else if (act === "scan") {
      await doScan(true);
    } else if (act === "edit") {
      if (state.editing) {
        const ta = root.querySelector(".editor textarea");
        const parsed = parseRoster(state.sport, ta ? ta.value : "");
        state.rosters[state.sport] = parsed;
        state.locked[state.sport] = true; // respect manual curation until navigation
        await store.set({ [rosterKey(state.sport)]: parsed });
        state.editing = false;
        state.status = `Saved ${parsed.length} players (pinned).`;
        recompute();
      } else {
        state.editing = true;
      }
      render();
    }
  }

  function parseRoster(sport, text) {
    const out = [];
    const seen = new Set();
    text.split("\n").forEach((line) => {
      const raw = line.trim();
      if (!raw) return;
      let name = raw;
      let teamStr = "";
      const m = raw.match(/^(.*)[,\-–]\s*([^,\-–]+)$/);
      if (m) {
        name = m[1].trim();
        teamStr = m[2].trim();
      }
      const team =
        globalThis.fghNormalizeTeam(sport, teamStr) ||
        globalThis.fghFindTeamInText(sport, raw) ||
        "";
      name = name.replace(/\s+/g, " ").trim();
      if (!name) return;
      const key = name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ name, team });
    });
    return out;
  }

  function recompute() {
    state.games = matchGames(state.sport, state.rawGames[state.sport] || [], roster());
  }

  // Core scan. manual=true => triggered by the button (explicit): lower the
  // threshold and allow overwriting a pinned roster.
  async function doScan(manual) {
    const cands = getCandidates();
    const urlSport = detectSportFromUrl();
    let sport, found;
    if (urlSport) {
      sport = urlSport;
      found = buildRosterForSport(urlSport, cands);
    } else {
      const best = detectBest(cands);
      sport = best.sport;
      found = best.roster;
    }

    const threshold = manual ? 1 : MIN_AUTO;

    if (sport && found.length >= threshold) {
      if (!manual && state.locked[sport] && !sameRoster(found, state.rosters[sport] || [])) {
        return false; // pinned by a manual edit; leave it alone on auto
      }
      if (sameRoster(found, state.rosters[sport] || []) && sport === state.sport) {
        return false; // nothing changed; avoid churn
      }
      const switching = sport !== state.sport;
      state.sport = sport;
      state.rosters[sport] = found;
      if (manual) state.locked[sport] = false;
      state.status = `${manual ? "Scanned" : "Auto-detected"} ${found.length} ${SPORTS[sport].label} players${switching ? " (switched league)" : ""}.`;
      await store.set({ [rosterKey(sport)]: found, [UI_KEY]: uiObj() });
      if (!state.rawGames[sport]) {
        await loadGames(false);
      } else {
        recompute();
        render();
      }
      return true;
    }

    if (manual) {
      state.status = "Couldn't detect players on this page — open your roster page or edit manually.";
      render();
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Auto-scan scheduling (debounced; watches DOM + SPA navigation)
  // ---------------------------------------------------------------------------
  let scanTimer = null;
  let lastScan = 0;
  function scheduleScan(delay) {
    if (!state.auto || state.editing) return;
    clearTimeout(scanTimer);
    const sinceLast = Date.now() - lastScan;
    const wait = sinceLast > 4000 ? Math.min(delay || 800, 400) : delay || 800;
    scanTimer = setTimeout(() => {
      lastScan = Date.now();
      doScan(false);
    }, wait);
  }

  function setupWatchers() {
    const obs = new MutationObserver(() => scheduleScan(800));
    const start = () => obs.observe(document.body, { childList: true, subtree: true });
    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start, { once: true });

    // SPA route changes (these sites rewrite the URL without a reload)
    for (const m of ["pushState", "replaceState"]) {
      const orig = history[m];
      history[m] = function () {
        const r = orig.apply(this, arguments);
        window.dispatchEvent(new Event("fgh:locationchange"));
        return r;
      };
    }
    window.addEventListener("popstate", () => window.dispatchEvent(new Event("fgh:locationchange")));
    window.addEventListener("fgh:locationchange", () => {
      state.locked = {}; // new page => allow fresh auto-detection
      scheduleScan(1000);
    });
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "toggleOverlay") {
      host.style.display = host.style.display === "none" ? "" : "none";
    }
  });

  async function loadGames(force) {
    state.status = `Loading ${SPORTS[state.sport].label} games…`;
    render();
    try {
      const resp = await chrome.runtime.sendMessage({ type: "getGames", sport: state.sport, force: !!force });
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || "no response");
      state.rawGames[state.sport] = resp.games || [];
      recompute();
      state.status = "";
    } catch (e) {
      state.status = "Couldn't load games: " + ((e && e.message) || e);
    }
    render();
  }

  (async function init() {
    const keys = [UI_KEY, LEGACY_KEY, ...globalThis.FGH_SPORTS.map(rosterKey)];
    const data = await store.get(keys);
    for (const s of globalThis.FGH_SPORTS) {
      state.rosters[s] = Array.isArray(data[rosterKey(s)]) ? data[rosterKey(s)] : [];
    }
    if ((!state.rosters.nba || !state.rosters.nba.length) && Array.isArray(data[LEGACY_KEY]) && data[LEGACY_KEY].length) {
      state.rosters.nba = data[LEGACY_KEY];
      await store.set({ [rosterKey("nba")]: data[LEGACY_KEY] });
    }
    if (data[UI_KEY]) {
      state.collapsed = !!data[UI_KEY].collapsed;
      if (SPORTS[data[UI_KEY].sport]) state.sport = data[UI_KEY].sport;
      if (typeof data[UI_KEY].auto === "boolean") state.auto = data[UI_KEY].auto;
    }
    // Don't leave a Fantrax-only sport (NCAAF) selected on a non-Fantrax page.
    if (!availableSports().includes(state.sport)) state.sport = "nba";
    buildUI();
    await loadGames(false);
    setupWatchers();
    if (state.auto) scheduleScan(1500); // initial pass once the page settles
  })();
})();
