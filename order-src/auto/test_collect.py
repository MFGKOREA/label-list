#!/usr/bin/env python3
# collect.py 시험: 가짜 시트 서버 + 가짜 PC로 상황별 끝 코드·요청 모양을 확인 (실제 시트·GW에 닿지 않음)
# 사용: python3 order-src/auto/test_collect.py
import datetime, json, os, subprocess, sys, tempfile, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
KST = datetime.timezone(datetime.timedelta(hours=9))
ms = lambda s: int(datetime.datetime.fromisoformat(s).replace(tzinfo=KST).timestamp() * 1000)


def base(now, miss_g=(), miss_m=(), pc_ago=60, scout=True, **over):
    T = datetime.datetime.fromtimestamp(now / 1000, KST).date()
    days = [(T - datetime.timedelta(days=i)).isoformat() for i in range(1, 60)]
    d = {"master.order": {"rows": [[i] for i in range(120)]}, "forecast": {x: {"fc": "100", "act": "" if x in miss_g else "90"} for x in days}}
    for x in days[:40]:
        if x not in miss_m:
            d["menuDay." + x] = {"at": 1, "rows": [{"m": "a", "q": 1}]}
    for i in range(30):
        d["pad%d" % i] = 1
    d["misAgent"] = {"at": now - pc_ago * 1000, "mode": "ondemand", "ver": "1.7.0"}
    d["misPush"] = {"date": T.isoformat(), "status": "done", "at": now - 3600e3}
    if scout:
        d["gwScout"] = {"at": 1, "menus": []}
    d.update(over)
    return d


class Sheet:
    def __init__(self, data, pc):
        self.d, self.pc, self.posts, self.lock = data, pc, [], threading.Lock()


def serve(sheet):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def out(self, o):
            b = json.dumps(o).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)

        def do_GET(self):
            q = parse_qs(urlparse(self.path).query)
            with sheet.lock:
                if "status" in q:
                    self.out({"ok": True, "status": {k: sheet.d.get(k) for k in ("salesPush", "misPush", "misAgent")}})
                else:
                    self.out({"ok": True, "data": sheet.d})

        def do_POST(self):
            b = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            with sheet.lock:
                sheet.posts.append(json.loads(json.dumps(b)))  # 가짜 PC가 고치기 전 모양을 남김
                if b["action"] == "set":
                    sheet.d[b["key"]] = b["value"]
            if b["key"] == "salesPush" and sheet.pc:
                threading.Thread(target=sheet.pc, args=(sheet, b["value"]), daemon=True).start()
            self.out({"ok": True, "data": {}})

    s = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


# 가짜 PC: 요청을 받아 0.6초 뒤 끝냄(빈 날을 채움). mode: ok | error | ignore_first | never | closed(휴무: 끝났지만 그날은 비어 있음)
def pc(mode):
    seen = []

    def run(sheet, req):
        seen.append(req)
        if mode == "never" or (mode == "ignore_first" and len(seen) == 1):
            return
        time.sleep(0.6)
        with sheet.lock:
            p = sheet.d["salesPush"]
            if p["id"] != req["id"]:
                return
            kinds = [p.get("kind") or "gross"] + list((p.get("also") or {}).keys())
            t = p["at"] + 600
            p.setdefault("parts", {})
            for k in kinds:
                rng = p if (p.get("kind") or "gross") == k else p["also"][k]
                p["parts"][k] = {"status": "error" if mode == "error" else "done", "doneAt": t, "text": "가짜"}
                if mode in ("ok", "ignore_first") and k == "scout":
                    sheet.d["gwScout"] = {"at": t, "menus": [{"d": 0, "t": "가"}]}
                elif mode in ("ok", "ignore_first"):
                    x = rng["from"]
                    while x <= rng["to"]:
                        if k == "gross":
                            sheet.d["forecast"].setdefault(x, {})["act"] = "88"
                        elif k == "menu":
                            sheet.d.setdefault("menuDay." + x, {"at": t, "rows": [{"m": "a", "q": 1}]})
                        x = (datetime.date.fromisoformat(x) + datetime.timedelta(days=1)).isoformat()
            p.update(status="error" if mode == "error" else "done", doneAt=t, text="가짜")

    return run


def case(name, now_s, data_kw, mode, want_code, check=None, extra=()):
    now = ms(now_s)
    sheet = Sheet(base(now, **data_kw), pc(mode) if mode else None)
    srv = serve(sheet)
    with tempfile.TemporaryDirectory() as bk:
        r = subprocess.run([sys.executable, os.path.join(HERE, "collect.py"), "--now", now_s, "--poll", "0.3", "--resend", "1.5", "--wait", "5", "--backup", bk, *extra],
                           env=dict(os.environ, ORDER_API_TEST="http://127.0.0.1:%d/x" % srv.server_address[1]), capture_output=True, text=True)
    srv.shutdown()
    reqs = [p["value"] for p in sheet.posts if p.get("key") == "salesPush"]
    bad = [p for p in sheet.posts if p.get("key") != "salesPush" or p.get("action") != "set"]
    ok = r.returncode == want_code and not bad and (check is None or check(reqs, r.stdout))
    print(("통과  " if ok else "실패  ") + name + ("" if ok else "\n   code=%s posts=%s\n   %s" % (r.returncode, json.dumps(reqs, ensure_ascii=False)[:400], (r.stdout + r.stderr).strip().replace("\n", "\n   "))))
    return ok


def main():
    N = "2026-11-13T10:23"  # 금요일. 어제 = 11/12(목), 그 주 월요일 = 11/9
    Y = "2026-11-12"
    done_today = lambda **k: {"salesPush": dict({"id": 1, "at": ms("2026-11-13T09:00"), "status": "done", "from": "2026-11-09", "to": Y, "doneAt": ms("2026-11-13T09:01")}, **k)}
    R = [
        case("A 받을 것 없음 → 쓰지 않음", N, {}, None, 0, lambda q, o: not q),
        case("B 어제 매출·메뉴 없음 + PC 켜짐 → 한 번 요청해 받음", N, {"miss_g": [Y], "miss_m": [Y]}, "ok", 0,
             lambda q, o: len(q) == 1 and q[0]["from"] == "2026-11-09" and q[0]["to"] == Y and q[0]["status"] == "pending" and q[0]["also"]["menu"]["from"] == Y and "kind" not in q[0] and q[0]["src"] == "auto"),
        case("C PC 꺼짐 → 요청 안 함", N, {"miss_g": [Y], "pc_ago": 3600}, "ok", 2, lambda q, o: not q),
        case("D 시트가 빔 → 아무것도 안 씀", N, {"miss_g": [Y], "forecast": {}}, "ok", 3, lambda q, o: not q),
        case("E PC가 첫 요청을 놓침 → 한 번 다시 보내 받음", N, {"miss_g": [Y]}, "ignore_first", 0, lambda q, o: len(q) == 2 and q[1].get("re") == 1 and q[1]["id"] != q[0]["id"]),
        case("F PC가 끝내 안 받음 → 두 번까지만 보내고 못 받음으로 끝", N, {"miss_g": [Y]}, "never", 4, lambda q, o: len(q) == 2),
        case("G 오늘 이미 받아 봤는데 그날이 비어 있음(휴무) → 다시 안 함", N, dict({"miss_g": ["2026-11-10"]}, **done_today(parts={"gross": {"status": "done", "doneAt": ms("2026-11-13T09:01")}})), "ok", 0, lambda q, o: not q),
        case("G2 오늘 매출·메뉴를 같이 받아 봤고(기록에 also 없음) 메뉴 하루가 빔(휴무) → 다시 안 함", N, dict({"miss_m": ["2026-11-10"]}, **done_today(parts={"gross": {"status": "done", "doneAt": ms("2026-11-13T09:01")}, "menu": {"status": "done", "doneAt": ms("2026-11-13T09:02")}})), "ok", 0, lambda q, o: not q),
        case("G3 어제 밤에 받은 기록(오늘 05시 전)은 오늘 받은 걸로 안 침 → 새로 요청", N, dict({"miss_g": [Y]}, salesPush={"id": 1, "at": ms("2026-11-12T22:00"), "status": "done", "from": "2026-11-09", "to": "2026-11-11", "doneAt": ms("2026-11-12T22:01"), "parts": {"gross": {"status": "done", "doneAt": ms("2026-11-12T22:01")}}}), "ok", 0, lambda q, o: len(q) == 1),
        case("H2 14:40도 발주 시간대 → 미룸", "2026-11-13T14:40", {"miss_g": [Y]}, "ok", 2, lambda q, o: not q),
        case("H3 15:23은 요청", "2026-11-13T15:23", {"miss_g": [Y]}, "ok", 0, lambda q, o: len(q) == 1),
        case("H 발주 시간대(13:00) → 미룸", "2026-11-13T13:00", {"miss_g": [Y]}, "ok", 2, lambda q, o: not q),
        case("I 다른 매출 요청이 도는 중 → 덮지 않음", N, {"miss_g": [Y], "salesPush": {"id": 5, "at": ms(N) - 60e3, "status": "running", "startAt": ms(N) - 50e3}}, "ok", 2, lambda q, o: not q),
        case("J 발주 전송 중 → 미룸", N, {"miss_g": [Y], "misPush": {"date": "2026-11-13", "status": "pending", "at": ms(N) - 30e3}}, "ok", 2, lambda q, o: not q),
        case("K PC가 오류로 끝냄 → 못 받음", N, {"miss_g": [Y]}, "error", 4, lambda q, o: len(q) == 1),
        case("L 메뉴만 빔 → 메뉴 요청만", N, {"miss_m": ["2026-11-11", Y]}, "ok", 0, lambda q, o: len(q) == 1 and q[0].get("kind") == "menu" and q[0]["from"] == "2026-11-11" and "also" not in q[0]),
        case("M 지난주 일요일 매출이 빔 → 그날부터 요청", N, {"miss_g": ["2026-11-08", Y]}, "ok", 0, lambda q, o: q and q[0]["from"] == "2026-11-08"),
        case("N 휴무로 끝남(받았지만 그날은 빈 채) → 성공으로 봄", N, {"miss_g": [Y]}, "closed", 0, lambda q, o: len(q) == 1),
        case("O 오늘 받은 다른 버튼의 ✓는 들고 감", N, dict({"miss_m": [Y]}, **done_today(parts={"gross": {"status": "done", "doneAt": ms("2026-11-13T09:01"), "text": "g"}})), "ok", 0,
             lambda q, o: len(q) == 1 and q[0]["parts"]["gross"]["text"] == "g" and q[0]["kind"] == "menu"),
        case("S1 계획: MIS 메뉴 살펴보기가 아직 없음 → 그것만 요청해 받음", N, {"scout": False}, "ok", 0, lambda q, o: len(q) == 1 and q[0].get("kind") == "scout" and "from" not in q[0] and "also" not in q[0]),
        case("S2 계획 + 어제 매출 → 매출이 먼저, 살펴보기는 덧붙임", N, {"scout": False, "miss_g": [Y]}, "ok", 0, lambda q, o: len(q) == 1 and "kind" not in q[0] and "scout" in q[0]["also"] and "menu" not in q[0]["also"]),
        case("S3 살펴보기를 오늘 해 봤는데 실패 → 오늘은 다시 안 함", N, dict({"scout": False}, **done_today(parts={"scout": {"status": "error", "doneAt": ms("2026-11-13T09:05")}})), "ok", 0, lambda q, o: not q),
        case("S4 살펴보기만 요청했는데 PC가 오류 → 못 받음", N, {"scout": False}, "error", 4, lambda q, o: len(q) == 1),
        case("P --dry → 쓰지 않음", N, {"miss_g": [Y]}, "ok", 0, lambda q, o: not q and "요청" in o, extra=["--dry"]),
    ]
    print("%d/%d 통과" % (sum(R), len(R)))
    return 0 if all(R) else 1


if __name__ == "__main__":
    sys.exit(main())
