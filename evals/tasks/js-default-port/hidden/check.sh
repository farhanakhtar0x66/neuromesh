set -e
grep -q "DEFAULT_PORT = 8080;" src/server.js
! grep -q 3000 src/server.js README.md
test "$(grep -c 8080 README.md)" -ge 2
git diff --stat HEAD -- . ':(exclude)hidden' | tail -1 | grep -q "2 files changed"
