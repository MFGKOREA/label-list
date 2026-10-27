// SessionStart: using-superpowers 스킬을 세션 시작 때 컨텍스트로 넣어요.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
let skill = "";
try {
  skill = readFileSync(join(dir, ".claude/skills/using-superpowers/SKILL.md"), "utf8");
} catch {
  process.exit(0);
}
const rules = [
  "이 저장소 작업 규칙(superpowers):",
  "- 새 기능·큰 변경: brainstorming → writing-plans → executing-plans 순서",
  "- 버그·이상한 숫자: systematic-debugging 먼저",
  "- 배포·완료 보고 전: verification-before-completion (빌드·스모크·회귀 시험 결과 확인)",
].join("\n");
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: "<EXTREMELY_IMPORTANT>\n" + skill + "\n\n" + rules + "\n</EXTREMELY_IMPORTANT>",
  },
}));
