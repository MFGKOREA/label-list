#!/usr/bin/env python3
# PR 본문 체크리스트 확인 (2026-11-16): PR에 .github/pull_request_template.md 칸이 채워졌는지 본다.
#  지금은 경고만 남기고 PR을 막지 않는다(--strict를 주면 막음). 막을지는 KM이 정한다.
# 사용:
#   python3 tools/pr-checklist.py                 GitHub Actions에서(PR 본문은 GITHUB_EVENT_PATH에서 읽음)
#   python3 tools/pr-checklist.py --body-file x.md
#   python3 tools/pr-checklist.py --strict        비어 있으면 끝 코드 1
# 끝 코드: 0 통과(또는 경고만) · 1 --strict에서 비어 있음
import json
import os
import re
import sys

SECTIONS = [
    "보안",
    "성능",
    "상태 머신",
    "GPT 반박 검증",
    "되돌릴 수 없는 일",
    "시험 결과",
]


def body_from_args(argv):
    if "--body-file" in argv:
        return open(argv[argv.index("--body-file") + 1], encoding="utf-8").read()
    path = os.environ.get("GITHUB_EVENT_PATH")
    if path and os.path.exists(path):
        try:
            event = json.load(open(path, encoding="utf-8"))
            return ((event.get("pull_request") or {}).get("body") or "")
        except Exception:
            return ""
    return sys.stdin.read() if not sys.stdin.isatty() else ""


def main():
    argv = sys.argv[1:]
    strict = "--strict" in argv
    body = body_from_args(argv)
    on_actions = os.environ.get("GITHUB_ACTIONS") == "true"
    say = (lambda m: print(f"::warning::{m}")) if on_actions else print

    if not body.strip():
        say("PR 본문이 비어 있습니다 — .github/pull_request_template.md 칸(보안·성능·엣지케이스·GPT 반박 검증·시험 결과)을 채워 주세요.")
        return 1 if strict else 0

    missing = [s for s in SECTIONS if s not in body]
    # 체크박스를 하나라도 켰는가(- [x] 또는 - [X])
    checked = bool(re.search(r"^\s*[-*]\s*\[[xX]\]", body, re.M))
    gpt_done = "[GPT 검증 완료]" in body or "GPT 검증 완료" in body

    if missing:
        say("PR 본문에 빠진 칸: " + ", ".join(missing) + " — 템플릿 칸을 그대로 두고 내용을 채워 주세요.")
    if not checked:
        say("체크한 항목이 하나도 없습니다 — 확인한 것만 [x]로 바꿔 주세요.")
    if not gpt_done:
        say("GPT 반박 검증 판정이 없습니다 — 만든 AI가 아닌 AI의 검증 결과와 `[GPT 검증 완료]` 줄을 남겨 주세요.")

    if missing or not checked or not gpt_done:
        return 1 if strict else 0
    print("PR 본문 체크리스트: 통과")
    return 0


if __name__ == "__main__":
    sys.exit(main())
