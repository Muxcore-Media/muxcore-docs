import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import axe from "axe-core";
import { JSDOM } from "jsdom";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST = join(ROOT, "dist");

/** Every HTML page in the static site (Home → index.html). */
const ALL_PAGES = [
  "index.html",
  "404.html",
  "Admin-API.html",
  "Architecture.html",
  "Configuration-Reference.html",
  "Contracts.html",
  "Contributing.html",
  "Core-Concepts.html",
  "Deployment.html",
  "Event-System.html",
  "Getting-Started.html",
  "Installer-Pin-Matrix.html",
  "Module-System.html",
  "Module-TLS-Authentication.html",
  "Port-Map.html",
  "Roadmap.html",
  "Security.html",
  "Spool-and-Marketplace.html",
  "Spool-Security.html",
  "Storage.html",
  "Tasks.html",
  "Workflow-Engine.html",
  "Writing-Modules.html",
];

function loadPage(file) {
  const html = readFileSync(join(DIST, file), "utf8");
  return new JSDOM(html, { url: `http://localhost/${file}` });
}

function runAxe(dom) {
  const { window } = dom;
  const { document } = window;
  globalThis.window = window;
  globalThis.document = document;
  return new Promise((resolvePromise, reject) => {
    axe.run(
      document.body,
      {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag22aa"] },
        // jsdom lacks canvas; contrast needs manual review in a real browser.
        rules: { "color-contrast": { enabled: false } },
      },
      (err, results) => {
        if (err) reject(err);
        else resolvePromise(results);
      },
    );
  });
}

function pageHasDataTables(document) {
  return document.querySelectorAll("main table thead th").length > 0;
}

before(() => {
  execSync("node build.mjs", {
    cwd: ROOT,
    stdio: "pipe",
    env: { ...process.env, MUXCORE_DOCS_SKIP_WIKI_SYNC: "1" },
  });
  const built = readdirSync(DIST)
    .filter((f) => f.endsWith(".html"))
    .sort((a, b) => (a === "index.html" ? -1 : b === "index.html" ? 1 : a.localeCompare(b)));
  assert.deepEqual(built, ALL_PAGES, "dist pages match audited list");
});

describe("muxcore-docs page shell accessibility", () => {
  for (const file of ALL_PAGES) {
    describe(file, () => {
      it("exposes skip link, landmarks, and a single page h1", () => {
        const dom = loadPage(file);
        const { document } = dom.window;

        const skip = document.querySelector(".skip-link");
        assert.ok(skip, "skip link is present");
        assert.equal(skip.getAttribute("href"), "#main-content");

        const main = document.getElementById("main-content");
        assert.ok(main, "main landmark has id main-content");
        assert.equal(main.tagName, "MAIN");
        assert.equal(main.getAttribute("tabindex"), "-1");

        const nav = document.querySelector('nav[aria-label="Pages"]');
        assert.ok(nav, "primary nav is labelled");

        const sidebar = document.querySelector('aside[aria-label="Documentation navigation"]');
        assert.ok(sidebar, "sidebar landmark is labelled");

        const h1s = document.querySelectorAll("main h1");
        assert.equal(h1s.length, 1, "main contains exactly one h1");
      });

      it("marks the active nav item with aria-current", () => {
        if (file === "404.html") return;
        const dom = loadPage(file);
        const { document } = dom.window;
        const current = document.querySelector('nav[aria-label="Pages"] [aria-current="page"]');
        assert.ok(current, "active nav link exposes aria-current=page");
        assert.match(current.className, /\bactive\b/);
      });

      it("does not expose broken workspace path links in main content", () => {
        const dom = loadPage(file);
        const { document } = dom.window;
        const bad = document.querySelectorAll("main a[href^='../']");
        assert.equal(bad.length, 0, "workspace paths use workspace-file-ref, not links");
      });

      it("includes client-side search", () => {
        const dom = loadPage(file);
        const { document } = dom.window;
        const search = document.querySelector("[data-doc-search]");
        assert.ok(search, "search input is present");
        assert.ok(search.labels?.length || search.getAttribute("aria-label"), "search is labelled");
      });

      it("passes axe WCAG 2.2 AA rules", async () => {
        const dom = loadPage(file);
        const results = await runAxe(dom);
        const violations = results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`);
        assert.deepEqual(violations, [], violations.join("\n"));
      });

      it("scopes table column headers when tables are present", () => {
        const dom = loadPage(file);
        const { document } = dom.window;
        if (!pageHasDataTables(document)) return;
        const headers = document.querySelectorAll("main table thead th");
        for (const th of headers) {
          assert.equal(th.getAttribute("scope"), "col", `missing scope on: ${th.textContent}`);
        }
      });

      if (file === "Writing-Modules.html") {
        it("labels static checklist checkboxes", () => {
          const dom = loadPage(file);
          const { document } = dom.window;
          const inputs = document.querySelectorAll('main input[type="checkbox"]');
          assert.ok(inputs.length > 0, "checklist renders checkbox markers");
          for (const input of inputs) {
            assert.ok(input.getAttribute("aria-label"), "checkbox exposes aria-label");
          }
        });
      }
    });
  }
});
