#!/usr/bin/env node
/**
 * Build MuxCore docs from committed wiki markdown → dist/ static HTML.
 * Default source: ./wiki (override with MUXCORE_DOCS_WIKI).
 */
import { marked } from "marked";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOCAL_WIKI,
  enhanceAccessibility,
  layout,
  listWikiPages,
  pageHref,
  rewriteWikiLinks,
  slug,
  stripWorkspacePathLinks,
  wikiSource,
  parseSidebar,
  stripHtml,
} from "./lib/build-utils.mjs";

export {
  enhanceAccessibility,
  layout,
  listWikiPages,
  pageHref,
  parseSidebar,
  rewriteWikiLinks,
  slug,
  stripWorkspacePathLinks,
  wikiSource,
} from "./lib/build-utils.mjs";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const DIST = join(ROOT, "dist");
const SITE = join(ROOT, "site");

function syncWikiIntoRepo(src) {
  if (process.env.MUXCORE_DOCS_SKIP_WIKI_SYNC === "1") return;
  if (resolve(src) === resolve(LOCAL_WIKI)) return;
  mkdirSync(LOCAL_WIKI, { recursive: true });
  for (const f of readdirSync(src)) {
    if (!f.endsWith(".md")) continue;
    cpSync(join(src, f), join(LOCAL_WIKI, f));
  }
  console.log(`synced wiki → ${LOCAL_WIKI}`);
}

function buildSearchIndex(entries) {
  return entries.map(({ title, href, text }) => ({ title, href, text }));
}

function notFoundPage(nav) {
  const body = `<h1>Page not found</h1>
<p>The page you requested is not in this static snapshot. Try search in the sidebar or return to <a href="index.html">Home</a>.</p>`;
  return layout({
    title: "Not found",
    body,
    nav,
    active: "",
    includeSearch: true,
  });
}

function main() {
  const src = wikiSource();
  console.log(`wiki source: ${src}`);
  syncWikiIntoRepo(src);

  const files = readdirSync(src).filter(
    (f) => f.endsWith(".md") && !f.startsWith("."),
  );
  const pages = new Set(listWikiPages(src));

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
  cpSync(join(SITE, "search.js"), join(DIST, "assets", "search.js"));

  const searchEntries = [];

  for (const file of files) {
    if (file === "_Sidebar.md") continue;
    const name = slug(file);
    const md = readFileSync(join(src, file), "utf8");
    let body = marked.parse(md, { async: false });
    body = rewriteWikiLinks(body, pages);
    body = stripWorkspacePathLinks(body);
    body = enhanceAccessibility(body);

    const title = name.replace(/-/g, " ");
    const html = layout({
      title,
      body,
      nav,
      active: name,
    });
    const out = join(DIST, pageHref(name));
    writeFileSync(out, html);
    searchEntries.push({
      title,
      href: pageHref(name),
      text: stripHtml(body),
    });
    console.log(`  ${file} → ${basename(out)}`);
  }

  writeFileSync(
    join(DIST, "assets", "search-index.json"),
    JSON.stringify(buildSearchIndex(searchEntries)),
  );
  writeFileSync(join(DIST, "404.html"), notFoundPage(nav));

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
