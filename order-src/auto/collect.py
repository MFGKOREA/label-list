#!/usr/bin/env python3
# 자동 수집: 어제까지의 실제 매출(Gross)·날짜별 메뉴 판매가 시트에 없으면 매장 PC(크롬 확장)에 "받아 와 달라"고 요청하고 결과를 확인
#  - 이 스크립트는 GW·MIS에 직접 들어가지 않음(비밀번호도 모름). 시트의 salesPush 칸에 요청을 적으면
#    매장 PC의 확장이 PC에 저장된 로그인으로 GW·MIS를 열어 받아 옴 = 앱의 [Gross 불러오기]·[메뉴 판매 불러오기] 버튼과 같은 길
#  - 시트에 쓰는 것은 salesPush 요청 하나뿐. 쓰기 전 값은 --backup 폴더에 남김(저장소 밖)
#  - 요청하지 않는 때: 받을 게 없음 / 오늘 이미 받아 봄 / PC가 꺼져 있음 / 발주 전송 중 / 발주 시간대(12:30~14:45, 11/12 실제 전송 14:28) / 다른 요청이 도는 중 / 시트가 비정상
# 사용: python3 order-src/auto/collect.py [--dry] [--wait 420] [--days 7] [--force-time] [--backup DIR]
# 끝 코드: 0 최신이거나 받음 · 2 이번엔 건너뜀(나중에 다시) · 3 시트 비정상(아무것도 안 씀) · 4 요청했지만 못 받음
import argparse, datetime, json, os, re, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
API = os.environ.get("ORDER_API_TEST") or re.search(r'DEFAULT_API = "([^"]+)"', open(os.path.join(HERE, "..", "app.js"), encoding="utf-8").read()).group(1)  # ORDER_API_TEST: 시험에서 가짜 서버 주소
KST = datetime.timezone(datetime.timedelta(hours=9))
MIN = 60e3
OFF = 0.0  # 시험에서 시계를 옮길 때(--now)


def nowms():
    return time.time() * 1000 + OFF


def get(q="", tries=3):
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(API + "?api=1" + q + "&t=%d" % (time.time() * 1000), timeout=60) as r:
                j = json.load(r)
            if j.get("ok"):
                return j
            last = j.get("error")
        except Exception as e:  # 네트워크·시간 초과
            last = e
        time.sleep(2 + 3 * i)
    raise SystemExit("시트를 못 읽음: %s" % last)


def post(body):
    req = urllib.request.Request(API, data=json.dumps(body, ensure_ascii=False).encode("utf-8"), headers={"Content-Type": "text/plain;charset=utf-8"})
    with urllib.request.urlopen(req, timeout=90) as r:
        j = json.load(r)
    if not j.get("ok"):
        raise RuntimeError(j.get("error") or "저장 실패")
    return j


def day(d, n=0):
    return (datetime.date.fromisoformat(d) + datetime.timedelta(days=n)).isoformat()


def md(d):
    return "%d/%d" % (int(d[5:7]), int(d[8:10]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true", help="시트에 쓰지 않고 무엇을 할지만 보여 줌")
    ap.add_argument("--wait", type=int, default=420, help="요청 뒤 기다리는 시간(초)")
    ap.add_argument("--days", type=int, default=7, help="며칠 전까지 빈 날을 볼지")
    ap.add_argument("--force-time", action="store_true", help="발주 시간대에도 요청")
    ap.add_argument("--now", help="시험용: 지금 시각을 이 값(한국 시각, 2026-11-13T10:23)으로 봄")
    ap.add_argument("--poll", type=float, default=10, help="결과를 다시 보는 간격(초)")
    ap.add_argument("--resend", type=float, default=150, help="PC가 조용하면 다시 보내기까지(초)")
    ap.add_argument("--backup", default=os.path.join(os.path.expanduser("~"), ".cache", "order-auto"))
    a = ap.parse_args()

    global OFF
    if a.now:
        OFF = datetime.datetime.fromisoformat(a.now).replace(tzinfo=KST).timestamp() * 1000 - time.time() * 1000
    d = get()["data"]
    now = nowms()
    kst = datetime.datetime.fromtimestamp(now / 1000, KST)
    T = kst.date().isoformat()
    Y = day(T, -1)

    # 시트가 비었거나 다른 시트로 바뀐 것 같으면 아무것도 안 함 (11/8·11/9 사고: 빈 새 시트에 쓰기)
    fc = d.get("forecast") or {}
    rows = ((d.get("master.order") or {}).get("rows")) or []
    if len(rows) < 50 or len(fc) < 30 or len(d) < 30:
        print("시트 비정상: 품목 %d · Forecast %d일 · 칸 %d개 → 아무것도 쓰지 않음" % (len(rows), len(fc), len(d)))
        return 3

    span = [day(T, -i) for i in range(a.days, 0, -1)]
    has_act = lambda x: str((fc.get(x) or {}).get("act") or "").strip() not in ("", "0")
    miss_g = [x for x in span if not has_act(x)]
    miss_m = [x for x in span if ("menuDay." + x) not in d]
    print("기준 %s %s · 어제 %s · 매출 빈 날 %s · 메뉴 빈 날 %s" % (T, kst.strftime("%H:%M"), md(Y), ", ".join(map(md, miss_g)) or "없음", ", ".join(map(md, miss_m)) or "없음"))
    if not miss_g and not miss_m:
        print("최신: 받을 것 없음")
        return 0

    sp = d.get("salesPush") or {}
    ag = d.get("misAgent") or {}
    mp = d.get("misPush") or {}
    parts = sp.get("parts") or {}
    kind = sp.get("kind") or "gross"
    alive = bool(ag.get("at")) and now - ag["at"] < (20 * MIN if ag.get("mode") == "ondemand" else 3 * MIN)

    # 오늘(05시 뒤) 어제까지를 이미 받아 봤으면 다시 안 함: 남은 빈 날은 휴무이거나 MIS에 아직 없는 것
    def tried(k):
        p = parts.get(k) or ({"status": sp.get("status"), "doneAt": sp.get("doneAt")} if kind == k and not parts else None)
        rng = sp if kind == k else (sp.get("also") or {}).get(k) or sp  # 끝난 기록에는 also가 안 남음 → 같은 요청의 to로 봄
        t5 = datetime.datetime.combine(kst.date(), datetime.time(5), KST).timestamp() * 1000
        return bool(p and p.get("status") == "done" and (p.get("doneAt") or 0) > t5 and (rng.get("to") or "") >= Y)

    want_g = bool(miss_g) and not tried("gross")
    want_m = bool(miss_m) and not tried("menu")
    if not want_g and not want_m:
        print("오늘 이미 받아 봄: 남은 빈 날은 휴무이거나 MIS에 없는 날")
        return 0

    age = now - (sp.get("at") or 0)
    live = sp.get("status") == "running" and now - (sp.get("startAt") or sp.get("at") or 0) < 14 * MIN or sp.get("status") == "pending" and age < (6 * MIN if alive else 18 * 60 * MIN)
    if live:
        print("건너뜀: 다른 매출 요청이 도는 중(%s, %d분 전)" % (sp.get("status"), age / MIN))
        return 2
    if mp.get("status") in ("pending", "running") and now - (mp.get("at") or 0) < 20 * MIN or ag.get("job") and now - (ag.get("at") or 0) < 3 * MIN:
        print("건너뜀: PC가 발주 전송 중")
        return 2
    hm = kst.hour * 60 + kst.minute
    if 12 * 60 + 30 <= hm <= 14 * 60 + 45 and not a.force_time:
        print("건너뜀: 발주 시간대(12:30~14:45)에는 PC 창을 띄우지 않음")
        return 2
    if not alive:
        print("건너뜀: 매장 PC가 꺼져 있음(마지막 신호 %s)" % ("%d분 전" % ((now - ag["at"]) / MIN) if ag.get("at") else "없음"))
        return 2

    # 요청 만들기 (앱의 salesFresh와 같은 모양). 매출은 이번 주 월요일~어제(빈 날이 더 앞이면 거기부터), 메뉴는 빈 날부터 어제까지(PC가 이미 있는 날은 건너뜀)
    mon = day(Y, -datetime.date.fromisoformat(Y).weekday())
    g = {"from": min([mon] + miss_g), "to": Y}
    m = {"from": min(miss_m), "to": Y} if miss_m else None
    keep = {k: v for k, v in parts.items() if v and v.get("doneAt") and now - v["doneAt"] < 12 * 60 * MIN and not (k == "gross" and want_g) and not (k == "menu" and want_m)}

    def make(re_n=0):
        t = int(nowms())
        r = {"id": t, "at": t, "status": "pending", "by": "auto"}
        if want_g:
            r.update(g)
            if want_m:
                r["also"] = {"menu": dict(m, at=t)}
        else:
            r.update(m, kind="menu")
        if re_n:
            r["re"] = re_n
        if keep:
            r["parts"] = keep
        return r

    req = make()
    print("요청: %s%s" % ("매출 %s~%s" % (md(g["from"]), md(g["to"])) if want_g else "", (" + " if want_g else "") + "메뉴 %s~%s" % (md(m["from"]), md(m["to"])) if want_m else ""))
    if a.dry:
        print("(--dry: 시트에 쓰지 않음)")
        return 0
    os.makedirs(a.backup, exist_ok=True)
    json.dump(sp, open(os.path.join(a.backup, "salesPush_%s.json" % kst.strftime("%Y%m%d_%H%M%S")), "w"), ensure_ascii=False)
    post({"action": "set", "key": "salesPush", "value": req})

    # 기다림: PC가 2분 반 안에 움직임이 없으면 한 번만 다시 보냄(11/12 실제: 켜져 있는데 요청을 놓친 적 있음)
    t0, resent, cur = time.time(), False, req
    while time.time() - t0 < a.wait:
        time.sleep(a.poll)
        try:
            s = get("&status=1", tries=1).get("status") or {}
        except SystemExit:
            continue
        p = s.get("salesPush") or {}
        if (p.get("at") or 0) < req["at"]:
            continue  # 옛 서버는 쓰는 순간 칸이 잠깐 안 보임
        if p.get("status") in ("done", "error"):
            break
        if p.get("status") == "pending" and not resent and time.time() - t0 > a.resend:
            f = get()["data"]
            pa, fa = f.get("salesPush") or {}, f.get("misAgent") or {}
            working = (fa.get("stepAt") or 0) > (pa.get("at") or 0) - 5000 or bool(fa.get("job")) and (fa.get("at") or 0) > (pa.get("at") or 0)
            if pa.get("status") == "pending" and not working and not pa.get("re"):
                cur = make(1)
                post({"action": "set", "key": "salesPush", "value": cur})
                print("PC가 못 받아 한 번 다시 보냄")
            resent = True

    f = get()["data"]
    p = f.get("salesPush") or {}
    fc2 = f.get("forecast") or {}
    got_g = [x for x in miss_g if str((fc2.get(x) or {}).get("act") or "").strip() not in ("", "0")]
    got_m = [x for x in miss_m if ("menuDay." + x) in f]
    ps = p.get("parts") or {}
    for k, name in (("gross", "매출"), ("menu", "메뉴")):
        if ps.get(k):
            print("%s: %s · %s" % (name, ps[k].get("status"), ps[k].get("text") or ""))
    print("결과(%s, %d초): 매출 받은 날 %s · 메뉴 받은 날 %s" % (p.get("status"), time.time() - t0, ", ".join(map(md, got_g)) or "없음", ", ".join(map(md, got_m)) or "없음"))
    ok_g = not want_g or (ps.get("gross") or {}).get("status") == "done" or (not ps and p.get("status") == "done")
    ok_m = not want_m or (ps.get("menu") or {}).get("status") == "done" or (not ps and p.get("status") == "done" and not want_g)
    if p.get("status") != "done" or not ok_g or not ok_m:
        print("못 받음: %s" % (p.get("text") or "PC 응답 없음"))
        return 4
    return 0


if __name__ == "__main__":
    sys.exit(main())
