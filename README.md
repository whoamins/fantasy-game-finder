# Fantasy Game Finder (NBA / NFL / NHL)

A Chrome/Edge extension that helps you decide which game to watch, based on how
many players from your fantasy roster are in each game. It shows a **collapsible
dialog in the bottom-left corner** that lists today's games, sorted by how many
of your players are playing, and highlights the ones worth watching.

Switch leagues with the league tabs — each sport keeps its own roster.
**NBA / NFL / NHL** work on all three platforms; **NCAAF** (college football)
is Fantrax-only, so that tab appears only on Fantrax pages.

- 🟩 **green** = 1–2 of your players in that game
- 🟨 **gold** = 3+ of your players (must-watch)
- `●` LIVE indicator and live score when a game is in progress

Works on **ESPN**, **Fantrax**, and **Yahoo** fantasy pages.

## How it works

1. Game/schedule data comes from ESPN's public scoreboard API (one endpoint per
   sport) — no login or API key needed.
2. Your roster is read automatically:
   - **Auto-scan (⚡)** — when on, the extension detects the sport and scrapes
     your roster on its own as the page loads and whenever you navigate. It only
     overwrites a roster when it confidently finds 3+ players, so non-roster
     pages won't wipe your list. Toggle it with the ⚡ button in the header.
   - **Rescan now** — force an immediate scan of the current page.
   - **Edit roster** — type/paste your players manually as `Name, TEAM`
     (one per line). Saving *pins* that roster so auto-scan won't overwrite it
     until you navigate to another page. Always works, even if a site's layout
     changes.
3. Each player's team is matched against the two teams in every game, and the
   games are ranked by how many of your players appear.

The sport is detected from the page: on Fantrax it's read exactly from the
`<fx-nav class="nav <sport>">` tag (so NCAAF is picked up reliably); on
Yahoo/ESPN from the URL/host (e.g. Yahoo's `basketball.` / `football.` /
`hockey.` subdomains), falling back to a content check that picks whichever
league matches the most players on the page.

NCAAF has too many teams for a hardcoded map, so college players are matched
**dynamically** against ESPN's college-football scoreboard (by abbreviation,
school name, or location) rather than a fixed team list.

Roster data is stored locally in the browser (`chrome.storage.local`); nothing
is sent anywhere except the public ESPN scoreboard request.

## Install (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this `fantasy-game-finder` folder.
4. Open your fantasy roster page on ESPN, Fantrax, or Yahoo. The dialog appears
   bottom-left. Click the extension's **toolbar icon** to show/hide the whole
   overlay — that choice is remembered across reloads and navigation.

## Usage

1. Go to your fantasy **roster** page. The extension auto-detects the league
   and scrapes your roster — the league tab switches and the player-count chip
   updates on its own.
2. If a scan missed players or got a team wrong, click **Edit roster**, fix the
   list, and **Save roster** (this pins it until you navigate). Each sport keeps
   its own roster. You can also switch leagues manually with the tabs.
3. Collapse the dialog with the ▾ button; your choice, selected sport, and the
   ⚡ auto-scan setting are remembered.
4. Click ⟳ to refresh scores/games, or **Rescan now** to re-read the roster.

## Tuning the scraper

The three platforms don't publish stable public roster APIs for logged-in
leagues, so auto-scan uses best-effort DOM selectors that can drift as
the sites change. If a scan comes back short:

- Use **Edit roster** — it's the reliable path and only takes a minute (it also
  pins your roster so auto-scan leaves it alone).
- Or update the per-platform selectors in [`content.js`](content.js) →
  `getCandidates()`. Fantrax players are read from `<scorer>` elements (name
  from `.scorer__info__name`, team from `.scorer__info__positions` so the Opp
  column is ignored); ESPN/Yahoo are read from table rows. Unknown layouts fall
  back to a generic leaf scan.

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | MV3 manifest, permissions, content-script matches |
| `background.js` | Service worker: fetches + caches the ESPN scoreboard |
| `content.js` | The bottom-left dialog, roster scraping, and matching |
| `teams.js` | Per-sport team normalization (NBA/NFL/NHL; GS/GSW, JAX/JAC, etc.) |

## Notes / limitations

- Covers NBA, NFL, NHL, and (Fantrax-only) NCAAF. To add another league, add
  its team map in `teams.js` (plus `FGH_SPORTS` / `FGH_DETECT_SPORTS`), an ESPN
  path in `background.js` (`ESPN_PATH`), and an entry in `SPORTS` in
  `content.js`. A map-less league (like NCAAF) instead relies on the dynamic
  scoreboard matcher and is excluded from `FGH_DETECT_SPORTS`.
- "Today" is your local date; use ⟳ after midnight for the new slate. For NFL,
  ESPN's scoreboard returns the current week's slate, which is what you want for
  picking games.
- The scraper reads only the roster page you're viewing; it never logs in,
  changes your team, or touches your account.
