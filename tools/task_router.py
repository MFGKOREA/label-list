#!/usr/bin/env python3
# [업무] 태스크 라우터 (2026-11-17 KM 승인 7번)
#  게시판·이슈에 [업무]로 올라온 일을 정해진 순서로 넘긴다:
#    레미(PC·브라우저 등록) → 클로드 코드(코드·PR) → GPT(3줄 반박) → 신우 님 승인 카드
#  규칙 본문: docs/ai-protocol.md 4장(패킷)·6장(3회 멈춤)·7장(검증 게이트)·9장([업무] 흐름)
#  패킷은 docs/aside/tasks/<일 번호>.json 하나로 남고, 칸 모양은 docs/aside/task-schema.json.
#
# 사용:
#   python3 tools/task_router.py open --title "..." --intent "..." [--from remi] [--to claude-code] [--sla 10] [--source "이슈 #12"]
#   python3 tools/task_router.py from-issue 12            이슈 본문([업무] 양식)을 읽어 패킷을 만든다 (gh 필요)
#   python3 tools/task_router.py advance T-20261117-001 --to running --evidence "고친 파일: ..." 
#   python3 tools/task_router.py rebut   T-20261117-001 --line "..." --line "..." --line "..."   (GPT 반박, 3줄까지)
#   python3 tools/task_router.py card    T-20261117-001    신우 님 승인 카드 만들기(docs/aside/cards/)
#   python3 tools/task_router.py approve T-20261117-001 --by km --ref "PR #34"   /  --reject --why "..."
#   python3 tools/task_router.py status                    아직 안 끝난 일과 다음 차례
#   python3 tools/task_router.py check                     패킷 전부 검사(ci-checks와 같은 규칙)
#   python3 tools/task_router.py --selftest                라우터 자체 시험(임시 폴더에서만 돎)
# 끝 코드: 0 통과 · 1 규칙에 걸림 · 2 스스로 못 함(도구 없음 등)
import glob
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
ROOT = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip() or os.getcwd()
REPO = ROOT  # 자체 시험은 ROOT만 임시 폴더로 바꾸고, 스키마는 진짜 저장소 것을 본다
TASKS = "docs/aside/tasks"
CARDS = "docs/aside/cards"
BOARD = "docs/aside/board.md"

# 4장 상태 흐름. 여기 없는 변화는 거절한다(군더더기 상태를 만들지 않음)
NEXT = {
    "queued": {"running", "blocked", "failed"},
    "running": {"verifying", "blocked", "failed"},
    "verifying": {"done", "running", "blocked", "failed"},  # running = 반박 지적을 반영하러 되돌아감
    "blocked": {"running"},                                  # 원인이 없어진 뒤 새 패킷으로 다시 시작하는 것이 원칙
    "done": set(),
    "failed": set(),
}
FLOW = [("remi", "PC·브라우저 쪽 등록"), ("claude-code", "코드·PR"), ("gpt", "3줄 반박"), ("km", "신우 님 승인 카드")]
STAGE_OF = {"queued": 0, "running": 1, "verifying": 2, "blocked": 2, "failed": 3, "done": 4}
AI = ["claude-code", "aside", "remi", "gpt", "pickle", "km"]
SLA = {"single": 3, "double": 10}


class Stop(Exception):
    pass


def now_iso():
    return datetime.now(KST).replace(microsecond=0).isoformat()


def today():
    return datetime.now(KST).strftime("%Y%m%d")


def rel(*parts):
    return os.path.join(ROOT, *parts)


def load_ci_checks():
    """ci-checks.py(파일 이름에 -)를 불러 패킷 검사를 그대로 쓴다 — 규칙을 두 곳에 적지 않으려고"""
    path = os.path.join(REPO, "tools", "ci-checks.py")
    try:
        spec = importlib.util.spec_from_file_location("ci_checks", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    except Exception:
        return None


CI = load_ci_checks()


def schema():
    with open(os.path.join(REPO, "docs/aside/task-schema.json"), encoding="utf-8") as f:
        return json.load(f)


def validate(packet):
    """ci-checks와 같은 규칙으로 본다. 못 불러왔으면 최소 규칙만 본다"""
    if CI is not None:
        try:
            return CI.validate_packet(packet, schema())
        except Exception:
            pass
    errs = []
    for k in ["task_id", "intent", "assigned_to", "verify_by", "sla_sec", "retry_count", "max_retries", "status", "evidence"]:
        if k not in packet:
            errs.append(f"칸 없음: {k}")
    if packet.get("assigned_to") == packet.get("verify_by"):
        errs.append("verify_by가 assigned_to와 같음")
    if packet.get("status") == "blocked" and not str(packet.get("blocked_reason", "")).strip():
        errs.append("blocked인데 blocked_reason이 비어 있음")
    return errs


def task_path(tid):
    return rel(TASKS, tid + ".json")


def load(tid):
    p = task_path(tid)
    if not os.path.exists(p):
        raise Stop(f"그 일 번호의 패킷이 없어요: {TASKS}/{tid}.json")
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def save(packet):
    errs = validate(packet)
    if errs:
        raise Stop("패킷 규칙에 걸려 저장하지 않았어요:\n  - " + "\n  - ".join(errs))
    os.makedirs(rel(TASKS), exist_ok=True)
    with open(task_path(packet["task_id"]), "w", encoding="utf-8") as f:
        json.dump(packet, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return task_path(packet["task_id"])


def next_number(day=None):
    day = day or today()
    n = 0
    for p in glob.glob(rel(TASKS, f"T-{day}-*.json")):
        m = re.search(r"T-\d{8}-(\d{3})\.json$", p)
        if m:
            n = max(n, int(m.group(1)))
    return f"T-{day}-{n + 1:03d}"


def board_line(sender, to, text):
    """board.md 는 덧붙이기만 한다(고치거나 지우지 않음)"""
    os.makedirs(rel("docs/aside"), exist_ok=True)
    t = datetime.now(KST)
    line = f"- {t.strftime('%m.%d %H:%M')} [{sender} → {to}] {text}\n"
    exists = os.path.exists(rel(BOARD))
    with open(rel(BOARD), "a", encoding="utf-8") as f:
        if exists:
            with open(rel(BOARD), encoding="utf-8") as g:
                tail = g.read()[-1:]
            if tail and tail != "\n":
                f.write("\n")
        f.write(line)
    return line.strip()


def new_packet(title, intent, sender="remi", to="claude-code", verify="gpt", sla=10, source="", fallback=None, now=None):
    if not str(intent or "").strip():
        raise Stop("intent(무엇을 끝낼지)가 비어 있어요 — 동사 + 끝났는지 보는 기준으로 한 문장")
    if to == verify:
        raise Stop("맡는 AI와 검증 AI가 같아요 — 만든 AI가 자기 일을 검증할 수 없습니다(ai-protocol 5장)")
    if sla not in (3, 10) and not (1 <= int(sla) <= 600):
        raise Stop("sla_sec는 3(단일)·10(2중·복합) 또는 1~600 사이 초")
    packet = {
        "task_id": next_number((now or datetime.now(KST)).strftime("%Y%m%d")),
        "intent": intent.strip(),
        "assigned_to": to,
        "verify_by": verify,
        "sla_sec": int(sla),
        "retry_count": 0,
        "max_retries": 3,
        "status": "queued",
        "evidence": [],
        "created_at": (now or datetime.now(KST)).replace(microsecond=0).isoformat(),
        "fallback": fallback or ["aside", "km"],
        "source": (source or "게시판 [업무] 등록").strip()[:200],
        "title": (title or "").strip()[:200],
        "flow": {"stage": 0, "steps": [{"by": w, "what": d, "at": None if i else (now or datetime.now(KST)).replace(microsecond=0).isoformat()} for i, (w, d) in enumerate(FLOW[:3] + [("km", "승인 카드 승인")])]},
        "verification": {"by": verify, "at": None, "lines": [], "verdict": "pending"},
        "approval": {"state": "pending", "by": None, "at": None, "ref": None, "why": None},
    }
    packet["flow"]["steps"][0] = {"by": sender, "what": "게시판·이슈 [업무] 등록", "at": packet["created_at"]}
    return packet


# ---------- 이슈 본문 → 패킷 ----------

FIELD = {
    "무엇을": "intent",
    "끝났는지 보는 기준": "done_line",
    "맡는 ai": "to",
    "검증": "verify",
    "응답 기준(초)": "sla",
    "되돌릴 수 없는 일": "irreversible",
    "근거": "evidence",
    "올린 사람": "sender",
}


def parse_issue(text):
    """이슈 양식('### 무엇을')의 칸을 읽는다. 모르는 칸은 넘김"""
    out, cur = {}, None
    for raw in (text or "").splitlines():
        line = raw.rstrip()
        m = re.match(r"^#{1,4}\s*(.+?)\s*$", line)
        if m:
            key = FIELD.get(m.group(1).strip().lower().replace("**", ""))
            cur = key
            if key:
                out.setdefault(key, "")
            continue
        if cur:
            out[cur] = (out[cur] + "\n" + line).strip()
    return out


def from_issue(number, repo=None):
    cmd = ["gh", "issue", "view", str(number), "--json", "title,body,labels"]
    if repo:
        cmd += ["-R", repo]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True)
    except FileNotFoundError:
        raise Stop("gh(깃허브 명령)가 없어 이슈를 못 읽어요 — 이슈 본문을 복사해 open 으로 만들어 주세요")
    if r.returncode != 0:
        raise Stop("이슈를 못 읽었어요: " + (r.stderr or "").strip()[:200])
    issue = json.loads(r.stdout or "{}")
    fields = parse_issue(issue.get("body") or "")
    intent = fields.get("intent") or issue.get("title") or ""
    done = fields.get("done_line") or ""
    if done:
        intent = intent.rstrip(" .") + " — 끝난 기준: " + done.rstrip(" .")
    to = (fields.get("to") or "claude-code").strip().lower()
    verify = (fields.get("verify") or "gpt").strip().lower()
    if to not in AI:
        to = "claude-code"
    if verify not in AI:
        verify = "gpt"
    sla = re.sub(r"[^0-9]", "", fields.get("sla") or "") or "10"
    irreversible = (fields.get("irreversible") or "").strip()
    evidence = [x.strip() for x in (fields.get("evidence") or "").splitlines() if x.strip()][:20]
    packet = new_packet(issue.get("title") or f"이슈 #{number}", intent, sender=(fields.get("sender") or "remi").strip().lower()[:20] or "remi",
                        to=to, verify=verify, sla=int(sla), source=f"이슈 #{number}",
                        fallback=["aside", "km"])
    packet["evidence"] = evidence
    if re.match(r"^(예|네|yes|y)$", irreversible, re.I):
        packet["needs_km_before"] = "되돌릴 수 없는 일이 있어 승인 카드 전에는 실행하지 않음"
    return packet


# ---------- 상태 넘기기 ----------

def advance(packet, to, evidence=None, why=None, retry=False, now=None):
    now = now or datetime.now(KST)
    cur = packet.get("status")
    if to not in NEXT.get(cur, set()):
        raise Stop(f"{cur} → {to} 로는 넘길 수 없어요 (가능: {', '.join(sorted(NEXT.get(cur, set()))) or '없음'})")
    ev = list(packet.get("evidence") or [])
    for e in (evidence or []):
        e = str(e).strip()
        if e:
            ev.append(e)
    packet["evidence"] = ev[-50:]
    packet["status"] = to
    packet["updated_at"] = now.replace(microsecond=0).isoformat()
    if retry:
        packet["retry_count"] = min(3, int(packet.get("retry_count") or 0) + 1)
    if to in ("blocked", "failed"):
        r = (why or "").strip()
        if not r:
            raise Stop("blocked·failed 로 넘길 때는 원인 한 줄(--why)이 필요해요 (ai-protocol 6장)")
        packet["blocked_reason"] = r[:300]
        if int(packet.get("retry_count") or 0) >= int(packet.get("max_retries") or 3) and to != "failed":
            packet["status"] = "blocked"  # 3회에서 멈춤
        packet["verification"]["verdict"] = "blocked"
    if to == "running" and cur == "verifying":
        packet["verification"]["verdict"] = "revise"  # 반박 지적을 반영하러 되돌아감
    packet["flow"]["stage"] = STAGE_OF.get(packet["status"], packet["flow"].get("stage", 0))
    steps = packet["flow"].get("steps") or []
    if 0 <= packet["flow"]["stage"] < len(steps) and not steps[packet["flow"]["stage"]].get("at"):
        steps[packet["flow"]["stage"]]["at"] = packet["updated_at"]
    return packet


def rebut(packet, lines, now=None):
    """GPT 반박: 3줄까지. 줄마다 어디가 문제인지·왜인지·어떻게 고칠지가 들어가야 한다"""
    lines = [str(x).strip() for x in (lines or []) if str(x).strip()]
    if not lines:
        raise Stop("반박 줄이 비어 있어요")
    if len(lines) > 3:
        raise Stop(f"반박은 3줄까지만 적습니다(지금 {len(lines)}줄) — 긴 지적은 요약하지 말고 큰 것 3개만")
    if packet.get("status") != "verifying":
        raise Stop(f"GPT 반박은 검증 차례(verifying)에서만 받습니다 (지금 {packet.get('status')})")
    if packet.get("verify_by") in (None, packet.get("assigned_to")):
        raise Stop("검증 AI가 맡은 AI와 같습니다")
    now = now or datetime.now(KST)
    packet["verification"] = {"by": packet.get("verify_by") or "gpt", "at": now.replace(microsecond=0).isoformat(), "lines": lines, "verdict": "rebutted"}
    packet["updated_at"] = packet["verification"]["at"]
    return packet


def card(packet, now=None):
    """신우 님 승인 카드 — GPT 3줄 반박이 있어야 만든다. 카드 없이는 승인도 없다"""
    v = packet.get("verification") or {}
    if not v.get("lines"):
        raise Stop("GPT 3줄 반박이 아직 없어요 — 먼저 rebut 으로 받아 주세요(순서: 레미 → 클로드 코드 → GPT → 승인 카드)")
    now = now or datetime.now(KST)
    tid = packet["task_id"]
    title = packet.get("title") or packet.get("intent", "")[:40]
    ev = (packet.get("evidence") or [])[-5:]
    lines = [
        f"# 승인 카드 · {tid}",
        "",
        f"**{title}**",
        "",
        "## 무엇을 했나",
        packet.get("intent", ""),
        "",
        "## 무엇이 바뀌나",
        f"- 맡은 AI: {packet.get('assigned_to')} · 검증: {packet.get('verify_by')}",
        f"- 근거: {packet.get('source') or '기록 없음'}",
    ]
    if packet.get("result_path"):
        lines.append(f"- 결과물: `{packet['result_path']}`")
    lines += ["", "## 돌려 본 것 (실제로 돌린 것만)"]
    lines += [f"- {e}" for e in ev] if ev else ["- 기록 없음(승인 전에 시험 결과를 남겨 주세요)"]
    lines += ["", f"## {v.get('by', 'gpt')} 반박 {len(v.get('lines') or [])}줄"]
    lines += [f"{i + 1}. {x}" for i, x in enumerate(v.get("lines") or [])]
    lines += ["", "## 승인하면 하는 일"]
    lines.append("- " + ("되돌릴 수 없는 일이 있어 승인 뒤에만 실행: " + packet["needs_km_before"] if packet.get("needs_km_before") else (packet.get("result_path") and "결과물을 합치고 배포" or "정한 일을 그대로 마무리")))
    lines += ["", "## 승인하지 않으면"]
    lines.append("- 아무것도 바뀌지 않아요. 반박 지적을 반영해 다시 올립니다." + (f" (지금까지 실패 {packet.get('retry_count', 0)}번)" if packet.get("retry_count") else ""))
    lines += ["", f"_만든 시각 {now.replace(microsecond=0).isoformat()} · 승인은 이 카드에 대고 합니다(코드는 승인 뒤에만)_", ""]
    body = "\n".join(lines)
    os.makedirs(rel(CARDS), exist_ok=True)
    path = f"{CARDS}/{tid}.md"
    with open(rel(path), "w", encoding="utf-8") as f:
        f.write(body)
    packet["approval"] = dict(packet.get("approval") or {}, state="pending", card_path=path, card_at=now.replace(microsecond=0).isoformat())
    return body, path


def approve(packet, by="km", ref=None, reject=False, why=None, now=None):
    now = now or datetime.now(KST)
    ap = packet.get("approval") or {}
    if not ap.get("card_path"):
        raise Stop("승인 카드가 아직 없어요 — card 로 먼저 만들어 주세요")
    if by not in AI:
        raise Stop(f"승인하는 사람이 누구인지 알 수 없어요: {by} (가능: {', '.join(AI)})")
    ap.update({"state": "rejected" if reject else "approved", "by": by,
               "at": now.replace(microsecond=0).isoformat(), "ref": (ref or "").strip() or None,
               "why": (why or "").strip() or None})
    packet["approval"] = ap
    if reject:
        advance(packet, "running", evidence=[f"{by}: 승인 안 함 — {ap['why'] or '이유 기록 없음'}"], now=now)
    else:
        advance(packet, "done", evidence=[f"{by}: 승인 ({ap['ref'] or '참조 없음'})"], now=now)
    return packet


def summary_line(p):
    nxt = {"queued": "클로드 코드가 시작", "running": "클로드 코드 작업 중", "verifying": "GPT 반박 차례",
           "blocked": "원인 확인·새 패킷", "failed": "끝남(다시 하려면 새 패킷)", "done": "끝남"}.get(p.get("status"), "?")
    return f"{p['task_id']}  {p.get('status'):9s}  {nxt:16s}  {(p.get('title') or p.get('intent', ''))[:60]}"


def collect():
    out = []
    for path in sorted(glob.glob(rel(TASKS, "T-*.json"))):
        try:
            with open(path, encoding="utf-8") as f:
                p = json.load(f)
        except Exception:
            continue
        if isinstance(p, dict) and p.get("task_id"):
            out.append(p)
    return out


# ---------- 명령 ----------

def arg(argv, name, default=None):
    if name in argv:
        i = argv.index(name)
        if i + 1 < len(argv):
            return argv[i + 1]
    return default


def many(argv, name):
    out = []
    for i, a in enumerate(argv):
        if a == name and i + 1 < len(argv):
            out.append(argv[i + 1])
    return out


def main(argv):
    if "--selftest" in argv:
        return selftest()
    cmd = argv[0] if argv else "status"
    try:
        if cmd == "open":
            p = new_packet(arg(argv, "--title", ""), arg(argv, "--intent", ""), sender=arg(argv, "--from", "remi"),
                           to=arg(argv, "--to", "claude-code"), verify=arg(argv, "--verify", "gpt"),
                           sla=int(arg(argv, "--sla", "10")), source=arg(argv, "--source", "게시판 [업무] 등록"),
                           fallback=[x for x in (arg(argv, "--fallback", "") or "").split(",") if x] or None)
            path = save(p)
            line = board_line("피클", "클로드 코드", f"[업무] {p['task_id']} 등록 · {p['title'] or p['intent'][:40]}")
            print(f"패킷 만들었어요: {path}\n게시판: {line}\n다음: 클로드 코드가 시작하면 → advance {p['task_id']} --to running")
            return 0
        if cmd == "from-issue":
            num = argv[1] if len(argv) > 1 and not argv[1].startswith("-") else arg(argv, "--number")
            p = from_issue(num, arg(argv, "--repo"))
            path = save(p)
            line = board_line("레미", "클로드 코드", f"[업무] 이슈 #{num} → {p['task_id']} · {p['title'][:40]}")
            print(f"이슈 #{num} → 패킷 {path}\n게시판: {line}")
            return 0
        if cmd == "advance":
            tid = arg(argv, "--id") or (argv[1] if len(argv) > 1 else None)
            p = load(tid)
            p = advance(p, arg(argv, "--to"), evidence=many(argv, "--evidence"), why=arg(argv, "--why"), retry="--retry" in argv)
            save(p)
            print(summary_line(p))
            return 0
        if cmd == "rebut":
            tid = arg(argv, "--id") or (argv[1] if len(argv) > 1 else None)
            p = rebut(load(tid), many(argv, "--line"))
            save(p)
            print(f"{p['task_id']}  GPT 반박 {len(p['verification']['lines'])}줄 기록. 다음: card {p['task_id']}")
            return 0
        if cmd == "card":
            tid = arg(argv, "--id") or (argv[1] if len(argv) > 1 else None)
            p = load(tid)
            body, path = card(p)
            save(p)
            print(body)
            print(f"(카드 파일: {path})")
            return 0
        if cmd == "approve":
            tid = arg(argv, "--id") or (argv[1] if len(argv) > 1 else None)
            p = approve(load(tid), by=arg(argv, "--by", "km"), ref=arg(argv, "--ref"), reject="--reject" in argv, why=arg(argv, "--why"))
            save(p)
            print(summary_line(p))
            return 0
        if cmd == "status":
            rows = collect()
            open_rows = [p for p in rows if p.get("status") in ("queued", "running", "verifying", "blocked")]
            if not rows:
                print("패킷이 아직 없어요. [업무]가 올라오면 open 이나 from-issue 로 만듭니다.")
                return 0
            print(f"안 끝난 일 {len(open_rows)}건 / 전체 {len(rows)}건")
            for p in sorted(open_rows, key=lambda x: x["task_id"]):
                print("  " + summary_line(p))
            return 0
        if cmd == "check":
            bad = 0
            for p in collect():
                errs = validate(p)
                if errs:
                    bad += 1
                    print(f"  - {p['task_id']}: " + " / ".join(errs))
            print("패킷 검사: " + (f"{bad}건 걸림" if bad else "이상 없음"))
            return 1 if bad else 0
        raise Stop(f"모르는 명령: {cmd}")
    except Stop as e:
        print("멈춤: " + str(e), file=sys.stderr)
        return 1


# ---------- 자체 시험 (임시 폴더에서만 돎) ----------

def selftest():
    global ROOT
    keep, n, ok = ROOT, 0, 0

    def t(name, fn):
        nonlocal n, ok
        n += 1
        try:
            fn()
            ok += 1
            print("통과  " + name)
        except Exception as e:
            print(f"실패  {name}\n   {e}")

    def expect_stop(fn, word=""):
        try:
            fn()
        except Stop as e:
            if word and word not in str(e):
                raise AssertionError(f"멈춘 까닭이 다름: {e}")
            return
        raise AssertionError("멈추지 않았음")

    with tempfile.TemporaryDirectory() as d:
        ROOT = d
        os.makedirs(os.path.join(d, TASKS), exist_ok=True)

        def a_open():
            p = new_packet("당일 메뉴 수집", "매시간 :40에 오늘 메뉴별 판매를 읽어 menuNow에 남기고 시험 47개를 돌린다", source="이슈 #33")
            assert p["status"] == "queued" and p["assigned_to"] == "claude-code" and p["verify_by"] == "gpt"
            assert re.match(r"^T-\d{8}-001$", p["task_id"]), p["task_id"]
            save(p)
            assert os.path.exists(task_path(p["task_id"]))

        t("1 [업무]를 패킷으로 만들면 T-날짜-001, 맡은 AI·검증 AI가 다름", a_open)

        def a_numbering():
            p2 = new_packet("둘째", "무언가를 고치고 시험한다")
            assert p2["task_id"].endswith("-002"), p2["task_id"]
            save(p2)

        t("2 같은 날 두 번째는 -002", a_numbering)

        def a_same_ai():
            expect_stop(lambda: new_packet("x", "같은 AI가 검증", to="gpt", verify="gpt"), "검증")

        t("3 맡은 AI와 검증 AI가 같으면 거절", a_same_ai)

        def a_order():
            pid = collect()[0]["task_id"]
            p = load(pid)
            expect_stop(lambda: advance(load(pid), "done"), "넘길 수 없어요")           # queued → done 금지
            p = advance(p, "running", evidence=["고친 파일: gw-agent/periodic.js"])
            p = advance(p, "verifying", evidence=["node periodic.test.mjs → 47/47 (1.2초)"])
            expect_stop(lambda: card(p), "3줄 반박")                                     # GPT 반박 없이 카드 금지
            p = rebut(p, ["오늘 조회가 막히면 아무것도 안 남는다", "실패를 성공으로 세지 않는다", "재시도가 하루 상한을 먹는다"])
            save(p)
            body, path = card(p)
            assert "승인 카드" in body and "오늘 조회가 막히면" in body
            ap = approve(p, by="km", ref="PR #33")
            assert ap["status"] == "done" and ap["approval"]["state"] == "approved"

        t("4 순서 지킴: 레미 → 클로드 코드 → GPT 3줄 → 카드 → 승인", a_order)

        def a_rebut_limit():
            p = load(collect()[1]["task_id"])
            p = advance(p, "running")
            p = advance(p, "verifying")
            expect_stop(lambda: rebut(p, ["1", "2", "3", "4"]), "3줄")

        t("5 GPT 반박은 3줄까지만", a_rebut_limit)

        def a_breaker():
            p = load(collect()[1]["task_id"])
            p = advance(p, "running", retry=True)
            p = advance(p, "blocked", why="MIS 로그인 화면에서 멈춤", retry=True)
            p["retry_count"] = 3
            p = advance(p, "running", retry=True)
            p = advance(p, "blocked", why="같은 원인 3번째", retry=True)
            assert p["status"] == "blocked" and p["retry_count"] == 3, p["status"]
            expect_stop(lambda: advance(p, "done"), "넘길 수 없어요")

        t("6 3회 실패하면 blocked에서 멈추고 done으로 못 감", a_breaker)

        def a_reject():
            p = load(collect()[0]["task_id"])
            p["status"] = "verifying"
            p = rebut(p, ["a", "b", "c"])
            card(p)
            p = approve(p, by="km", reject=True, why="주말 재고를 같이 봐야 함")
            assert p["status"] == "running" and p["approval"]["state"] == "rejected"

        t("7 승인 안 하면 done이 아니라 running으로 되돌아감", a_reject)

        def a_issue_parse():
            body = "### 무엇을\n새 메뉴 3종의 한글표시사항을 확인한다\n\n### 끝났는지 보는 기준\n3종 모두 표가 있고 출처 링크가 있다\n\n### 맡는 AI\nclaude-code\n\n### 검증\ngpt\n\n### 응답 기준(초)\n60\n\n### 되돌릴 수 없는 일\n예\n\n### 근거\n주간 점검 11/17"
            f = parse_issue(body)
            assert f["intent"].startswith("새 메뉴") and f["to"] == "claude-code" and f["sla"] == "60", f

        t("8 이슈 양식(### 칸)을 읽는다", a_issue_parse)

        def a_board():
            line = board_line("레미", "클로드 코드", "[업무] T-x 등록")
            assert "[레미 → 클로드 코드]" in line
            assert os.path.exists(os.path.join(d, BOARD))

        t("9 board.md 에 덧붙이기(형식 지킴)", a_board)

        def a_check_cmd():
            assert main(["check"]) == 0

        t("10 만든 패킷은 ci-checks 규칙을 통과", a_check_cmd)
    ROOT = keep
    print(f"{ok}/{n} 통과")
    return 0 if ok == n else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
