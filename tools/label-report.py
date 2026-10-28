#!/usr/bin/env python3
"""한글표시사항 리스트 아침 리포트: 39개 매장 데이터를 읽어 요약을 출력합니다.
쓰는 법: python3 tools/label-report.py  (결과는 마크다운으로 화면에 출력)
"""
import json, re, ssl, urllib.request, datetime, concurrent.futures as cf

PAGE = "https://mfgkorea.github.io/label-list/"
KST = datetime.timezone(datetime.timedelta(hours=9))

def get(url, timeout=40):
    req = urllib.request.Request(url, headers={"User-Agent": "label-report"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8")

def stores():
    html = get(PAGE + "?t=" + str(datetime.datetime.now().timestamp()))
    hub = re.search(r'const HUB = "([^"]+)"', html).group(1)
    out = {}
    for code, name, api in re.findall(r'^\s+(\w+): \{ name: "([^"]+)", api: ([^}]+?) \}', html, re.M):
        api = api.strip()
        out[code] = (name, hub if api == "HUB" else api.strip('"'))
    return hub, out

def add(iso, num, unit):
    y, m, d = map(int, iso.split("-"))
    if unit == "y": y += num
    elif unit == "m":
        m += num; y += (m - 1) // 12; m = (m - 1) % 12 + 1
    else:
        return datetime.date(y, m, d) + datetime.timedelta(days=num)
    import calendar
    return datetime.date(y, m, min(d, calendar.monthrange(y, m)[1]))

def expiry(it):
    try:
        if it.get("mode") == "period" and it.get("mfg"):
            return add(it["mfg"], int(it.get("num") or 0), it.get("unit") or "d")
        if it.get("expiry"):
            return datetime.date.fromisoformat(it["expiry"])
    except Exception:
        return None
    return None

def main():
    today = datetime.datetime.now(KST).date()
    hub, st = stores()
    def load(code):
        name, api = st[code]
        try:
            d = json.loads(get(f"{api}?api=1&store={code}"))
            return code, d if isinstance(d, list) else None
        except Exception:
            return code, None
    with cf.ThreadPoolExecutor(8) as ex:
        data = dict(ex.map(load, st))
    try:
        stats = json.loads(get(hub + "?api=1&stats=1"))
    except Exception:
        stats = {}
    online = sum((stats.get("online") or {}).values())

    rows, failed, total_items = [], [], 0
    for code, (name, _) in st.items():
        lst = data.get(code)
        if lst is None:
            failed.append(name); continue
        items = [x for x in lst if x.get("id") != "__notice__" and x.get("mode") not in ("note", "pack")]
        packs = [x for x in lst if x.get("mode") == "pack"]
        if not items and not packs:
            continue
        total_items += len(items) + len(packs)
        exp, wk, mo = [], [], []
        for x in items:
            e = expiry(x)
            if not e: continue
            n = (e - today).days
            if n < 0: exp.append((n, x["name"]))
            elif n <= 7: wk.append((n, x["name"]))
            elif n <= 30: mo.append((n, x["name"]))
        notice = next((x.get("memo") for x in lst if x.get("id") == "__notice__" and x.get("memo")), "")
        rows.append(dict(name=name, n=len(items) + len(packs), exp=sorted(exp), wk=sorted(wk), mo=mo, notice=notice))

    using = len(rows)
    print(f"# 한글표시사항 아침 리포트 · {today.month}.{today.day} ({'월화수목금토일'[today.weekday()]})\n")
    print(f"- 사용 매장 **{using}곳** / 39곳 · 등록 품목 **{total_items}개** · 지금 접속 {online}명")
    alarm = [r for r in rows if r["exp"] or r["wk"]]
    print(f"- 오늘 조치 필요 매장 **{len(alarm)}곳** (유통기한 지남 또는 7일 이내)\n")
    if alarm:
        print("## 🚨 조치 필요")
        for r in sorted(alarm, key=lambda r: (-len(r["exp"]), -len(r["wk"]))):
            parts = []
            if r["exp"]: parts.append("지남 " + ", ".join(f"{nm}({-n}일)" for n, nm in r["exp"][:5]) + (" 외" if len(r["exp"]) > 5 else ""))
            if r["wk"]: parts.append("7일 이내 " + ", ".join(f"{nm}(D-{n})" for n, nm in r["wk"][:5]) + (" 외" if len(r["wk"]) > 5 else ""))
            print(f"- **{r['name']}** · " + " / ".join(parts))
        print()
    print("## 매장별 현황")
    print("| 매장 | 품목 | 지남 | 7일 이내 | 30일 이내 |\n|---|---|---|---|---|")
    for r in sorted(rows, key=lambda r: -r["n"]):
        print(f"| {r['name']} | {r['n']} | {len(r['exp']) or ''} | {len(r['wk']) or ''} | {len(r['mo']) or ''} |")
    notes = [r for r in rows if r["notice"]]
    if notes:
        print("\n## 📝 매장 전달사항")
        for r in notes: print(f"- {r['name']}: {r['notice'][:80]}")
    if failed:
        print(f"\n⚠️ 데이터를 못 읽은 매장 {len(failed)}곳: {', '.join(failed)}")

if __name__ == "__main__":
    main()
