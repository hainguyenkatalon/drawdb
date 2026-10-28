import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

const modulePath = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(
  modulePath?.startsWith("/")
    ? pathToFileURL(modulePath).href
    : modulePath || "playwright-core"
);
const output =
  process.env.TEST_ARTIFACT_DIR ||
  (await fs.mkdtemp(path.join(os.tmpdir(), "drawdb-save-as-")));
await fs.mkdir(output, { recursive: true, mode: 0o700 });
const report = {
  runner: "Node + Playwright (independent app test; not Loki Runner)",
  startedAt: new Date().toISOString(),
  checkpoints: [],
  errors: [],
};
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  locale: "en-US",
  viewport: { width: 1440, height: 1000 },
});
report.initialInventory = context.pages().map((p) => p.url());
await context.tracing.start({ screenshots: true, snapshots: true });
const page = await context.newPage();
page.on("pageerror", (e) => report.errors.push(e.message));
page.setDefaultTimeout(15000);
const snapshot = async (name) => {
  const text = await page.locator("body").innerText();
  await fs.writeFile(path.join(output, name + ".txt"), text);
  await page.screenshot({
    path: path.join(output, name + ".png"),
    fullPage: true,
  });
  report.checkpoints.push({
    name,
    url: page.url(),
    text,
    at: new Date().toISOString(),
  });
};
const rows = () =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("drawDB");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("diagrams", "readonly");
          const query = tx.objectStore("diagrams").getAll();
          query.onsuccess = () => resolve(query.result);
          query.onerror = () => reject(query.error);
          tx.oncomplete = () => db.close();
        };
      }),
  );
// Opening a diagram can autosave its last-modified timestamp. Compare all
// persisted content/identity fields when checking isolation across reopening.
const content = ({ lastModified, ...diagram }) => diagram;
async function waitForRows(predicate) {
  const end = Date.now() + 15000;
  let result;
  do {
    result = await rows();
    if (predicate(result)) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < end);
  assert.fail(
    "Persistent rows did not reach expected state: " + JSON.stringify(result),
  );
}
async function fileMenu(item) {
  await page.getByText("File", { exact: true }).hover();
  await page
    .locator(".semi-dropdown-item:visible")
    .filter({ has: page.getByText(item, { exact: true }) })
    .click();
}
try {
  await page.goto((process.env.APP_URL || "http://127.0.0.1:5173") + "/editor");
  await page.getByText("MySQL", { exact: true }).click();
  await page.getByText("Confirm", { exact: true }).click();
  await page.getByText("Add table", { exact: true }).click();
  await page.waitForURL(/\/editor\/diagrams\//);
  await fileMenu("Rename");
  await page
    .locator(".semi-modal:visible")
    .getByPlaceholder("Name", { exact: true })
    .fill("Diagram-1");
  await page
    .locator(".semi-modal:visible")
    .getByText("Rename", { exact: true })
    .last()
    .click();
  await fileMenu("Save");
  report.originalRows = await waitForRows((r) =>
    r.some((d) => d.name === "Diagram-1"),
  );
  report.originalURL = page.url();
  await fileMenu("Open");
  await page
    .locator(".semi-modal:visible")
    .getByText("Diagram-1", { exact: true })
    .waitFor();
  await snapshot("before-save-as");
  await page
    .locator(".semi-modal:visible")
    .getByText("Cancel", { exact: true })
    .last()
    .click();
  await fileMenu("Save as");
  await page
    .locator(".semi-modal:visible")
    .getByPlaceholder("Name", { exact: true })
    .fill("Diagram-2");
  await page
    .locator(".semi-modal:visible")
    .getByText("Save as", { exact: true })
    .last()
    .click();
  await page.locator(".semi-modal:visible").waitFor({ state: "hidden" });
  report.afterRows = await waitForRows((r) =>
    r.some((d) => d.name === "Diagram-2"),
  );
  report.copyURL = page.url();
  await fileMenu("Open");
  await page
    .locator(".semi-modal:visible")
    .getByText("Diagram-2", { exact: true })
    .waitFor();
  await snapshot("after-save-as");
  const names = await page
    .locator(".semi-modal:visible")
    .locator("tbody tr td:first-child")
    .allTextContents();
  report.savedListNames = names;
  assert.deepEqual([...names].sort(), ["Diagram-1", "Diagram-2"]);
  assert.equal(report.afterRows.length, 2);
  const original = report.afterRows.find((d) => d.name === "Diagram-1");
  const copy = report.afterRows.find((d) => d.name === "Diagram-2");
  assert.deepEqual(
    original,
    report.originalRows.find((d) => d.name === "Diagram-1"),
    "Original record must remain unchanged",
  );
  assert.notEqual(original.diagramId, copy.diagramId);
  assert.notEqual(original.id, copy.id);
  for (const key of [
    "tables",
    "references",
    "notes",
    "areas",
    "database",
    "pan",
    "zoom",
  ])
    assert.deepEqual(copy[key], original[key], key + " must be copied");
  assert.notEqual(report.originalURL, report.copyURL);
  await page
    .locator(".semi-modal:visible")
    .getByText("Cancel", { exact: true })
    .last()
    .click();

  // Reopening must use the active diagram title, and cancel/empty input must
  // leave the two saved records alone.
  await fileMenu("Save as");
  const dialog = () => page.locator(".semi-modal:visible");
  assert.equal(
    await dialog().getByPlaceholder("Name", { exact: true }).inputValue(),
    "Diagram-2",
  );
  await dialog().getByPlaceholder("Name", { exact: true }).fill("");
  assert.equal(
    await dialog()
      .locator("button")
      .filter({ hasText: /^Save as$/ })
      .isDisabled(),
    true,
  );
  await dialog()
    .getByPlaceholder("Name", { exact: true })
    .fill("Cancelled copy");
  await dialog().getByText("Cancel", { exact: true }).last().click();
  assert.equal((await rows()).length, 2);
  report.cancelAndEmptyName = "pass";

  // Editing/saving the copy must not change the original, including after a
  // reload and reopening the original through the saved-diagram list.
  await page.getByText("Add table", { exact: true }).click();
  await fileMenu("Save");
  await waitForRows(
    (r) => r.find((d) => d.name === "Diagram-2")?.tables.length === 2,
  );
  await page.reload();
  await page.getByText("Diagram-2", { exact: true }).waitFor();
  await fileMenu("Open");
  await dialog().getByText("Diagram-1", { exact: true }).click();
  await dialog().getByText("Open", { exact: true }).last().click();
  await page.waitForURL(report.originalURL);
  await page.getByText("Diagram-1", { exact: true }).waitFor();
  report.afterCopyEdit = await rows();
  assert.deepEqual(
    content(report.afterCopyEdit.find((d) => d.name === "Diagram-1")),
    content(original),
  );
  assert.equal(
    report.afterCopyEdit.find((d) => d.name === "Diagram-2").tables.length,
    2,
  );
  await snapshot("original-after-copy-edit");
  report.copyEditIsolation = "pass";

  // Toggle the real setting; Save As must explicitly persist even with
  // autosave disabled. An injected storage failure must leave identity and
  // records intact and keep the modal available for correction/retry.
  await page.getByText("Settings", { exact: true }).hover();
  await page
    .locator(".semi-dropdown-item:visible")
    .filter({ has: page.getByText("Autosave", { exact: true }) })
    .click();
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("settings")).autosave,
    ),
    false,
  );
  await fileMenu("Save as");
  await dialog().getByPlaceholder("Name", { exact: true }).fill("Diagram-3");
  const beforeFailure = await rows();
  await page.evaluate(() => {
    window.originalDiagramAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === "diagrams")
        throw new DOMException(
          "Injected storage failure",
          "QuotaExceededError",
        );
      return window.originalDiagramAdd.apply(this, args);
    };
  });
  await dialog().getByText("Save as", { exact: true }).last().click();
  await page
    .getByText("Oops! Something went wrong.", { exact: true })
    .waitFor();
  assert.equal(await dialog().isVisible(), true);
  assert.equal(page.url(), report.originalURL);
  assert.deepEqual(await rows(), beforeFailure);
  await snapshot("storage-failure");
  await page.evaluate(() => {
    IDBObjectStore.prototype.add = window.originalDiagramAdd;
    delete window.originalDiagramAdd;
  });
  report.saveFailurePreservation = "pass";
  await dialog().getByText("Save as", { exact: true }).last().click();
  await dialog().waitFor({ state: "hidden" });
  await page.waitForURL((url) => url.href !== report.originalURL);
  report.finalRows = await waitForRows((r) =>
    r.some((d) => d.name === "Diagram-3"),
  );
  assert.equal(report.finalRows.length, 3);
  assert.deepEqual(
    content(report.finalRows.find((d) => d.name === "Diagram-1")),
    content(original),
  );
  assert.deepEqual(
    report.finalRows.find((d) => d.name === "Diagram-3").tables,
    original.tables,
  );
  await page.reload();
  await page.getByText("Diagram-3", { exact: true }).waitFor();
  await fileMenu("Open");
  await dialog().getByText("Diagram-3", { exact: true }).waitFor();
  await snapshot("autosave-off-after-reload");
  report.autosaveOffAndRetry = "pass";
  assert.deepEqual(report.errors, [], "Unexpected browser application errors");
  report.status = "pass";
} catch (error) {
  report.status = "fail";
  report.failure = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
  await snapshot("failure").catch(() => {});
  process.exitCode = 1;
} finally {
  await context.tracing.stop({ path: path.join(output, "trace.zip") });
  report.beforeCleanup = context
    .pages()
    .map((p) => ({ url: p.url(), closed: p.isClosed() }));
  for (const owned of context.pages()) await owned.close();
  report.afterCleanup = context
    .pages()
    .map((p) => ({ url: p.url(), closed: p.isClosed() }));
  await context.close();
  await browser.close();
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(
    path.join(output, "result.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        status: report.status,
        failure: report.failure?.message,
        savedListNames: report.savedListNames,
        originalURL: report.originalURL,
        copyURL: report.copyURL,
        cleanup: report.afterCleanup,
        report: path.join(output, "result.json"),
      },
      null,
      2,
    ),
  );
}
