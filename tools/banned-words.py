#!/usr/bin/env python3
# 금지어 검사 (2026-11-16): 저장소 어디에도 쓰면 안 되는 단어를 커밋·PR 전에 잡는다.
#  목록은 아래 BANNED에 유니코드 이스케이프로 적는다 — 이 파일에 그 단어를 그대로 쓰면 이 검사에 스스로 걸린다.
#  (검사기가 자기 목록을 못 읽게 되는 일을 막으려는 것이지, 그 단어를 숨기려는 것이 아님. 화면에는 자리 번호와 코드로만 보여 준다.)
# 사용:
#   python3 tools/banned-words.py            저장소의 모든 추적 파일
#   python3 tools/banned-words.py --staged   스테이지된 변경 (git commit 전)
#   python3 tools/banned-words.py 파일...    지정한 파일
# 끝 코드: 0 없음 · 1 찾음
import os
import subprocess
import sys
import time

ROOT = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip() or os.getcwd()

# 남이 만든 스킬 묶음은 우리가 쓴 글이 아님(guard.py와 같은 기준)
SKIP_PATHS = (".claude/skills/",)

# (단어, 정한 사람·날짜와 이유) — 단어는 유니코드로만 적는다
BANNED = [
    ("\uad00\uc81c", "KM 2026-11-05 지정: 보고·문서·코드·대화 어디에도 쓰지 않음"),
]

MAX_BYTES = 3_000_000


def labels(word):
    return " ".join("U+%04X" % ord(ch) for ch in word)


def read_lines(path):
    full = os.path.join(ROOT, path)
    try:
        if os.path.getsize(full) > MAX_BYTES:
            return None
        b = open(full, "rb").read()
    except OSError:
        return None
    if b"\0" in b[:4096]:
        return None
    return b.decode("utf-8", "replace").splitlines()


def targets(argv):
    if "--staged" in argv:
        out = subprocess.run(
            ["git", "-C", ROOT, "diff", "--cached", "--name-only", "--diff-filter=ACMR"],
            capture_output=True, text=True,
        ).stdout
        return [p for p in out.splitlines() if p]
    paths = [a for a in argv if not a.startswith("-")]
    if paths:
        return [os.path.relpath(os.path.abspath(p), ROOT) for p in paths]
    out = subprocess.run(["git", "-C", ROOT, "ls-files"], capture_output=True, text=True).stdout
    return [p for p in out.splitlines() if p]


def main():
    t0 = time.time()
    argv = sys.argv[1:]
    skip = lambda p: p.startswith(SKIP_PATHS)
    files = [p for p in targets(argv) if not skip(p)]

    hits = []
    for p in files:
        lines = read_lines(p)
        if lines is None:
            continue
        for n, line in enumerate(lines, 1):
            for i, (word, _why) in enumerate(BANNED, 1):
                if word in line:
                    hits.append((p, n, i))

    if hits:
        print(f"금지어 검사: {len(hits)}건 — KM이 정한 금지어는 코드·주석·문서 어디에도 쓰지 않습니다 ({time.time() - t0:.1f}초)")
        for p, n, i in hits[:30]:
            print(f"  - {p}:{n} 금지어 #{i} ({labels(BANNED[i - 1][0])})")
        if len(hits) > 30:
            print(f"  … 외 {len(hits) - 30}건")
        for i, (word, why) in enumerate(BANNED, 1):
            print(f"  금지어 #{i}: {why}")
        print("  고치는 법: 그 단어를 빼고 다시 씁니다. 새 금지어는 이 파일 목록에 유니코드로 더합니다.")
        return 1

    print(f"금지어 검사: 이상 없음 ({len(files)}개 파일, {time.time() - t0:.1f}초)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
