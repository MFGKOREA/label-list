# order-src의 app.css / app-body.html / app.js를 ../order.html 안에 끼워 넣습니다 (order.html이 실제 배포 파일).
# 사용: python3 order-src/build.py
import os
here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, "..", "order.html")
rd = lambda n: open(os.path.join(here, n), encoding="utf-8").read()
s, css, body = rd("app.js"), rd("app.css"), rd("app-body.html")
html = open(out, encoding="utf-8").read()
a = html.index("<style>") + 8; b = html.index("</style>")
html = html[:a] + css + "\n" + html[b:]
a = html.index("<body>") + 7; b = html.index("<script>\n", a)
html = html[:a] + body + "\n" + html[b:]
a = html.index("<script>\n", html.index("<body>")) + 9; b = html.rindex("</script>")
html = html[:a] + s + "\n" + html[b:]
open(out, "w", encoding="utf-8").write(html)
print("order.html 빌드 완료")
