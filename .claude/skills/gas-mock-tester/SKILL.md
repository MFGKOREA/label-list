---
name: gas-mock-tester
description: Google Apps Script Web App (Code.gs) local simulator and mock testing patterns. Use when testing doGet/doPost APIs, verifying status polling (?api=1&status=1), auditing Google Sheet quota usage, or testing concurrency and fallback logic without hitting live Google servers.
metadata:
  domain: F&B Order Automation
  target: label-list/apps-script
---

# Google Apps Script Mock Tester

A comprehensive testing suite and pattern guide for local simulation of Google Apps Script Web App APIs (`Code.gs`), sheet reads/writes, and client pollers (`mis-agent.js`, `gw-agent`).

## 1. Core Architecture & API Contracts

In `label-list`, the Google Apps Script Web App serves as a lightweight queue and data store:

```
[Phone PWA / Web Client]
        │
        ▼ (POST { action: "save", misPush: { ... } })
┌─────────────────────────────────────────────────────────────┐
│                    Google Apps Script (Code.gs)             │
│  - doGet(e): ?api=1 (full), ?status=1 (light), ?ver=1       │
│  - doPost(e): atomic row writes, JSON deserialization       │
└─────────────────────────────────────────────────────────────┘
        ▲
        │ (Poll GET ?api=1&status=1 every 3~5s)
[Store PC Chrome Extension (gw-agent) / mis-agent.js]
```

### Key Request Patterns
- **Lightweight Status Poll**: `GET /exec?api=1&status=1&t=12345`
  - Returns: `{ ok: true, misPush: { status: "pending", by: "..." }, ver: "..." }`
  - Avoids reading full sheet content (~370KB payload).
- **Version Check**: `GET /exec?api=1&ver=1`
  - Returns: `{ ok: true, ver: "..." }`
- **Full Payload Fetch**: `GET /exec?api=1&t=12345`
  - Returns full sheet contents for order details.
- **Queue State Mutation**: `POST /exec`
  - Body: `{ action: "push", misPush: { status: "done", saved: N, total: N } }`

---

## 2. Local Node.js GAS Mock Server

Use this lightweight mock server to test clients (`mis-agent.js`, `bg.js`) locally without internet or Google quota consumption:

```javascript
// test/mocks/gas-server.mjs
import http from 'node:http';
import url from 'node:url';

export function createGasMockServer(port = 8888) {
  let state = {
    ver: '1.0.0',
    misPush: { status: 'idle', date: '2026-10-26', by: '' },
    salesPush: { status: 'idle' },
    misAgent: { at: Date.now() },
    items: []
  };

  const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    if (req.method === 'GET' && parsed.query.api === '1') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      // 1) ver only
      if (parsed.query.ver === '1') {
        return res.end(JSON.stringify({ ok: true, ver: state.ver }));
      }
      // 2) status poll only (lightweight)
      if (parsed.query.status === '1') {
        return res.end(JSON.stringify({
          ok: true,
          misPush: state.misPush,
          salesPush: state.salesPush,
          misAgent: state.misAgent,
          ver: state.ver
        }));
      }
      // 3) full fetch
      return res.end(JSON.stringify({
        ok: true,
        ver: state.ver,
        misPush: state.misPush,
        salesPush: state.salesPush,
        items: state.items
      }));
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          if (payload.action === 'save' || payload.action === 'push') {
            if (payload.misPush) state.misPush = { ...state.misPush, ...payload.misPush };
            if (payload.salesPush) state.salesPush = { ...state.salesPush, ...payload.salesPush };
            state.ver = String(Date.now());
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, ver: state.ver }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return {
    server,
    start: () => new Promise(resolve => server.listen(port, resolve)),
    stop: () => new Promise(resolve => server.close(resolve)),
    getState: () => state,
    setState: (next) => { state = { ...state, ...next }; }
  };
}
```

---

## 3. Test Scenarios Checklist

When modifying `apps-script/order/Code.gs` or `mis-agent.js`, always verify:

1. **Fallback Compatibility**:
   - Does `mis-agent.js` gracefully fall back to full fetch if `?status=1` returns an older array-style response?
2. **Double Execution Prevention**:
   - If two agent tabs open simultaneously, does `by` (tab lock identifier) prevent conflicting order entries?
3. **Quota Consumption Audit**:
   - Ensure `status_()` uses `readKeys_()` and never invokes `readAll_()` or `Sheet.getDataRange().getValues()`.
   - Polling frequency should stay at 3~5s when active, 20~30s when idle.
4. **Data Sanitization**:
   - Verify that unexpected characters (quotes, tabs, CRLF) in order memos do not corrupt TSV/JSON serialization.
