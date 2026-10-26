---
name: fnb-loss-calculator
description: F&B kitchen ingredient unit conversions, package rounding (입수량), shelf-life (유통기한/소비기한) end-of-month date math, prep scaling, and order anomaly audit logic. Use when modifying order calculation formulas, expiry calculation helpers, forecast bias tuning, or unit conversion rules.
metadata:
  domain: F&B Kitchen Operations & Loss Prevention
  target: label-list/order-src, label-list/index.html
---

# F&B Loss & Order Calculator

A specialized domain knowledge and calculation skill for restaurant kitchen ingredient order sizing, shelf-life date arithmetic, and waste loss prevention.

## 1. Shelf-Life (유통기한 / 소비기한) Arithmetic

In Korean food hygiene compliance (`index.html`), shelf-life calculations must strictly adhere to statutory labeling rules.

### Three Calculation Modes:
1. **`mode: "date"` (Direct Date)**:
   - Expiration date is explicitly stamped on the packaging (e.g., `2026-10-31`).
   - D-Day formula: `daysLeft = Math.round((parse(expiry) - today()) / 86400000)`.
2. **`mode: "period"` (Manufacturing Date + Duration)**:
   - Example: Manufacturing date `2026-07-31` + `1개월`.
   - **Critical Rule: End-of-Month Clamping**: Adding 1 month to July 31st must land on August 31st; adding 1 month to August 31st must clamp to September 30th (never overflow into October 1st).
   ```javascript
   function addPeriod(mfgISO, num, unit) {
     const [y, m, d] = mfgISO.split('-').map(Number);
     const date = new Date(y, m - 1, d);
     if (unit === 'd') {
       date.setDate(date.getDate() + num);
       return toISO(date);
     }
     const months = unit === 'y' ? num * 12 : num;
     const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
     const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
     target.setDate(Math.min(date.getDate(), lastDay));
     return toISO(target);
   }
   ```
3. **`mode: "pack"` (Packaging Date Only)**:
   - Items with only packaging dates (e.g. 감말랭이, 농산물 소분) are excluded from strict D-Day countdown.

### Alert Thresholds:
- **`D-0` (D-DAY)**: Expiring today (Immediate kitchen consumption or discard).
- **`D-1 ~ D-3`**: Imminent expiry risk (Pickle automatic notification threshold).
- **`D-4 ~ D-7` (`exp` / 코랄)**: High priority stock rotation (FIFO - First In, First Out).
- **`D-8 ~ D-30` (`soon` / 주황)**: Attention needed.
- **`> 30` (`ok` / 초록)**: Safe buffer.

---

## 2. Order Quantity & Minimum Pack Sizing (입수량 올림 계산)

Ingredients cannot be ordered in fractional quantities. MIS requires ordering by standard pack size (입수량).

### Formula:
$$\text{Order Qty (Packs)} = \left\lceil \frac{\max(0, \text{Required Prep} + \text{Safety Stock} - \text{Current Inventory})}{\text{Pack Unit Size}} \right\rceil$$

```javascript
function calcOrderPacks(needed, currentStock, packSize) {
  const shortage = Math.max(0, needed - currentStock);
  if (shortage === 0) return 0;
  return Math.ceil(shortage / packSize);
}
```

---

## 3. Order Anomaly Auditing (Sanity Verification)

Before transmitting to MIS via GW, detect abnormal deviations:
1. **Spike Alert**: If $\text{Today Order} \ge 2.5 \times \text{Avg Order of same weekday}$ and not flagged as a private banquet/event, raise a warning.
2. **Zero Order Sanity**: If a high-volume base sauce (e.g. 갈릭칠리오일베이스, 화이트소스) calculates to 0 on a Friday/Saturday, prompt a double-check on current stock entry.
3. **Residual Cleanout**: All items with `QT_ORDER > 0` in MIS that are not in today's order must be explicitly reset to `0` to prevent accidental ghost orders.
