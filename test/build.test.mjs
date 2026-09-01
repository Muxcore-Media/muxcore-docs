import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  LOCAL_WIKI,
  SIBLING_WIKI,
  listWikiPages,
  parseSidebar,
  rewriteWikiLinks,
  sidebarPageSlugs,
  stripWorkspacePathLinks,
  wikiSource,
} from "../lib/build-utils.mjs";

const ROOT = join(import.meta.dirname, "..");
const WIKI = join(ROOT, "wiki");

describe("wikiSource", () => {
  it("defaults to committed ./wiki when Home.md exists", () => {
    assert.ok(existsSync(join(LOCAL_WIKI, "Home.md")));
    const src = wikiSource({ MUXCORE_DOCS_SKIP_WIKI_SYNC: "1" });
    assert.equal(src, LOCAL_WIKI);
  });

  it("prefers ./wiki over ../core.wiki when both exist", () => {
    if (!existsSync(join(SIBLING_WIKI, "Home.md"))) return;
    const src = wikiSource({});
    assert.equal(src, LOCAL_WIKI);
  });

  it("honors MUXCORE_DOCS_WIKI override", () => {
    const src = wikiSource({ MUXCORE_DOCS_WIKI: "./wiki" });
    assert.equal(src, LOCAL_WIKI);
  });
});

describe("rewriteWikiLinks", () => {
  const pages = new Set(["Home", "Getting-Started", "Port-Map"]);

  it("rewrites wiki-style page links to html", () => {
    const html = '<p><a href="Getting-Started">start</a></p>';
    const out = rewriteWikiLinks(html, pages);
    assert.match(out, /href="Getting-Started\.html"/);
  });

  it("leaves workspace and external links unchanged", () => {
    const html =
      '<a href="../TASKS.md">tasks</a> <a href="https://example.com">x</a>';
    const out = rewriteWikiLinks(html, pages);
    assert.match(out, /href="\.\.\/TASKS\.md"/);
    assert.match(out, /href="https:\/\/example.com"/);
  });
});

describe("parseSidebar", () => {
  it("includes only pages that exist in the wiki", () => {
    const pages = new Set(["Home", "Tasks"]);
    const md = `- [Home](Home)\n- [Tasks](Tasks)\n- [Ghost](Missing-Page)\n- [Nope](Nope)`;
    const links = parseSidebar(md, pages);
    assert.deepEqual(
      links.map((l) => l.page),
      ["Home", "Tasks"],
    );
  });
});

describe("stripWorkspacePathLinks", () => {
  it("replaces ../ paths with workspace-file-ref spans", () => {
    const html = '<a href="../MASTER-ROADMAP.md">roadmap</a>';
    const out = stripWorkspacePathLinks(html);
    assert.match(out, /workspace-file-ref/);
    assert.doesNotMatch(out, /<a href="\.\.\//);
  });
});

describe("sidebar completeness", () => {
  it("lists every wiki page except _Sidebar.md", () => {
    const pages = listWikiPages(WIKI);
    const sidebarMd = readFileSync(join(WIKI, "_Sidebar.md"), "utf8");
    const linked = sidebarPageSlugs(sidebarMd).map((s) => s.replace(/ /g, "-"));
    for (const page of pages) {
      assert.ok(
        linked.some((l) => l.toLowerCase() === page.toLowerCase()),
        `sidebar missing ${page}`,
      );
    }
  });
});

describe("build output", () => {
  it("builds from ./wiki with sync disabled", () => {
    execSync("node build.mjs", {
      cwd: ROOT,
      stdio: "pipe",
      env: {
        ...process.env,
        MUXCORE_DOCS_SKIP_WIKI_SYNC: "1",
      },
    });
    const info = readFileSync(join(ROOT, "dist", ".build-info"), "utf8");
    assert.match(info, new RegExp(`source=${LOCAL_WIKI.replace(/\\/g, "\\\\")}`));
    assert.ok(existsSync(join(ROOT, "dist", "Installer-Pin-Matrix.html")));
    assert.ok(existsSync(join(ROOT, "dist", "404.html")));
    assert.ok(existsSync(join(ROOT, "dist", "assets", "search-index.json")));

    const htmlPages = readdirSync(join(ROOT, "dist")).filter((f) =>
      f.endsWith(".html"),
    );
    for (const file of htmlPages) {
      const html = readFileSync(join(ROOT, "dist", file), "utf8");
      assert.doesNotMatch(
        html,
        /<main[^>]*>[\s\S]*<a href="\.\.\//,
        `${file} must not link ../ in main`,
      );
    }
  });
});
