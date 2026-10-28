# Save As regression

Source: [fork issue 1](https://github.com/hainguyenkatalon/drawdb/issues/1).

Save As must keep the original saved diagram and persist a separately named copy. The editor switches to the copy after storage succeeds. A failed save keeps the original active and the dialog open.

## Reproduce from the fork

The preserved baseline is `9428511e77af48ea96404cbf7da3eda13b1a7266` on `demo/save-as-bug`. The fix is on `codex/save-as-preserve-original`; no upstream submission or merge is part of this demo.

```sh
git clone https://github.com/hainguyenkatalon/drawdb.git drawdb-save-as-demo
cd drawdb-save-as-demo
git switch --detach origin/codex/save-as-preserve-original
npm ci
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Record `git rev-parse HEAD` with each result. Stop the server before switching revisions. To inspect the original behavior, switch to the baseline SHA above and restart the same server. Use a fresh browser profile for each revision.

## Manual check

1. Start the app with `npm ci` and `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort`.
2. In a fresh browser profile, open `http://127.0.0.1:5173/editor`, choose MySQL and add a table.
3. Rename the diagram to Diagram-1 and save.
4. Choose File → Save as, enter Diagram-2 and confirm.
5. Open File → Open. Both names must appear.
6. Reopen each diagram and compare its content. Edit and save the copy, reload, then reopen the original; its content must stay unchanged.

The reported baseline renamed the original record: only Diagram-2 appeared and the diagram URL stayed the same.

## Automated check

Requires Node, local Google Chrome and an installed `playwright-core` module. The test can use an existing Playwright installation without changing app dependencies.

To provision the same browser-test library used for this run without changing app dependencies:

```sh
DRAWDB_TEST_TOOLS=$(mktemp -d)
npm install --prefix "$DRAWDB_TEST_TOOLS" --ignore-scripts --no-audit --no-fund playwright-core@1.65.0-alpha-2026-10-26
```

With the development server running:

```sh
PLAYWRIGHT_MODULE="$DRAWDB_TEST_TOOLS/node_modules/playwright-core/index.mjs" node tests/save-as.mjs
```

If `playwright-core` resolves from this repository, `node tests/save-as.mjs` is sufficient. Set `APP_URL` to override the default loopback origin. The test creates a fresh isolated browser context; it does not attach to a user session.

Checks include both saved-list entries, distinct persistent IDs, copied content, subsequent-edit isolation, reload/reopen, cancel, empty names, autosave disabled, and preservation/recovery after an injected IndexedDB write failure. The original record must be completely unchanged immediately after Save As. After reopening, the test compares all fields except `lastModified`, because opening can trigger autosave.

The test prints its result and private artifact directory, and exits nonzero on failure. By default artifacts go to a temporary directory; `TEST_ARTIFACT_DIR` can select a private directory outside the repository. Screenshots, traces and stored browser records belong in private test evidence, not source control. The test closes its own pages, context and browser in its cleanup block. Stop the development server with Ctrl-C.

This is a Node/Playwright app regression test. It does not execute through Loki Runner. Local MySQL/browser storage is covered; cloud extension services and other database-specific content need their own environments.

For an automated baseline comparison, copy `tests/save-as.mjs` to the temporary tools directory before switching to the baseline, then execute that saved script with the same module setting against the restarted baseline server. The saved-list preservation assertion should fail on the baseline. Keep both original result directories.

## Loki demo scope

A fresh Codex CLI session used `gpt-6.1-sol` with high reasoning and the installed local Loki tools for context intake, work-item risk, test planning and supplied-evidence assessment. No application map or prepared fix was supplied. Risk returned no questions; that is not a safety verdict. Related-work discovery was rejected by the demo host budget guard before native dispatch.

Native Loki Runner rejected the local HTTP target at admission because it requires HTTPS. It created no execution or browser evidence and was not retried. The before/after observations came from the independent app regression above, followed by a separately attributed supplied-evidence assessment. This run demonstrates a locally verified app fix with Loki analysis and explicit integration failures; it does not demonstrate successful native Runner execution. No certificate trust, plugin algorithms or models were changed.
