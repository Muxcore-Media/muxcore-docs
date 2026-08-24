#!/usr/bin/env node
/**
 * Build MuxCore docs from wiki markdown → dist/ static HTML.
 * Prefers ../core.wiki when present; otherwise uses ./wiki.
 */
import { marked } from "marked";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const DIST = join(ROOT, "dist");
const SITE = join(ROOT, "site");
const LOCAL_WIKI = join(ROOT, "wiki");
const SIBLING_WIKI = resolve(ROOT, "../core.wiki");

function wikiSource() {
  if (existsSync(join(SIBLING_WIKI, "Home.md"))) return SIBLING_WIKI;
  if (existsSync(join(LOCAL_WIKI, "Home.md"))) return LOCAL_WIKI;
  throw new Error(
    "No wiki source found. Expected ../core.wiki or ./wiki with Home.md",
  );
}

function slug(name) {
  return basename(name, ".md");
}

function pageHref(name) {
  const s = slug(name);
  if (s === "Home") return "index.html";
  return `${s}.html`;
}

/** Rewrite GitHub-wiki style links [Text](Page-Name) → Page-Name.html */
function rewriteWikiLinks(html, pages) {
  const byLower = new Map(
    [...pages].map((p) => [p.toLowerCase(), p]),
  );
  return html.replace(
    /href="([^"#?]+\.md|[^"#?/]+)"/gi,
    (full, target) => {
      let t = target.replace(/\.md$/i, "");
      // Drop relative ../TASKS.md style links that leave the wiki
      if (t.startsWith("..") || t.startsWith("http") || t.startsWith("/")) {
        return full;
      }
      const hit = byLower.get(t.toLowerCase());
      if (!hit) return full;
      return `href="${pageHref(hit)}"`;
    },
  );
}

function parseSidebar(md, pages) {
  const links = [];
  for (const line of md.split("\n")) {
    const m = line.match(/\[([^\]]+)\]\(([^)]+)\)/);
    if (!m) continue;
    const [, label, target] = m;
    const page = target.replace(/\.md$/i, "");
    if (![...pages].some((p) => p.toLowerCase() === page.toLowerCase())) {
      continue;
    }
    links.push({ label, href: pageHref(page), page });
  }
  return links;
}

function layout({ title, body, nav, active }) {
  const navHtml = nav
    .map((item) => {
      const isActive = item.page === active;
      const attrs = isActive
        ? ' class="active" aria-current="page"'
        : "";
      return `<a href="${item.href}"${attrs}>${item.label}</a>`;
    })
    .join("\n        ");

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
      <nav aria-label="Pages">
        ${navHtml}
      </nav>
    </aside>
    <main id="main-content" class="content" tabindex="-1">
      ${body}
    </main>
  </div>
</body>
</html>
`;
}

function syncWikiIntoRepo(src) {
  if (resolve(src) === resolve(LOCAL_WIKI)) return;
  mkdirSync(LOCAL_WIKI, { recursive: true });
  for (const f of readdirSync(src)) {
    if (!f.endsWith(".md")) continue;
    cpSync(join(src, f), join(LOCAL_WIKI, f));
  }
  console.log(`synced wiki → ${LOCAL_WIKI}`);
}

function main() {
  const src = wikiSource();
  console.log(`wiki source: ${src}`);
  syncWikiIntoRepo(src);

  const files = readdirSync(src).filter(
    (f) => f.endsWith(".md") && !f.startsWith("."),
  );
  const pages = new Set(
    files.filter((f) => f !== "_Sidebar.md").map((f) => slug(f)),
  );

  let nav = [];
  const sidebarPath = join(src, "_Sidebar.md");
  if (existsSync(sidebarPath)) {
    nav = parseSidebar(readFileSync(sidebarPath, "utf8"), pages);
  }
  if (nav.length === 0) {
    nav = [...pages]
      .sort((a, b) => (a === "Home" ? -1 : b === "Home" ? 1 : a.localeCompare(b)))
      .map((p) => ({
        label: p.replace(/-/g, " "),
        href: pageHref(p),
        page: p,
      }));
  }

  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(join(DIST, "assets"), { recursive: true });
  cpSync(join(SITE, "style.css"), join(DIST, "assets", "style.css"));

  for (const file of files) {
    if (file === "_Sidebar.md") continue;
    const name = slug(file);
    const md = readFileSync(join(src, file), "utf8");
    let body = marked.parse(md, { async: false });
    body = rewriteWikiLinks(body, pages);
    // Workspace-only TASKS.md links are not routable in the static site.
    body = body.replace(
      /<a href="\.\.\/TASKS\.md">([\s\S]*?)<\/a>/g,
      '<span class="workspace-file-ref" title="See workspace TASKS.md">$1</span>',
    );

    const html = layout({
      title: name.replace(/-/g, " "),
      body,
      nav,
      active: name,
    });
    const out = join(DIST, pageHref(name));
    writeFileSync(out, html);
    console.log(`  ${file} → ${basename(out)}`);
  }

  // Convenience: also keep raw markdown in dist for grep / offline
  mkdirSync(join(DIST, "md"), { recursive: true });
  for (const file of files) {
    cpSync(join(src, file), join(DIST, "md", file));
  }

  writeFileSync(
    join(DIST, ".build-info"),
    `built=${new Date().toISOString()}\nsource=${src}\npages=${pages.size}\n`,
  );
  console.log(`done → ${DIST} (${pages.size} pages)`);
}

main();
