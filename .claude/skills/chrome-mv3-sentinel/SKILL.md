---
name: chrome-mv3-sentinel
description: Chrome Extension Manifest V3 security, Service Worker lifecycle resilience, cross-frame DOM automation, and dialog handling patterns. Use when modifying gw-agent, bg.js, content scripts, handling legacy intranet framesets, or debugging service worker sleep/timeout issues.
metadata:
  domain: Browser Automation & Legacy MIS Integration
  target: label-list/gw-agent
---

# Chrome Extension MV3 Sentinel

A defensive engineering guide for Chrome Extension Manifest V3 (`gw-agent`) integrating modern web extensions with legacy corporate intranet systems (Groupware & ERP/MIS).

## 1. Manifest V3 Service Worker Lifecycle & Keepalive

### The Problem: 30-Second Inactivity Termination
Manifest V3 background service workers (`bg.js`) terminate after 30 seconds of inactivity. If a user triggers GW transfer, the extension must wake up immediately and maintain execution.

### Resilient Architecture in `gw-agent`:
1. **Alarms API for Periodic Heartbeats**:
   ```javascript
   // bg.js
   chrome.alarms.create('gw-tick', { periodInMinutes: 0.5 }); // 30s tick
   chrome.alarms.onAlarm.addListener((alarm) => {
     if (alarm.name === 'gw-tick') {
       pollSheetState();
     }
   });
   ```
2. **Dynamic High-Frequency Polling During Pending Tasks**:
   When `misPush.status === 'pending'` is detected, switch from 30s alarms to 3s interval polling via active tab messaging or continuous alarms until completion.
3. **External Watcher Fallback (`gw-watch.ps1`)**:
   If the Chrome browser is fully closed by accident, a Windows background script monitors the Google Sheet queue and relaunches Chrome in minimized mode.

---

## 2. Legacy Frameset & Iframe Navigation Patterns

Legacy enterprise systems (like Mad for Garlic Groupware & MIS) often use nested `<frameset>` and `<iframe>` structures (`TopFrame`, `LeftFrame`, `MainFrame`).

### Safe Frame Detection:
```javascript
// Never rely on window.top alone; check frame URL and distinct DOM elements:
function findReportFrame(frames) {
  for (let i = 0; i < frames.length; i++) {
    try {
      const f = frames[i];
      const doc = f.document;
      // Skip navigation menus
      if (f.location.href.includes('LeftFrame')) continue;
      // Identify true report/grid container
      if (doc.querySelector('#grid1') || doc.querySelector('input.datebox')) {
        return f;
      }
    } catch (e) {
      // Cross-origin security error guard
    }
  }
  return null;
}
```

---

## 3. Neutralizing Blocking Dialogs (`alert`, `confirm`)

Headless or minimized store PCs freeze forever if the intranet triggers a native `alert("주문 가능 시간이 아닙니다")` or `confirm("저장하시겠습니까?")`.

### Injection Hook (Run at `document_start`):
```javascript
// Inject into content scripts:
const code = `
  window.alert = function(msg) {
    console.warn('[Auto-Dismiss Alert]:', msg);
    window.__lastAlertMsg = msg;
    return true;
  };
  window.confirm = function(msg) {
    console.warn('[Auto-Approve Confirm]:', msg);
    return true; // Always confirm save actions
  };
`;
const script = document.createElement('script');
script.textContent = code;
(document.head || document.documentElement).appendChild(script);
script.remove();
```

---

## 4. Credential & State Hygiene (`chrome.storage.local`)

1. **Local Isolation Only**: Credentials (GW ID/PW) must live strictly in `chrome.storage.local` on that physical PC.
2. **Never Transmit Passwords**: The cloud sheet queue must only contain task triggers (`misPush`), item codes, and quantities—never user passwords or personal tokens.
3. **Rate Limiting Auth Failures**: Limit login attempts to at most 2 times per 30 minutes to prevent account lockouts due to network glitches.
