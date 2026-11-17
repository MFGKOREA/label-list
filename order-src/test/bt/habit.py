# KM 발주 습관 되돌려 보기 (11/15 KM "2주안 기획들 실행해", 기획안 1번 "발주 초안" 준비)
#  KM이 실제로 넣은 발주 = MIS 주문현황(misOrder.날짜) · 그게 없는 날은 앱 발주칸(KM이 앱으로 5줄 넘게 넣은 날만. 적은 날은 MIS에만 넣은 날일 수 있어 뺌)
#  날마다 그 전 날들만으로 품목별 습관을 배워(걸어가며 시험) 그날 KM 발주와 비교. 앱 추천 = 그날 KM이 본 값(input.r)
#  같은 칸끼리만 비교: 센 날(예상 재고 말고) · 앱 추천이 있는 칸 · 그 품목의 지난 기록 4일 이상 · 그날 발주 가능 · 신규 품목 뺌
#  잣대 "하루 고칠 줄" = 초안을 KM 발주로 만들려면 고쳐야 하는 줄 수(넣기·빼기·수량 바꾸기). 초안은 이게 줄어야 쓸모 있음
# 사용: node order-src/test/bt/habit-items.mjs kv.json items.json && python3 -I order-src/test/bt/habit.py kv.json items.json
#  (화면에 품목 이름·숫자가 나옴. 결과는 저장소에 넣지 않음)
import json, sys, statistics as st, collections, datetime as dt, math
kv, items_path = sys.argv[1], sys.argv[2]
raw = json.load(open(kv)); D = raw.get("data", raw); items = json.load(open(items_path)); by = {i["key"]: i for i in items}
num = lambda x: (float(x) if str(x).strip() not in ("", "None") else None)
days = sorted(k[6:] for k in D if k.startswith("input."))
mis = {k[9:]: D[k] for k in D if k.startswith("misOrder.") and isinstance(D[k], dict) and isinstance(D[k].get("rows"), list)}
appO = {d: sum(1 for v in D["input." + d].values() if isinstance(v, dict) and (num(v.get("o")) or 0) > 0) for d in days}
dec = [d for d in sorted(set(days) | set(mis)) if d in mis or appO.get(d, 0) >= 5]
wd = lambda d: dt.date.fromisoformat(d).weekday()
W = "월화수목금토일"
R = lambda x: math.floor(x + 0.5)
rec = collections.defaultdict(dict)
for it in items:
    key, codes, f = it["key"], set(it["codes"]), (it["box"] or 1)
    for d in dec:
        v = (D.get("input." + d) or {}).get(key) or {}
        s = num(v.get("s")) if isinstance(v, dict) and not v.get("est") else None
        q = sum(num(r.get("qty")) or 0 for r in mis[d]["rows"] if str(r.get("code")) in codes) if d in mis else (num(v.get("o")) or 0)
        r = num(v.get("r")) if isinstance(v, dict) else None
        rec[key][d] = {"s": None if s is None else s * f, "q": q, "r": r, "can": it["can"].get(d, True) is not False}

def thresh(hist):  # (s <= T)가 (q > 0)과 가장 잘 맞는 재고 문턱. 동점이면 큰 쪽(더 자주 제안)
    best, T = -1, -1.0
    for t in sorted(set([-1.0] + [s for s, _ in hist])):
        a = sum((s <= t) == (q > 0) for s, q in hist)
        if a >= best: best, T = a, t
    return T

M = ["앱 추천", "H1 재고 문턱 + 늘 시키는 양", "H2 재고 문턱 + 채울 수준", "A 앱 + KM이 늘 시키는 양으로 맞춤", "D 앱 × 품목별 KM 배율", "E 앱 0일 때 미리 시키는 습관(목금토 묶음)"]
res = {m: collections.Counter() for m in M}; edits = {m: collections.Counter() for m in M}
evdays = set(); gap = collections.Counter(); gapW = collections.Counter(); gapItem = collections.Counter(); bothC = collections.Counter(); ratio = []
for key, dd in rec.items():
    it = by[key]
    if it["isNew"]: continue
    mult = it["mult"] or 1
    seq = [d for d in dec if d in dd]
    for i, d in enumerate(seq):
        x = dd[d]
        if x["s"] is None or x["r"] is None or not x["can"]: continue
        hs = [(dd[e]["s"], dd[e]["q"]) for e in seq[:i] if dd[e]["s"] is not None and dd[e]["can"]]
        hr = [(e, dd[e]) for e in seq[:i] if dd[e]["r"] is not None and dd[e]["can"]]
        if len(hs) < 4 or len(hr) < 4: continue
        evdays.add(d)
        r, q = x["r"], x["q"]
        qs = [b for _, b in hs if b > 0]
        T = thresh(hs); Q = st.median(qs) if qs else 0
        P = st.median([a + b * mult for a, b in hs if b > 0]) if qs else None
        h1 = Q if x["s"] <= T else 0
        h2 = ((max(1, R((P - x["s"]) / mult)) if P is not None and P > x["s"] else Q) if x["s"] <= T else 0)
        mo = collections.Counter(qs).most_common(1)[0] if qs else None
        a = mo[0] if (r > 0 and mo and len(qs) >= 3 and mo[1] / len(qs) >= 0.6 and abs(r - mo[0]) <= 1) else r
        rat = [y["q"] / y["r"] for _, y in hr if y["q"] > 0 and y["r"] > 0]
        dq = (max(1, R(r * st.median(rat))) if len(rat) >= 3 else r) if r > 0 else 0
        g = lambda e: wd(e) in (3, 4, 5)
        z = [y for e, y in hr if y["r"] == 0 and g(e) == g(d)]; zh = [y["q"] for y in z if y["q"] > 0]
        ee = (st.median(zh) if len(z) >= 2 and len(zh) / len(z) >= 0.5 else 0) if r == 0 else r
        for m, v in zip(M, [r, h1, h2, a, dq, ee]):
            c = res[m]; c["n"] += 1; c["exact"] += abs(v - q) < 1e-9
            if q > 0: c["kmo"] += 1; c["kmo_exact"] += abs(v - q) < 1e-9; c["kmo_pm1"] += abs(v - q) <= 1 + 1e-9; c["kmo_hit"] += v > 0
            else: c["kmz"] += 1; c["kmz_extra"] += v > 0
            if abs(v - q) > 1e-9: edits[m][d] += 1
        if q > 0 and r == 0: gap["n"] += 1; gapW[W[wd(d)]] += 1; gapItem[it["name"]] += 1
        if q > 0: gap["kmo"] += 1
        if q > 0 and r > 0: bothC["n"] += 1; bothC["same"] += q == r; bothC["more"] += q > r; bothC["less"] += q < r; ratio.append(q / r)
pct = lambda a, b: f"{100 * a / b:.1f}%" if b else "-"
nd = len(evdays)
print(f"KM 발주를 아는 날 {len(dec)}일 ({dec[0]}~{dec[-1]}, 앱 발주칸으로 본 날 {sum(1 for d in dec if d not in mis)}일) · 비교한 날 {nd}일 · 칸 {res['앱 추천']['n']}개")
print("| 방법 | 그대로 맞음 | KM 시킨 줄: 수량 같음 | ±1 | 시키자고 함 | KM 안 시킨 줄에 괜히 | 하루 고칠 줄 |")
for m in M:
    c = res[m]
    print(f"| {m} | {pct(c['exact'], c['n'])} | {pct(c['kmo_exact'], c['kmo'])} | {pct(c['kmo_pm1'], c['kmo'])} | {pct(c['kmo_hit'], c['kmo'])} | {pct(c['kmz_extra'], c['kmz'])} | {sum(edits[m].values()) / max(1, nd):.1f} |")
print(f"KM이 시킨 줄 {gap['kmo']} 중 앱이 0이던 줄 {gap['n']} ({pct(gap['n'], gap['kmo'])}) · 요일 {dict(gapW)}")
print("  많은 품목:", ", ".join(f"{k} {v}" for k, v in gapItem.most_common(6)))
if ratio: print(f"둘 다 시킨 줄 {bothC['n']}: KM이 더 많이 {bothC['more']} · 같음 {bothC['same']} · 적게 {bothC['less']} · KM÷앱 가운데 {st.median(ratio):.2f}")
