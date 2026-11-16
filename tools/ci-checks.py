#!/usr/bin/env python3
# CI 문법 검사 (2026-11-16): JSON·YAML 문법, 그리고 표준 태스크 패킷(docs/aside/task-schema.json) 검사.
#  PR이 열리거나 고쳐질 때(그리고 main 푸시) .github/workflows/pr-check.yml 이 이 파일을 돌린다.
#  손으로도 같은 검사를 돌려 볼 수 있게 CI와 같은 코드를 여기에 둔다.
# 사용:
#   python3 tools/ci-checks.py                 전부 (JSON · YAML · 태스크 패킷)
#   python3 tools/ci-checks.py --only json
#   python3 tools/ci-checks.py --packets <파일...>   지정한 패킷만 검사
#   python3 tools/ci-checks.py --selftest      검사기 자체 시험(나쁜 패킷이 정말 걸리는지)
# 끝 코드: 0 통과 · 1 걸림 · 2 검사 자체를 못 함(도구 없음 등)
import glob
import json
import os
import re
import subprocess
import sys
import time

ROOT = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip() or os.getcwd()
# 남이 만든 스킬 묶음은 우리 자료가 아니고, 일부러 깨진 시험용 JSON도 섞여 있다(guard.py와 같은 기준)
SKIP_PATHS = (".claude/skills/",)
SCHEMA_PATH = "docs/aside/task-schema.json"


def tracked(pattern=""):
    args = ["git", "-C", ROOT, "ls-files"]
    if pattern:
        args.append(pattern)
    out = subprocess.run(args, capture_output=True, text=True).stdout
    return [p for p in out.splitlines() if p and not p.startswith(SKIP_PATHS)]


# ---------------------------------------------------------------- JSON

def check_json(files=None):
    files = files or [p for p in tracked() if p.endswith((".json", ".webmanifest"))]
    bad = []
    for p in files:
        try:
            json.load(open(os.path.join(ROOT, p), encoding="utf-8"))
        except Exception as e:  # 문법 오류
            bad.append((p, str(e).splitlines()[0][:160]))
    if bad:
        print(f"JSON 문법: {len(bad)}건 틀림 ({len(files)}개 중)")
        for p, e in bad:
            print(f"  - {p}: {e}")
        return len(bad)
    print(f"JSON 문법: 통과 ({len(files)}개)")
    return 0


# ---------------------------------------------------------------- YAML

def check_yaml(files=None):
    try:
        import yaml
    except ImportError:
        print("YAML 문법: 검사 못 함 — PyYAML이 없습니다. `python3 -m pip install pyyaml` 뒤 다시 돌리세요.")
        return None  # 검사 불가(통과로 치지 않음)
    files = files or [p for p in tracked() if p.endswith((".yml", ".yaml"))]
    bad = []
    for p in files:
        try:
            docs = list(yaml.safe_load_all(open(os.path.join(ROOT, p), encoding="utf-8")))
        except Exception as e:
            bad.append((p, str(e).splitlines()[0][:160]))
            continue
        # 워크플로 파일은 최소한의 모양(on·jobs)이 있어야 GitHub이 읽는다
        if p.startswith(".github/workflows/"):
            doc = next((d for d in docs if isinstance(d, dict)), None)
            if not doc or "jobs" not in doc or not any(k in doc for k in ("on", True)):
                bad.append((p, "워크플로 모양이 아님(on·jobs 없음)"))
    if bad:
        print(f"YAML 문법: {len(bad)}건 틀림 ({len(files)}개 중)")
        for p, e in bad:
            print(f"  - {p}: {e}")
        return len(bad)
    print(f"YAML 문법: 통과 ({len(files)}개)")
    return 0


# ---------------------------------------------------------------- 태스크 패킷 (작은 스키마 검사기)

TYPES = {
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "string": lambda v: isinstance(v, str),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
}


def _validate(value, schema, where, errs):
    """draft-07 중 이 저장소 스키마가 쓰는 것만 본다(type·required·properties·enum·const·pattern·길이·크기·items·additionalProperties)."""
    t = schema.get("type")
    if t:
        types = t if isinstance(t, list) else [t]
        if not any(TYPES[x](value) for x in types if x in TYPES):
            errs.append(f"{where}: {t} 여야 하는데 {type(value).__name__}임")
            return
    if "const" in schema and value != schema["const"]:
        errs.append(f"{where}: {schema['const']!r} 이어야 함(지금 {value!r})")
    if "enum" in schema and value not in schema["enum"]:
        errs.append(f"{where}: {value!r} 은 쓸 수 없음 — {', '.join(map(str, schema['enum']))} 중 하나")
    if isinstance(value, str):
        if "pattern" in schema and not re.search(schema["pattern"], value):
            errs.append(f"{where}: {value!r} 이 모양({schema['pattern']})과 다름")
        if "minLength" in schema and len(value) < schema["minLength"]:
            errs.append(f"{where}: {len(value)}자 — {schema['minLength']}자 이상이어야 함")
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            errs.append(f"{where}: {len(value)}자 — {schema['maxLength']}자 이하여야 함")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            errs.append(f"{where}: {value} — {schema['minimum']} 이상이어야 함")
        if "maximum" in schema and value > schema["maximum"]:
            errs.append(f"{where}: {value} — {schema['maximum']} 이하여야 함")
    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            errs.append(f"{where}: {len(value)}개 — {schema['minItems']}개 이상이어야 함")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            errs.append(f"{where}: {len(value)}개 — {schema['maxItems']}개 이하여야 함")
        if isinstance(schema.get("items"), dict):
            for i, item in enumerate(value):
                _validate(item, schema["items"], f"{where}[{i}]", errs)
    if isinstance(value, dict):
        for key in schema.get("required", []):
            if key not in value:
                errs.append(f"{where}: '{key}' 가 없음")
        props = schema.get("properties", {})
        for key, sub in props.items():
            if key in value:
                _validate(value[key], sub, f"{where}.{key}", errs)
        if schema.get("additionalProperties") is False:
            for key in value:
                if key not in props:
                    errs.append(f"{where}: '{key}' 는 정해진 칸이 아님")


def validate_packet(packet, schema):
    errs = []
    _validate(packet, schema, "패킷", errs)
    if not isinstance(packet, dict):
        return errs
    # 스키마 문법 밖이라 여기서 직접 보는 칸끼리의 규칙(docs/ai-protocol.md 4·6·7장)
    if packet.get("assigned_to") and packet.get("assigned_to") == packet.get("verify_by"):
        errs.append("패킷: verify_by가 assigned_to와 같음 — 만든 AI가 자기 일을 검증할 수 없음")
    if packet.get("status") == "blocked" and not str(packet.get("blocked_reason", "")).strip():
        errs.append("패킷: status가 blocked인데 blocked_reason이 비어 있음(원인 한 줄 필요)")
    if isinstance(packet.get("retry_count"), int) and packet["retry_count"] >= 1 and not packet.get("evidence"):
        errs.append("패킷: retry_count가 1 이상인데 evidence가 비어 있음(마지막 시도·오류를 남길 것)")
    return errs


def check_packets(paths=None):
    try:
        schema = json.load(open(os.path.join(ROOT, SCHEMA_PATH), encoding="utf-8"))
    except Exception as e:
        print(f"태스크 패킷: 스키마를 못 읽음 — {SCHEMA_PATH}: {e}")
        return 1
    if not schema.get("required"):
        print(f"태스크 패킷: 스키마에 required 목록이 없음 — {SCHEMA_PATH}")
        return 1
    if paths:
        files = list(paths)
    else:
        files = [p for p in glob.glob(os.path.join(ROOT, "docs/aside/tasks/*.json"))]
        files = [os.path.relpath(p, ROOT) for p in files]
        if os.path.exists(os.path.join(ROOT, "docs/aside/task-packet.example.json")):
            files.append("docs/aside/task-packet.example.json")
    bad = 0
    for p in sorted(files):
        try:
            packet = json.load(open(os.path.join(ROOT, p), encoding="utf-8"))
        except Exception as e:
            print(f"  - {p}: JSON을 못 읽음 — {e}")
            bad += 1
            continue
        errs = validate_packet(packet, schema)
        if errs:
            print(f"  - {p}: {len(errs)}건")
            for e in errs:
                print(f"      {e}")
            bad += 1
    if bad:
        print(f"태스크 패킷: {bad}개 파일 틀림 ({len(files)}개 중) — 스키마 {SCHEMA_PATH}")
        return bad
    print(f"태스크 패킷: 통과 ({len(files)}개) — 스키마 {SCHEMA_PATH}")
    return 0


def selftest():
    """나쁜 패킷은 걸리고 좋은 패킷은 통과하는지 확인(검사기가 비어 있지 않다는 증거)."""
    schema = json.load(open(os.path.join(ROOT, SCHEMA_PATH), encoding="utf-8"))
    good = json.load(open(os.path.join(ROOT, "docs/aside/task-packet.example.json"), encoding="utf-8"))
    cases = {
        "좋은 패킷": (good, True),
        "칸이 빠짐": ({k: v for k, v in good.items() if k != "evidence"}, False),
        "일 번호 모양": ({**good, "task_id": "2026-1"}, False),
        "실패 상한 4": ({**good, "max_retries": 4}, False),
        "자기 검증": ({**good, "verify_by": "claude-code"}, False),
        "음수 sla": ({**good, "sla_sec": -1}, False),
        "없는 담당": ({**good, "assigned_to": "chatgpt"}, False),
        "막힘인데 이유 없음": ({**good, "status": "blocked", "blocked_reason": ""}, False),
        "실패했는데 증거 없음": ({**good, "retry_count": 2, "evidence": []}, False),
    }
    bad = 0
    for name, (packet, should_pass) in cases.items():
        errs = validate_packet(packet, schema)
        ok = (not errs) == should_pass
        print(f"  {'○' if ok else '×'} {name}: {'통과' if not errs else str(len(errs)) + '건 걸림'}")
        if not ok:
            bad += 1
    print(f"검사기 자체 시험: {'통과' if bad == 0 else f'{bad}건 틀림'} ({len(cases)}가지)")
    return bad


def main():
    t0 = time.time()
    argv = sys.argv[1:]
    if "--selftest" in argv:
        return 1 if selftest() else 0

    only = None
    packet_paths = None
    if "--only" in argv:
        only = argv[argv.index("--only") + 1].split(",")
    if "--packets" in argv:
        packet_paths = [a for a in argv[argv.index("--packets") + 1:] if not a.startswith("-")]

    total, unable = 0, False
    if not only or "json" in only:
        total += check_json()
    if not only or "yaml" in only:
        r = check_yaml()
        unable = unable or r is None
        total += r or 0
    if not only or "packets" in only:
        total += check_packets(packet_paths)

    sec = time.time() - t0
    if total:
        print(f"문법 검사: {total}건 걸림 ({sec:.1f}초)")
        return 1
    if unable:
        print(f"문법 검사: 모두 통과했지만 YAML은 검사하지 못했습니다 ({sec:.1f}초)")
        return 2
    print(f"문법 검사: 모두 통과 ({sec:.1f}초)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
