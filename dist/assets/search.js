/** Client-side doc search over assets/search-index.json */
(function () {
  const input = document.querySelector("[data-doc-search]");
  const list = document.getElementById("search-results");
  if (!input || !list) return;

  let index = null;
  let loadError = false;

  function loadIndex() {
    if (index || loadError) return Promise.resolve(index);
    return fetch("assets/search-index.json")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data) => {
        index = data;
        return index;
      })
      .catch(() => {
        loadError = true;
        return null;
      });
  }

  function snippet(text, query) {
    const lower = text.toLowerCase();
    const q = query.toLowerCase();
    const idx = lower.indexOf(q);
    if (idx < 0) return text.slice(0, 120);
    const start = Math.max(0, idx - 40);
    const end = Math.min(text.length, idx + query.length + 80);
    const chunk = text.slice(start, end).trim();
    return (start > 0 ? "…" : "") + chunk + (end < text.length ? "…" : "");
  }

  function scoreEntry(entry, query) {
    const q = query.toLowerCase();
    const title = entry.title.toLowerCase();
    if (title.includes(q)) return 3;
    if (entry.text.toLowerCase().includes(q)) return 1;
    return 0;
  }

  function renderResults(matches, query) {
    list.innerHTML = "";
    if (!query.trim()) {
      list.hidden = true;
      return;
    }
    if (!matches.length) {
      list.hidden = false;
      const li = document.createElement("li");
      li.textContent = "No matches";
      li.className = "search-empty";
      list.appendChild(li);
      return;
    }
    list.hidden = false;
    for (const entry of matches.slice(0, 12)) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = entry.href;
      a.innerHTML = `<strong>${entry.title}</strong><span>${snippet(entry.text, query)}</span>`;
      li.appendChild(a);
      list.appendChild(li);
    }
  }

  function runSearch() {
    const query = input.value.trim();
    if (!query) {
      renderResults([], query);
      return;
    }
    loadIndex().then((data) => {
      if (!data) {
        renderResults([], query);
        return;
      }
      const matches = data
        .map((entry) => ({ entry, score: scoreEntry(entry, query) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title))
        .map(({ entry }) => entry);
      renderResults(matches, query);
    });
  }

  input.addEventListener("input", runSearch);
  input.addEventListener("focus", () => loadIndex().then(runSearch));

  const params = new URLSearchParams(window.location.search);
  const q = params.get("q");
  if (q) {
    input.value = q;
    loadIndex().then(runSearch);
  }
})();
