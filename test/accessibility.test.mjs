import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import axe from "axe-core";
import { JSDOM } from "jsdom";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** First-wave pages audited for WCAG 2.2 AA shell semantics. */
const FIRST_WAVE_PAGES = [
  "index.html",
  "Core-Concepts.html",
  "Getting-Started.html",
  "Configuration-Reference.html",
  "Port-Map.html",
];

/** Second-wave pages: architecture and module reference docs. */
const SECOND_WAVE_PAGES = [
  "Architecture.html",
  "Module-System.html",
  "Writing-Modules.html",
  "Contracts.html",
  "Event-System.html",
];

const AUDITED_PAGES = [...FIRST_WAVE_PAGES, ...SECOND_WAVE_PAGES];

/** Pages that ship data tables in main content. */
const PAGES_WITH_TABLES = new Set([
  "Architecture.html",
  "Module-System.html",
  "Contracts.html",
  "Event-System.html",
  "Configuration-Reference.html",
  "Port-Map.html",
]);

function loadPage(file) {
  const html = readFileSync(join(ROOT, "dist", file), "utf8");
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

before(() => {
  execSync("node build.mjs", {
    cwd: ROOT,
    stdio: "pipe",
    env: { ...process.env, MUXCORE_DOCS_SKIP_WIKI_SYNC: "1" },
  });
});

describe("muxcore-docs page shell accessibility", () => {
  for (const file of AUDITED_PAGES) {
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
        const dom = loadPage(file);
        const { document } = dom.window;
        const current = document.querySelector('nav[aria-label="Pages"] [aria-current="page"]');
        assert.ok(current, "active nav link exposes aria-current=page");
        assert.match(current.className, /\bactive\b/);
      });

      it("passes axe WCAG 2.2 AA rules", async () => {
        const dom = loadPage(file);
        const results = await runAxe(dom);
        const violations = results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`);
        assert.deepEqual(violations, [], violations.join("\n"));
      });

      if (PAGES_WITH_TABLES.has(file)) {
        it("scopes table column headers", () => {
          const dom = loadPage(file);
          const { document } = dom.window;
          const headers = document.querySelectorAll("main table thead th");
          assert.ok(headers.length > 0, "page includes at least one data table");
          for (const th of headers) {
            assert.equal(th.getAttribute("scope"), "col", `missing scope on: ${th.textContent}`);
          }
        });
      }

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
