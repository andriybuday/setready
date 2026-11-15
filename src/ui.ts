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
${body}
</main><script>${script}</script></body></html>`;
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
  <button id="go" type="submit">Fetch setlists</button>
  <p class="msg" id="msg"></p>
</form>
<h2>Saved shows</h2>
<ul class="shows" id="shows"><li class="muted">Loading…</li></ul>`;
  const script = `
const $ = (id) => document.getElementById(id);
fetch("/api/shows").then(r => r.json()).then(({ shows }) => {
  $("shows").innerHTML = shows.length
    ? shows.map(s => '<li><a href="/shows/' + encodeURIComponent(s.slug) + '">' +
        s.title + "</a> <span class=muted>" + s.event_date + "</span></li>").join("")
    : '<li class="muted">None yet.</li>';
});
$("build").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("go").disabled = true; $("msg").textContent = "Fetching setlists…";
  const bands = $("bands").value.split("\\n").map(s => s.trim()).filter(Boolean);
  try {
    const r = await fetch("/api/shows/build", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ headliner: $("headliner").value, date: $("date").value,
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
      html += '<label class="song"><input type="checkbox" data-id="' + s.id + '"' +
        (s.included && !s.is_tape ? " checked" : "") + (s.is_tape ? " disabled" : "") + ">" +
        "<span>" + esc(s.title) +
        (s.original_artist ? ' <span class="tape">(cover: ' + esc(s.original_artist) + ")</span>" : "") +
        (s.is_tape ? ' <span class="tape">(tape)</span>' : "") + "</span></label>";
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
  const save = async () => {
    const ids = [...document.querySelectorAll("input[data-id]:checked")].map(i => Number(i.dataset.id));
    const r = await fetch("/api/shows/" + encodeURIComponent(slug) + "/selection", {
      method: "POST", headers: { "content-type": "application/json" },
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
      const r = await fetch(base + "/publish/" + service, { method: "POST" });
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
      const r = await fetch("/api/tours/" + encodeURIComponent(d.show.tour_slug) + path, { method: "POST" });
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
