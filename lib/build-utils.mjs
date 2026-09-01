import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const LOCAL_WIKI = join(ROOT, "wiki");
export const SIBLING_WIKI = resolve(ROOT, "../core.wiki");

export function slug(name) {
  return basename(name, ".md");
}

export function pageHref(name) {
  const s = slug(name);
  if (s === "Home") return "index.html";
  return `${s}.html`;
}

/** Resolve wiki markdown source — committed `./wiki/` is the default snapshot. */
export function wikiSource(env = process.env) {
  const override = env.MUXCORE_DOCS_WIKI?.trim();
  if (override) {
    const resolved = resolve(ROOT, override);
    if (!existsSync(join(resolved, "Home.md"))) {
      throw new Error(`MUXCORE_DOCS_WIKI missing Home.md: ${resolved}`);
    }
    return resolved;
  }
  if (existsSync(join(LOCAL_WIKI, "Home.md"))) return LOCAL_WIKI;
  if (existsSync(join(SIBLING_WIKI, "Home.md"))) return SIBLING_WIKI;
  throw new Error(
    "No wiki source found. Expected ./wiki/Home.md or set MUXCORE_DOCS_WIKI",
  );
}

export function listWikiPages(src) {
  return readdirSync(src)
    .filter((f) => f.endsWith(".md") && !f.startsWith(".") && f !== "_Sidebar.md")
    .map((f) => slug(f))
    .sort((a, b) => (a === "Home" ? -1 : b === "Home" ? 1 : a.localeCompare(b)));
}

/** Rewrite GitHub-wiki style links [Text](Page-Name) → Page-Name.html */
export function rewriteWikiLinks(html, pages) {
  const pageSet =
    pages instanceof Set ? pages : new Set(Array.isArray(pages) ? pages : [...pages]);
  const byLower = new Map([...pageSet].map((p) => [p.toLowerCase(), p]));
  return html.replace(
    /href="([^"#?]+\.md|[^"#?/]+)"/gi,
    (full, target) => {
      let t = target.replace(/\.md$/i, "");
      if (t.startsWith("..") || t.startsWith("http") || t.startsWith("/")) {
        return full;
      }
      const hit = byLower.get(t.toLowerCase());
      if (!hit) return full;
      return `href="${pageHref(hit)}"`;
    },
  );
}

export function parseSidebar(md, pages) {
  const pageSet =
    pages instanceof Set ? pages : new Set(Array.isArray(pages) ? pages : [...pages]);
  const links = [];
  for (const line of md.split("\n")) {
    const m = line.match(/\[([^\]]+)\]\(([^)]+)\)/);
    if (!m) continue;
    const [, label, target] = m;
    const page = target.replace(/\.md$/i, "");
    if (![...pageSet].some((p) => p.toLowerCase() === page.toLowerCase())) {
      continue;
    }
    links.push({ label, href: pageHref(page), page });
  }
  return links;
}

export function stripHtml(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function escapeAttr(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/** Workspace paths (../…) are not routable in the static site — use non-link refs. */
export function stripWorkspacePathLinks(html) {
  return html.replace(
    /<a href="\.\.\/([^"]+)">([\s\S]*?)<\/a>/g,
    (_, path, inner) =>
      `<span class="workspace-file-ref" title="See workspace ${escapeAttr(path)}">${inner}</span>`,
  );
}

/** Static task-list checkboxes and data tables need explicit a11y metadata. */
export function enhanceAccessibility(html) {
  html = html.replace(
    /<li><input([^>]*\btype="checkbox"[^>]*)>([\s\S]*?)<\/li>/gi,
    (match, attrs, rest) => {
      const label = stripHtml(rest);
      if (!label || /\baria-label=/.test(attrs)) return match;
      return `<li><input${attrs} aria-label="${escapeAttr(label)}">${rest}</li>`;
    },
  );

  html = html.replace(/<thead>([\s\S]*?)<\/thead>/gi, (_, inner) => {
    const scoped = inner.replace(
      /<th(?![^>]*\bscope=)([^>]*)>/gi,
      '<th scope="col"$1>',
    );
    return `<thead>${scoped}</thead>`;
  });

  return html;
}

export function layout({ title, body, nav, active, includeSearch = true }) {
  const navHtml = nav
    .map((item) => {
      const isActive = item.page === active;
      const attrs = isActive
        ? ' class="active" aria-current="page"'
        : "";
      return `<a href="${item.href}"${attrs}>${item.label}</a>`;
    })
    .join("\n        ");

  const searchBlock = includeSearch
    ? `<form class="site-search" role="search" action="index.html">
      <label class="visually-hidden" for="doc-search">Search documentation</label>
      <input id="doc-search" type="search" name="q" placeholder="Search docs…" autocomplete="off" spellcheck="false" data-doc-search />
      <ul class="search-results" id="search-results" hidden aria-live="polite"></ul>
    </form>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} · MuxCore Docs</title>
  <meta name="description" content="${title} — MuxCore documentation." />
  <link rel="stylesheet" href="assets/style.css" />
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to main content</a>
  <div class="shell">
    <aside class="sidebar" aria-label="Documentation navigation">
      <a class="brand" href="index.html">MuxCore</a>
      <p class="tag">Documentation</p>
      ${searchBlock}
      <nav aria-label="Pages">
        ${navHtml}
      </nav>
    </aside>
    <main id="main-content" class="content" tabindex="-1">
      ${body}
    </main>
  </div>
  ${includeSearch ? '<script src="assets/search.js" defer></script>' : ""}
</body>
</html>
`;
}

export function sidebarPageSlugs(sidebarMd) {
  const slugs = [];
  for (const line of sidebarMd.split("\n")) {
    const m = line.match(/\]\(([^)]+)\)/);
    if (!m) continue;
    slugs.push(m[1].replace(/\.md$/i, ""));
  }
  return slugs;
}
