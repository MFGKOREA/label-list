# [Task] KM이 보낸 유튜브 영상 50개를 스크립트로 읽고 공부 노트 쓰기

받는 사람: 그록 봇 (집 PC 브라우저)
보낸 사람: 클로드 코드 (총괄 채팅, KM 요청 11/15)
상태: 대기

규칙: `docs/aside/tasks/task-20261115-order-support.md` 를 먼저 읽고 그대로 지킨다.

## 무엇을
KM이 공부하라고 보낸 유튜브 영상 50개(AI 에이전트, 웹 자동화, Claude Code, Power Automate, n8n, 프롬프트)를 집 PC 브라우저에서 **스크립트(자막)** 로 읽는다. 영상마다 핵심과 우리 업무에 쓸 점을 한국어로 적는다.
클라우드의 클로드 코드는 유튜브가 막혀서 영상을 열지 못한다. 그래서 그록 봇이 영상을 읽는다. 클로드 코드는 이 노트를 공식 문서로 만든 노트와 합친다.

## 대상 (헷갈리기 쉬우니 꼭 확인)
| 무엇 | 맞는 것 | ❌ 하지 않음 |
|---|---|---|
| 영상 | 아래 목록의 50개 주소만 (유튜브 공개 영상) | 추천 영상·쇼츠·광고 링크 따라가기 |
| 읽는 곳 | 영상 아래 설명란의 [스크립트 표시] (영어 화면: [Show transcript]) | 유튜브 로그인, 구독·좋아요·댓글·저장 버튼 |
| 쓰는 곳 | `docs/aside/reports/report-20261115-order-video-study.md` 한 파일 | 스크립트 원문을 통째로 옮기기, 영상 화면 스크린샷 (둘 다 남의 저작물) |

## 우리 업무 ('업무에 쓸 점'을 쓸 때 참고)
- 발주앱(BOH 노트): 휴대폰 웹앱 + 구글 시트(Apps Script). POS 메뉴 판매와 레시피로 재료 사용량을 예상해서 발주량·프랩량을 낸다.
- GW Agent: 매장 PC의 크롬 확장. 회사 ERP(MIS) 화면을 조회만 해서 시트에 저장하고, 발주를 입력한다.
- 그록 봇: 집 PC 브라우저 일. 저장소의 지시서를 읽고 한다.
- 클로드 코드: 클라우드 세션. 코드·분석·지시서를 맡는다. 총괄 채팅이 여러 세션을 묶는다.
- DeskWidgets: 데스크톱 위젯 앱. 컨벤션센터 행사 일정을 시트로 보낸다.

## 영상 목록 (번호 · 주소 · 채널 · 제목)

### 묶음 1. AI 에이전트 (1~10)
1. https://www.youtube.com/watch?v=FwOTs4UxQS4 · Jeff Su · AI Agents, Clearly Explained
2. https://www.youtube.com/watch?v=F8NKVhkZZWI · IBM Technology · What are AI Agents?
3. https://www.youtube.com/watch?v=qU3fmidNbJE · Tina Huang · AI Agents Fundamentals In 21 Minutes
4. https://www.youtube.com/watch?v=bTMPwUgLZf0 · Tech With Tim · Build an AI Agent From Scratch in Python - Tutorial for Beginners
5. https://www.youtube.com/watch?v=jGg_1h0qzaM · freeCodeCamp.org · LangGraph Complete Course for Beginners – Complex AI Agents with Python
6. https://www.youtube.com/watch?v=aywZrzNaKjs · Rabbitmetrics · LangChain Explained in 13 Minutes
7. https://www.youtube.com/watch?v=rV3HJ4LEZ7k · Krish Naik · Complete Agentic AI Course In 10 Hours
8. https://www.youtube.com/watch?v=kJvXT25LkwA · (클로드 코드는 제목을 못 읽음. 열어 보고 제목·채널을 적는다)
9. https://www.youtube.com/watch?v=w7vqXL4PWEE · DeepLearningAI · Learn to build effective Agentic AI systems with Andrew Ng
10. https://www.youtube.com/watch?v=44eFf-tRiSg · OpenAI · Intro to Agent Builder

### 묶음 2. 웹 스크래핑·브라우저 자동화 (11~18)
11. https://www.youtube.com/watch?v=XVv6mJpFOb0 · freeCodeCamp.org · Web Scraping with Python - Beautiful Soup Crash Course
12. https://www.youtube.com/watch?v=ng2o98k983k · Corey Schafer · Python Tutorial: Web Scraping with BeautifulSoup and Requests
13. https://www.youtube.com/watch?v=tb8gHvYlCFs · Corey Schafer · Python Requests Tutorial
14. https://www.youtube.com/watch?v=Xjv1sY630Uc · Tech With Tim · Python Selenium Tutorial #1 - Web Scraping, Bots & Testing
15. https://www.youtube.com/watch?v=FRn5J31eAMw · edureka! · Selenium Full Course - Learn Selenium in 12 Hours
16. https://www.youtube.com/watch?v=4_m3HsaNwOE · Automation Step by Step · Playwright Beginner Tutorial 1 | What is Playwright
17. https://www.youtube.com/watch?v=PXMJ6FS7llk · freeCodeCamp.org · Automate with Python – Full Course for Beginners
18. https://www.youtube.com/watch?v=8GhFmQPZAlo · Fireship · Am I going to jail for web scraping?

### 묶음 3. Claude Code·Cursor·스킬·컴퓨터 사용 (19~31)
19. https://www.youtube.com/watch?v=fl1DSmwQKKY · Claude · What is Claude Code?
20. https://www.youtube.com/watch?v=6eBSHbLKuN0 · Anthropic · Mastering Claude Code in 30 minutes
21. https://www.youtube.com/watch?v=ntDIxaeo3Wg · Tech With Tim · Claude Code - Full Tutorial for Beginners
22. https://www.youtube.com/watch?v=QoQBzR1NIqI · Nick Saraev · CLAUDE CODE FULL COURSE 4 HOURS: Build & Sell (2026)
23. https://www.youtube.com/watch?v=SUysp3sJHbA · Net Ninja · Claude Code Tutorial #1 - Introduction & Setup
24. https://www.youtube.com/watch?v=WVeYLlKOWc0 · Cursor · Cursor Agent: 10 Pro Tips!
25. https://www.youtube.com/watch?v=ocMOZpuAMw4 · Tech With Tim · Cursor Tutorial for Beginners (AI Code Editor)
26. https://www.youtube.com/watch?v=UngVdAsQEiU · Web Dev Simplified · The Best Local Agentic Coding Workflow (Complete Guide)
27. https://www.youtube.com/watch?v=CEvIs9y1uog · AI Engineer · Don't Build Agents, Build Skills Instead – Barry Zhang & Mahesh Murag, Anthropic
28. https://www.youtube.com/watch?v=bjdBVZa66oU · Claude · What are skills?
29. https://www.youtube.com/watch?v=DVRg0daTads · Fireship · Claude has taken control of my computer...
30. https://www.youtube.com/watch?v=8UWKxJbjriY · OpenAI · Introducing ChatGPT Atlas
31. https://www.youtube.com/watch?v=1jn_RpbPbEc · OpenAI · Introduction to ChatGPT agent

### 묶음 4. Power Automate·RPA (32~37)
32. https://www.youtube.com/watch?v=IQ_KpBC8fwo · Kevin Stratvert · How to use Microsoft Power Automate Desktop - Full tutorial
33. https://www.youtube.com/watch?v=dDO4Y4aDYXw · Kevin Stratvert · Power Automate Tutorial for Beginners
34. https://www.youtube.com/watch?v=DgBZiBIgh3w · Leila Gharani · Power Automate Desktop Tutorial: Web Scraping Made Easy (Free, No Code)
35. https://www.youtube.com/watch?v=f1lTMzWygTA · Teacher's Tech · Microsoft Power Automate for Beginners: Start Automating Today!
36. https://www.youtube.com/watch?v=kg15yZiBGxE · Simplilearn · RPA UiPath Full Course
37. https://www.youtube.com/watch?v=9URSbTOE4YI · Simplilearn · RPA In 5 Minutes | What Is RPA

### 묶음 5. n8n·Make (38~43)
38. https://www.youtube.com/watch?v=ONgECvZNI3o · NetworkChuck · You NEED to Use n8n RIGHT NOW!! (Free, Local, Private)
39. https://www.youtube.com/watch?v=UIf-SlmMays · freeCodeCamp.org · n8n Tutorial – Zero to Hero Course
40. https://www.youtube.com/watch?v=Ey18PDiaAYI · Nate Herk · Build & Sell n8n AI Agents (8+ Hour Course, No Code)
41. https://www.youtube.com/watch?v=4cQWJViybAQ · n8n · n8n Quick Start Tutorial: Build Your First Workflow [2025]
42. https://www.youtube.com/watch?v=bS9R6aCVEzw · Fireship · n8n will change your life as a developer...
43. https://www.youtube.com/watch?v=JSA2oezQWOU · Kevin Stratvert · Make.com Automation Tutorial for Beginners

### 묶음 6. 프롬프트·LLM·API·MCP (44~50)
44. https://www.youtube.com/watch?v=jC4v5AS4RIM · Jeff Su · Master the Perfect ChatGPT Prompt Formula (in just 8 minutes)!
45. https://www.youtube.com/watch?v=_ZvnD73m40o · freeCodeCamp.org · Prompt Engineering Tutorial – Master ChatGPT and LLM Responses
46. https://www.youtube.com/watch?v=p09yRj47kNM · Tina Huang · Google's 9 Hour AI Prompt Engineering Course In 20 Minutes
47. https://www.youtube.com/watch?v=zjkBMFhNj_g · Andrej Karpathy · [1hr Talk] Intro to Large Language Models
48. https://www.youtube.com/watch?v=YhRfgYH_AoU · The iScale · Prompt Engineering Full Course | From Beginner to Pro
49. https://www.youtube.com/watch?v=WXsD0ZgxjRw · freeCodeCamp.org · APIs for Beginners - How to use an API (Full Course / Tutorial)
50. https://www.youtube.com/watch?v=7j1t3UZA1TY · IBM Technology · MCP vs API: Simplifying AI Agent Integration with External Data

## 진행표 (묶음이 끝날 때마다 고치고 push)
| 묶음 | 영상 | 상태 |
|---|---|---|
| 1 | 1~10 | 대기 |
| 2 | 11~18 | 대기 |
| 3 | 19~31 | 대기 |
| 4 | 32~37 | 대기 |
| 5 | 38~43 | 대기 |
| 6 | 44~50 | 대기 |

## 순서 (영상 하나마다)
1. 영상 주소를 연다. 영상 제목이 보일 때까지 기다린다. 소리는 꺼도 된다. 광고가 나오면 [건너뛰기]가 보일 때 누르거나, 끝날 때까지 기다린다.
   - "비공개 동영상", "재생할 수 없음", "연령 확인" 같은 문구가 보이면 그 문구만 적고 다음 영상으로 간다.
   - "봇이 아님을 확인" 화면이나 로그인 창이 나오면 멈추고 KM을 기다린다. 대신 로그인하지 않는다.
2. 영상 길이를 적는다. 설명란의 [...더보기] 를 누르고, 챕터(시간표)가 있는지 본다.
3. 설명란 아래쪽의 [스크립트 표시] 를 누른다. 화면 오른쪽에 시간이 붙은 스크립트 칸이 보일 때까지 기다린다.
   - 버튼이 없으면 "스크립트 없음"이라고 적는다. 설명란과 챕터 제목만으로 쓰고, 그렇게 썼다고 적는다.
4. 읽는 양:
   - 40분 이하: 스크립트 전체를 끝까지 스크롤하며 읽는다.
   - 40분 넘음: 챕터 제목 목록을 먼저 보고, 우리 업무와 가까운 챕터 2~3개만 읽는다. 챕터가 없으면 앞 20분만 읽는다.
5. 보고서에 아래 모양으로 쓴다. 줄마다 영상 속 시간(MM:SS)을 붙인다. 영상이 말하지 않은 것은 짐작해서 채우지 않는다.

```
### N. 제목 (채널, 길이)
- 읽은 범위: 전체 / 챕터 "…", "…" / 앞 20분 / 스크립트 없음
- 핵심: 3~5줄 (줄마다 시간)
- 우리 업무에 쓸 점: 1~2줄 (없으면 "없음")
- 확인 못 한 것: (있으면)
```

## 한 번에 다 못 하면
- 묶음 하나가 끝날 때마다 보고서와 위 진행표를 고쳐서 push 한다.
- 멈출 때는 이 파일의 `상태:` 를 `대기 (다음: 영상 N번부터)` 로 고쳐서 push 한다. 다음 실행이 그 번호부터 이어서 한다.

## 확인
| 확인 | 방법 | 정상 기준 |
|---|---|---|
| 50개가 모두 있는지 | 보고서의 `### 번호` | 1~50 모두 있음 (못 연 영상도 이유와 함께) |
| 읽은 범위를 적었는지 | 영상마다 '읽은 범위' 줄 | 50줄 |
| 원문 복사·화면 저장이 없는지 | 보고서를 다시 읽음 | 한 문장 넘는 인용 없음, 이미지 없음 |
| 비밀·매장 숫자가 없는지 | 보고서를 다시 읽음 | 키·계정·매출·발주 수량·사람 이름 없음 |

## 끝나면
1. 이 파일의 `상태:` 를 `완료` (또는 `막힘: 이유`) 로 고친다.
2. 보고서 맨 위에 결과 3줄(몇 개 읽었는지 / 못 연 영상 / 우리 일에 가장 쓸모 있는 영상 3개)과 후속 제안을 적는다.
3. `docs/aside/board.md` 맨 아래에 `- MM/DD HH:MM [그록 봇 → 클로드 코드] 영상 50개 공부 노트 (N개 읽음)` 를 덧붙인다. 커밋 메시지 앞에 `[그록 봇]` 을 붙여 push 한다.
