const CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #121212; color: #f2f2f2;
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 720px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 34px; margin: 0 0 4px; letter-spacing: -0.5px; }
  h2 { font-size: 21px; margin: 28px 0 8px; }
  .tag { color: #b8b8b8; margin: 0 0 24px; }
  label { display: block; font-weight: 600; margin: 16px 0 6px; }
  select { width: 100%; background: #1d1d1d; color: #f2f2f2;
    border: 1px solid #383838; border-radius: 6px; padding: 10px 12px; font: inherit; }
  .fix { background: none; border: 0; color: #ff6b6b; padding: 0; margin: 0 0 0 8px;
    font-size: 13px; font-weight: 600; cursor: pointer; }
  input, textarea { width: 100%; background: #1d1d1d; color: #f2f2f2;
    border: 1px solid #383838; border-radius: 6px; padding: 10px 12px; font: inherit; }
  button { background: #d92323; color: #fff; border: 0; border-radius: 6px;
    padding: 12px 18px; font: inherit; font-weight: 700; cursor: pointer; margin-top: 18px; }
  button.secondary { background: #2a2a2a; margin-left: 8px; }
  button.spotify { background: #1db954; color: #000; margin-left: 8px; }
  button:disabled { opacity: .55; cursor: wait; }
  .band { border-top: 1px solid #2c2c2c; padding-top: 8px; margin-top: 10px; }
  .src { color: #9a9a9a; font-size: 13px; margin: 2px 0 8px; }
  .song { display: flex; gap: 10px; align-items: baseline; padding: 5px 0; }
  .song input { width: auto; }
  .tape { color: #888; font-size: 13px; }
  .muted { color: #9a9a9a; }
  a { color: #ff6b6b; }
  .msg { white-space: pre-wrap; margin-top: 16px; }
  ul.shows { padding-left: 18px; }
`;

function shell(title: string, body: string, script: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · SetReady</title><style>${CSS}</style></head>
<body><main>
<h1>SetReady</h1>
<p class="tag">Hear tonight's show before doors.</p>
<label for="adminToken">Operator token (required to build/publish)</label>
<input id="adminToken" type="password" autocomplete="off" placeholder="Stored only in this browser">
${body}
</main><script>
const adminInput = document.getElementById("adminToken");
adminInput.value = localStorage.getItem("setready_admin") || "";
adminInput.addEventListener("change", () => localStorage.setItem("setready_admin", adminInput.value));
const adminHeaders = () => ({ "x-admin-token": adminInput.value });
${script}</script></body></html>`;
}

export function tourPage(slug: string): string {
  const body = `<div id="app"><p class="muted">Loading…</p></div>
<p><a href="/">← All shows</a></p>`;
  const script = `
const slug = ${JSON.stringify(slug)};
const app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
(async () => {
  const r = await fetch("/api/tours/" + encodeURIComponent(slug));
  const d = await r.json();
  if (!r.ok) { app.innerHTML = "<p>Failed: " + esc(d.message || d.error) + "</p>"; return; }
  let html = "<h2>" + esc(d.tour.title) + "</h2>";
  html += "<p class=muted>Playing order: " + d.bands.map(esc).join(" → ") + "</p>";
  if (d.playlists.length) {
    html += "<p>" + d.playlists.map(p =>
      '<a href="' + esc(p.service === "spotify" ? p.external_url : "https://music.youtube.com/playlist?list=" + p.external_playlist_id) + '">' +
      (p.service === "spotify" ? "Open in Spotify" : "Open in YouTube Music") + "</a>").join(" · ") + "</p>";
  }
  html += "<h2>Stops with this lineup (" + d.stops.length + ")</h2><ul>";
  for (const s of d.stops) {
    const built = d.builtByDate[s.event_date];
    html += "<li>" + esc(s.event_date) + " — " + esc(s.city || "") +
      (s.venue ? " · " + esc(s.venue) : "") +
      (built ? ' · <a href="/shows/' + encodeURIComponent(built) + '">show page</a>' : "") +
      (s.confidence === "inferred" ? ' <span class="tape">(lineup inferred)</span>' : "") + "</li>";
  }
  html += "</ul>";
  app.innerHTML = html;
})();`;
  return shell("Tour", body, script);
}

export function homePage(): string {
  const body = `
<form id="build">
  <label for="headliner">Headliner</label>
  <input id="headliner" required placeholder="Trivium">
  <label for="date">Event date</label>
  <input id="date" type="date" required>
  <label for="bands">Bands (optional — one per line, support first, headliner last; blank = Ticketmaster lookup)</label>
  <textarea id="bands" rows="4" placeholder="In Flames&#10;Trivium"></textarea>
  <label for="mode">Setlist source</label>
  <select id="mode">
    <option value="predicted">Predicted — stats from last 5 shows</option>
    <option value="last_show">Last show — copy most recent setlist</option>
    <option value="actual">Actual — exact setlist for this date (after the show)</option>
  </select>
  <button id="go" type="submit">Fetch setlists</button>
  <p class="msg" id="msg"></p>
</form>
<h2>Saved shows</h2>
<ul class="shows" id="shows"><li class="muted">Loading…</li></ul>
<h2>Tours</h2>
<ul class="shows" id="tours"><li class="muted">Loading…</li></ul>
<h2>Auto-discovery pipeline</h2>
<p class="muted">Discovers upcoming tours, checks setlist evidence, builds and publishes qualifying ones (capped).</p>
<button id="runPipe" class="secondary" style="margin-left:0">Run discovery + publish 1</button>
<p class="msg" id="pipeMsg"></p>
<ul class="shows" id="cands"><li class="muted">Enter operator token to load candidates.</li></ul>`;
  const script = `
const $ = (id) => document.getElementById(id);
fetch("/api/tours").then(r => r.json()).then(({ tours }) => {
  $("tours").innerHTML = tours.length
    ? tours.map(t => '<li><a href="/tours/' + encodeURIComponent(t.slug) + '">' +
        t.title + "</a> <span class=muted>" + t.stops + " stops</span></li>").join("")
    : '<li class="muted">None yet.</li>';
}).catch(() => { $("tours").innerHTML = '<li class="muted">Unavailable.</li>'; });
fetch("/api/shows").then(r => r.json()).then(({ shows }) => {
  $("shows").innerHTML = shows.length
    ? shows.map(s => '<li><a href="/shows/' + encodeURIComponent(s.slug) + '">' +
        s.title + "</a> <span class=muted>" + s.event_date + "</span></li>").join("")
    : '<li class="muted">None yet.</li>';
});
async function loadCands() {
  try {
    const r = await fetch("/api/admin/candidates", { headers: adminHeaders() });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || r.status);
    $("cands").innerHTML = d.candidates.length
      ? d.candidates.map(c => "<li>" + (c.is_followed ? "★ " : "") + c.headliner + " <span class=muted>" +
          c.status + " · score " + c.score + " · " + c.events_count + " dates · " +
          c.first_date + (c.show_slug ? ' · <a href="/shows/' + encodeURIComponent(c.show_slug) + '">show</a>' : "") +
          (c.reason ? " · " + c.reason : "") + "</span></li>").join("")
      : '<li class="muted">No candidates yet. Run discovery.</li>';
  } catch { /* token not set yet */ }
}
loadCands();
$("runPipe").addEventListener("click", async () => {
  const btn = $("runPipe"); btn.disabled = true;
  $("pipeMsg").textContent = "Discovering, qualifying, publishing (can take a minute)…";
  try {
    const r = await fetch("/api/admin/pipeline/run", {
      method: "POST", headers: { "content-type": "application/json", ...adminHeaders() },
      body: JSON.stringify({ windowDays: 14, qualifyLimit: 10, publishLimit: 1 }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message || d.error);
    $("pipeMsg").textContent =
      "Events " + d.discovery.events + ", candidates " + d.discovery.candidates +
      ", qualified " + d.qualified.join(", ") +
      ", published " + d.published.map(p => p.headliner).join(", ") +
      (d.errors.length ? ", errors: " + JSON.stringify(d.errors) : "");
    loadCands();
  } catch (err) { $("pipeMsg").textContent = "Failed: " + err.message; }
  btn.disabled = false;
});
$("build").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("go").disabled = true; $("msg").textContent = "Fetching setlists…";
  const bands = $("bands").value.split("\\n").map(s => s.trim()).filter(Boolean);
  try {
    const r = await fetch("/api/shows/build", {
      method: "POST", headers: { "content-type": "application/json", ...adminHeaders() },
      body: JSON.stringify({ headliner: $("headliner").value, date: $("date").value,
        mode: $("mode").value,
        bands: bands.length ? bands : undefined }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.message || data.error || r.status);
    location.href = "/shows/" + encodeURIComponent(data.slug);
  } catch (err) {
    $("msg").textContent = "Failed: " + err.message;
    $("go").disabled = false;
  }
});`;
  return shell("Build a show", body, script);
}

export function showPage(slug: string): string {
  const body = `<div id="app"><p class="muted">Loading…</p></div>`;
  const script = `
const slug = ${JSON.stringify(slug)};
const app = document.getElementById("app");
const esc = (s) => s.replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
async function load() {
  const r = await fetch("/api/shows/" + encodeURIComponent(slug));
  const d = await r.json();
  if (!r.ok) { app.innerHTML = "<p>Failed: " + esc(d.message || d.error) + "</p>"; return; }
  let html = "<h2>" + esc(d.show.title) + "</h2>" +
    "<p class=muted>" + esc(d.show.event_date) + (d.show.venue ? " · " + esc(d.show.venue) : "") + "</p>";
  if (d.playlists.length) {
    html += "<p>" + d.playlists.map(p => {
      const href = p.service === "spotify"
        ? p.external_url
        : "https://music.youtube.com/playlist?list=" + p.external_playlist_id;
      const label = p.service === "spotify" ? "Open in Spotify" : "Open in YouTube Music";
      return '<a href="' + esc(href) + '">' + label + "</a>";
    }).join(" · ") + "</p>";
  }
  html += '<p class="muted">Uncheck songs to leave out. Tape intros are excluded automatically.</p>';
  for (const b of d.bands) {
    html += '<div class="band"><h2>' + esc(b.name) + "</h2>";
    if (b.source_setlist_url)
      html += '<p class="src">Based on ' + esc(b.source_setlist_date || "") +
        ' · <a href="' + esc(b.source_setlist_url) + '">source setlist</a></p>';
    for (const s of b.songs) {
      const pct = s.probability != null ? ' <span class="tape">' + Math.round(s.probability * 100) + "%</span>" : "";
      const matchBits = ["youtube", "spotify"].map((svc) => {
        const m = s.matches && s.matches[svc];
        const label = svc === "youtube" ? "YT" : "SP";
        const text = m ? (m.status === "matched" ? esc(m.matched_title || "matched") : "no match") : "not matched yet";
        return label + ": " + text +
          ' <button type="button" class="fix" data-fix="' + svc + '" data-song="' + s.id +
          '" data-artist="' + esc(s.matchArtist || b.name) + '" data-title="' + esc(s.title) + '">fix</button>';
      }).join(" · ");
      html += '<label class="song"><input type="checkbox" data-id="' + s.id + '"' +
        (s.included && !s.is_tape ? " checked" : "") + (s.is_tape ? " disabled" : "") + ">" +
        "<span>" + esc(s.title) + pct +
        (s.original_artist ? ' <span class="tape">(cover: ' + esc(s.original_artist) + ")</span>" : "") +
        (s.is_tape ? ' <span class="tape">(tape)</span>' : "") +
        '<br><span class="tape">' + matchBits + "</span></span></label>";
    }
    html += "</div>";
  }
  const tourLabel = d.show.tour_slug ? " tour playlist" : "";
  html += '<button id="pubYt">Publish' + tourLabel + ' to YouTube Music</button>' +
    '<button id="pubSp" class="spotify">Publish' + tourLabel + ' to Spotify</button>' +
    '<button id="save" class="secondary">Save selection</button>' +
    (d.show.tour_slug
      ? '<button id="imp" class="secondary">Import tour stops</button>' +
        '<button id="sync" class="secondary">Sync descriptions</button>'
      : "") +
    '<p class="msg" id="msg"></p>';
  app.innerHTML = html;
  for (const btn of document.querySelectorAll("button[data-fix]")) {
    btn.onclick = async (e) => {
      e.preventDefault();
      const service = btn.dataset.fix, artist = btn.dataset.artist, title = btn.dataset.title;
      const msg = document.getElementById("msg");
      try {
        const r = await fetch("/api/match/candidates", {
          method: "POST", headers: { "content-type": "application/json", ...adminHeaders() },
          body: JSON.stringify({ service, artist, title }) });
        const d2 = await r.json();
        if (!r.ok) throw new Error(d2.message || d2.error);
        if (!d2.candidates.length) { msg.textContent = "No candidates for " + title; return; }
        const list = d2.candidates.map((c, i) => (i + 1) + ". " + c.title + " [" + c.channelTitle + "]").join("\\n");
        const pick = prompt("Pick a match for " + artist + " – " + title + " (" + service + "):\\n" + list, "1");
        const idx = Number(pick) - 1;
        if (!d2.candidates[idx]) return;
        const c = d2.candidates[idx];
        const r2 = await fetch("/api/match/override", {
          method: "POST", headers: { "content-type": "application/json", ...adminHeaders() },
          body: JSON.stringify({ service, artist, title, trackId: c.id, trackUri: c.uri,
            matchedTitle: c.title, matchedArtist: artist }) });
        if (!r2.ok) throw new Error("override failed");
        msg.textContent = "Match saved. Republish to apply it to the playlist.";
        load();
      } catch (err) { msg.textContent = "Fix failed: " + err.message; }
    };
  }
  const save = async () => {
    const ids = [...document.querySelectorAll("input[data-id]:checked")].map(i => Number(i.dataset.id));
    const r = await fetch("/api/shows/" + encodeURIComponent(slug) + "/selection", {
      method: "POST", headers: { "content-type": "application/json", ...adminHeaders() },
      body: JSON.stringify({ includedSongIds: ids }) });
    if (!r.ok) throw new Error("save failed");
  };
  document.getElementById("save").onclick = async () => {
    await save(); document.getElementById("msg").textContent = "Saved.";
  };
  const publish = (service) => async (e) => {
    const btn = e.target, msg = document.getElementById("msg");
    btn.disabled = true; msg.textContent = "Matching songs and creating playlist…";
    try {
      await save();
      const base = d.show.tour_slug
        ? "/api/tours/" + encodeURIComponent(d.show.tour_slug)
        : "/api/shows/" + encodeURIComponent(slug);
      const r = await fetch(base + "/publish/" + service, { method: "POST", headers: adminHeaders() });
      const d2 = await r.json();
      if (!r.ok) throw new Error(d2.message || d2.error);
      const href = service === "spotify" ? d2.spotify : d2.youtubeMusic;
      const label = service === "spotify" ? "Open in Spotify" : "Open in YouTube Music";
      msg.innerHTML = 'Published: <a href="' + href + '">' + label + "</a> · " +
        d2.added + " songs" + (d2.unmatched.length
          ? "\\nUnmatched: " + d2.unmatched.map(u => u.artist + " – " + u.title).join("; ") : "") +
        ((d2.failed || []).length
          ? "\\nFailed: " + d2.failed.map(f => f.artist + " – " + f.title + " (" + f.error + ")").join("; ") : "");
    } catch (err) { msg.textContent = "Failed: " + err.message; btn.disabled = false; }
  };
  document.getElementById("pubYt").onclick = publish("youtube");
  document.getElementById("pubSp").onclick = publish("spotify");
  const tourAction = (path, label) => async (e) => {
    const btn = e.target, msg = document.getElementById("msg");
    btn.disabled = true; msg.textContent = label + "…";
    try {
      const r = await fetch("/api/tours/" + encodeURIComponent(d.show.tour_slug) + path, { method: "POST", headers: adminHeaders() });
      const d2 = await r.json();
      if (!r.ok) throw new Error(d2.message || d2.error);
      msg.textContent = label + " done: " + JSON.stringify(
        d2.imported !== undefined
          ? { imported: d2.imported, confirmed: d2.confirmed, inferred: d2.inferred }
          : { updated: d2.updated, stops: d2.stops });
    } catch (err) { msg.textContent = "Failed: " + err.message; }
    btn.disabled = false;
  };
  if (d.show.tour_slug) {
    document.getElementById("imp").onclick = tourAction("/import-stops", "Importing stops");
    document.getElementById("sync").onclick = tourAction("/sync-descriptions", "Syncing descriptions");
  }
}
load();`;
  return shell("Review show", body, script);
}
