#!/usr/bin/env python3
# 보안 지킴이 (11/15 KM "진행", 기획안 15번 · 담당 Moat): 커밋·푸시 전에 매장 자료·비밀이 공개 저장소로 나가는지 자동 검사
#  이 저장소는 공개(GitHub Pages)라 한 번 올라간 것은 지워도 남음 → 올리기 전에 막음
#  막음(끝 코드 2): 비밀 키·토큰, 시트 통째 자료(input.날짜 등), 매장 자료 파일(kv*.json·엑셀·CSV), Claude 세션 링크·ID,
#    비공개 문서 링크(claude.ai의 artifact 주소), PL 대시보드 비공개 우편함 저장소 이름, 저장소에 없던 새 Apps Script 주소, 전화번호·주민번호·카드번호·이메일
#  경고(막지 않음): 공개 폴더(docs) 속 큰 금액, 비밀번호처럼 보이는 값, 끝난 서비스 이름(규칙 10), 보고서 폴더의 사진·PDF(속은 사람이 확인)
#  허용: tools/guard-allow.txt (KM 확인 뒤에만 한 줄씩. "path:앞부분" = 그 경로는 건너뜀, 그 밖의 줄 = 그 글자가 든 줄은 통과)
# 사용:
#   python3 tools/guard.py --staged      스테이지된 변경 (git commit 전)
#   python3 tools/guard.py --push        아직 main에 없는 커밋들 (git push 전, origin/main...HEAD)
#   python3 tools/guard.py --all         저장소 전체 지금 파일 (주간 점검)
#   python3 tools/guard.py --hook        Claude Code 훅(PreToolUse Bash): 명령이 git commit·push일 때만 검사, 막을 땐 끝 코드 2
#   python3 tools/guard.py --text 파일    한 파일을 새로 추가한다고 보고 검사 (시험용)
# 찾은 값은 화면에 앞 몇 글자만 보여 줌(비밀을 기록에 다시 남기지 않게)
import json, os, re, subprocess, sys

ROOT = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip() or os.getcwd()
SKIP_PATHS = (".claude/skills/",)  # 남이 만든 스킬 묶음(예시 토큰 등) — 우리 자료가 들어가는 곳이 아님

BLOCK = [
    ("GitHub 토큰", re.compile(r"\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b")),
    ("API 키(sk-)", re.compile(r"\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}")),
    ("Google API 키", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("AWS 키", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("Slack 토큰", re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}")),
    ("개인 키", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("시트 통째 자료(매장 숫자)", re.compile(r"\"(?:input|misOrder|misRecv|menuDay|menuDayPart|setDay|recvAdd|soldout|prepOnhand)\.20\d\d-\d\d-\d\d\"\s*:")),
    ("Claude 세션 링크·ID", re.compile(r"claude\.ai/code/session_|\bsession_01[A-Za-z0-9]{18,}|\bcse_01[A-Za-z0-9]{18,}")),
    ("비공개 문서 링크", re.compile(r"claude\.ai/(?:code/)?artifact/[A-Za-z0-9_-]{10,}")),
    ("비공개 우편함·저장소", re.compile(r"\bpl-inbox\b")),
    ("전화번호", re.compile(r"(?<![\d.])01[016789][-. ]?\d{3,4}[-. ]?\d{4}(?![\d.])")),
    ("주민등록번호", re.compile(r"(?<!\d)\d{6}-[1-4]\d{6}(?!\d)")),
    ("카드 번호", re.compile(r"(?<!\d)\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{4}(?!\d)")),
    ("이메일", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")),
]
EMAIL_OK = re.compile(r"(^noreply@|@users\.noreply\.github\.com$|@example\.(com|org|net)$|^git@github\.com$)", re.I)
APPS_URL = re.compile(r"script\.google\.com/macros/s/([A-Za-z0-9_-]{20,})/")
WARN = [
    ("공개 폴더의 큰 금액(매장 숫자?)", re.compile(r"(?<![\d,])\d{1,3}(?:,\d{3}){2,}\s*원"), lambda p: p.startswith("docs/")),
    ("비밀번호처럼 보이는 값", re.compile(r"(?i)\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|비밀번호|비번)\b\s*[:=]\s*['\"][^'\"\s]{6,}['\"]"), lambda p: True),
    ("끝난 서비스(규칙 10)", re.compile(r"(?i)agent\s*builder|chatgpt\s*atlas|chatgpt\s*agent"), lambda p: p.endswith((".js", ".mjs", ".py", ".gs", ".json"))),
]
DATA_FILE = re.compile(r"(?:^|/)(?:kv[^/]*\.json|[^/]*kv_[^/]*\.json|items\d*\.json|[^/]+\.(?:xlsx|xls|csv))$", re.I)
REPORT_MEDIA = re.compile(r"^docs/.*\.(?:png|jpe?g|webp|gif|pdf)$", re.I)


def git(*a):
    return subprocess.run(["git", "-C", ROOT, *a], capture_output=True, text=True).stdout


def load_allow():
    paths, texts = [], []
    try:
        for ln in open(os.path.join(ROOT, "tools/guard-allow.txt"), encoding="utf-8"):
            ln = ln.strip()
            if not ln or ln.startswith("#"):
                continue
            (paths if ln.startswith("path:") else texts).append(ln[5:].strip() if ln.startswith("path:") else ln)
    except FileNotFoundError:
        pass
    return paths, texts


def mask(s):
    s = s.strip()
    return s[:4] + "…" + ("(%d자)" % len(s)) if len(s) > 6 else s[:2] + "…"


def parse_diff(txt):
    """git diff -U0 → {path: [(줄 번호, 추가된 줄)]}, 바이너리 경로 목록"""
    files, binary, cur, ln = {}, [], None, 0
    for line in txt.splitlines():
        if line.startswith("+++ "):
            p = line[4:]
            cur = None if p == "/dev/null" else (p[2:] if p.startswith("b/") else p)
            if cur is not None:
                files.setdefault(cur, [])
        elif line.startswith("Binary files "):
            m = re.search(r" and b/(.+) differ$", line)
            if m:
                binary.append(m.group(1))
        elif line.startswith("@@"):
            m = re.search(r"\+(\d+)", line)
            ln = int(m.group(1)) if m else 0
        elif line.startswith("+") and cur is not None:
            files[cur].append((ln, line[1:]))
            ln += 1
    return files, binary


def read_file(path):
    full = os.path.join(ROOT, path)
    try:
        if os.path.getsize(full) > 3_000_000:
            return None
        b = open(full, "rb").read()
    except OSError:
        return None
    if b"\0" in b[:4096]:
        return None
    return [(i + 1, l) for i, l in enumerate(b.decode("utf-8", "replace").splitlines())]


def in_head(token):
    return subprocess.run(["git", "-C", ROOT, "grep", "-q", "-F", token, "HEAD", "--", "."], capture_output=True).returncode == 0


def scan(files, binary, all_mode=False):
    allow_paths, allow_texts = load_allow()
    blocks, warns, seen_url = [], [], {}
    skip = lambda p: p.startswith(SKIP_PATHS) or any(p.startswith(a) for a in allow_paths)
    for p in sorted(set(list(files) + binary)):
        if skip(p):
            continue
        if DATA_FILE.search(p):
            blocks.append((p, 0, "매장 자료 파일(kv·items·엑셀·CSV)", p.rsplit("/", 1)[-1]))
        if REPORT_MEDIA.search(p):
            warns.append((p, 0, "보고서 폴더의 사진·PDF: 앱·MIS 화면, 매장 숫자, 사람 이름이 없는지 눈으로 확인", ""))
    for p, lines in files.items():
        if skip(p):
            continue
        for n, t in lines:
            if any(a in t for a in allow_texts):
                continue
            for name, rx in BLOCK:
                for m in rx.finditer(t):
                    v = m.group(0)
                    if name == "이메일" and EMAIL_OK.search(v):
                        continue
                    if name == "이메일" and re.search(r"\.(png|jpe?g|svg|webp|gif|js|css|mjs)$", v, re.I):
                        continue  # "icon@2x.png" 같은 파일 이름
                    blocks.append((p, n, name, mask(v)))
            for m in APPS_URL.finditer(t):
                key = m.group(1)
                if key not in seen_url:
                    seen_url[key] = all_mode or in_head(key)
                if not seen_url[key]:
                    blocks.append((p, n, "저장소에 없던 새 Apps Script 주소(비공개 중계·시트일 수 있음)", mask(key)))
            for name, rx, where in WARN:
                if where(p):
                    for m in rx.finditer(t):
                        warns.append((p, n, name, mask(m.group(0))))
    return blocks, warns


def report(blocks, warns, title):
    out = []
    if blocks:
        out.append(f"보안 지킴이({title}): 막음 {len(blocks)}건 — 공개 저장소라 올라가면 지워도 남습니다")
        for p, n, name, v in blocks[:30]:
            out.append(f"  - {p}{':' + str(n) if n else ''} {name} [{v}]")
        if len(blocks) > 30:
            out.append(f"  … 외 {len(blocks) - 30}건")
        out.append("  고치는 법: 그 줄·파일을 빼고 다시 커밋. 공개해도 되는 값이면 KM 확인 뒤 tools/guard-allow.txt에 한 줄 추가")
    if warns:
        out.append(f"보안 지킴이({title}): 경고 {len(warns)}건 (막지 않음, 확인만)")
        for p, n, name, v in warns[:15]:
            out.append(f"  - {p}{':' + str(n) if n else ''} {name}{' [' + v + ']' if v else ''}")
    return "\n".join(out)


def staged():
    return parse_diff(git("diff", "--cached", "-U0", "--no-color", "--no-ext-diff"))


def worktree_all():
    """git add 와 commit 을 한 명령에 쓸 때: 아직 스테이지 안 된 변경·새 파일까지 (넉넉히)"""
    files, binary = parse_diff(git("diff", "HEAD", "-U0", "--no-color", "--no-ext-diff"))
    for p in git("ls-files", "--others", "--exclude-standard").splitlines():
        lines = read_file(p)
        if lines is None:
            binary.append(p)
        else:
            files[p] = lines
    return files, binary


def pushing():
    base = "origin/main" if git("rev-parse", "--verify", "-q", "origin/main").strip() else ""
    if not base:
        return {}, []
    return parse_diff(git("diff", base + "...HEAD", "-U0", "--no-color", "--no-ext-diff"))


def all_files():
    files, binary = {}, []
    for p in git("ls-files").splitlines():
        if p.startswith(SKIP_PATHS):
            continue
        lines = read_file(p)
        if lines is None:
            binary.append(p)
        else:
            files[p] = lines
    return files, binary


def main():
    a = sys.argv[1:]
    mode = a[0] if a else "--staged"
    if mode == "--hook":
        try:
            cmd = (json.load(sys.stdin).get("tool_input") or {}).get("command") or ""
        except Exception:
            return 0
        if not re.search(r"\bgit\b[^|;&\n]*\b(commit|push)\b", cmd):
            return 0
        # 명령이 다른 폴더의 저장소를 가리키면(cd 폴더 && git …, git -C 폴더 …) 그 저장소를 검사
        global ROOT
        m = re.search(r"\bgit\s+-C\s+(\"[^\"]+\"|'[^']+'|\S+)", cmd) or re.search(r"(?:^|[;&|]\s*)cd\s+(\"[^\"]+\"|'[^']+'|[^\s;&|]+)", cmd)
        if m:
            d = os.path.expanduser(m.group(1).strip("\"'"))
            top = subprocess.run(["git", "-C", d, "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip()
            if top:
                ROOT = top
        if not os.path.isfile(os.path.join(ROOT, "tools", "guard.py")):
            return 0  # 이 저장소(라벨·발주앱)가 아닌 곳의 커밋은 건드리지 않음
        res = []
        if re.search(r"\bgit\b[^|;&\n]*\bcommit\b", cmd):
            res.append(("커밋 전", *(worktree_all() if re.search(r"\bgit\s+add\b|\bcommit\b[^|;&\n]*\s-[a-zA-Z]*a", cmd) else staged())))
        if re.search(r"\bgit\b[^|;&\n]*\bpush\b", cmd):
            res.append(("푸시 전", *pushing()))
        blocked = False
        for title, files, binary in res:
            b, w = scan(files, binary)
            msg = report(b, w, title)
            if msg:
                print(msg, file=sys.stderr)
            blocked = blocked or bool(b)
        return 2 if blocked else 0
    if mode == "--staged":
        files, binary = staged(); title = "커밋 전"
    elif mode == "--push":
        files, binary = pushing(); title = "푸시 전"
    elif mode == "--all":
        files, binary = all_files(); title = "저장소 전체"
    elif mode == "--text" and len(a) > 1:
        path = os.path.relpath(os.path.abspath(a[1]), ROOT)
        lines = read_file(path)
        files, binary = ({path: lines}, []) if lines is not None else ({}, [path]); title = "파일 " + path
    else:
        print("사용: python3 tools/guard.py --staged | --push | --all | --hook | --text 파일", file=sys.stderr)
        return 1
    b, w = scan(files, binary, all_mode=(mode == "--all"))
    msg = report(b, w, title)
    print(msg or f"보안 지킴이({title}): 이상 없음")
    return 2 if b else 0


if __name__ == "__main__":
    sys.exit(main())
