#!/bin/sh
# Install the Neuromesh testing build, or update it: run this again to update.
#
#   curl -fsSL https://raw.githubusercontent.com/farhanakhtar0x66/neuromesh/neuromesh-testing/install.sh | sh
#
# It keeps a copy of the `neuromesh-testing` branch in ~/.neuromesh/app and puts
# a `neuromesh` command in ~/.local/bin. Nothing else on your machine changes.
# Neuromesh runs on Node.js 24 or newer and needs git. It uses your own
# subscriptions through Codex, Claude Code, Antigravity or opencode: `/connect`
# in the app signs in.
#
# The testing build asks once whether you will share run reports with the
# author; see "Testing" in README.md for exactly what they contain.

set -eu

APP="${NEUROMESH_HOME:-$HOME/.neuromesh}/app"
BIN="$HOME/.local/bin"
REPO="${NEUROMESH_REPO:-https://github.com/farhanakhtar0x66/neuromesh.git}"
BRANCH="neuromesh-testing"

command -v git >/dev/null 2>&1 || { echo "Neuromesh needs git. Install it first."; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Neuromesh needs Node.js 24 or newer: https://nodejs.org"; exit 1; }
MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$MAJOR" -lt 24 ]; then
  echo "Neuromesh needs Node.js 24 or newer; this is $(node --version)."
  exit 1
fi

if [ -d "$APP/.git" ]; then
  echo "Updating Neuromesh in $APP"
  git -C "$APP" fetch --quiet origin "$BRANCH"
  git -C "$APP" checkout --quiet "$BRANCH"
  git -C "$APP" reset --quiet --hard "origin/$BRANCH"
else
  echo "Installing Neuromesh (testing build) in $APP"
  mkdir -p "$(dirname "$APP")"
  git clone --quiet --branch "$BRANCH" "$REPO" "$APP"
fi

mkdir -p "$BIN"
cat > "$BIN/neuromesh" <<EOF
#!/bin/sh
exec node "$APP/src/cli/main.ts" "\$@"
EOF
chmod +x "$BIN/neuromesh"

echo "Done: $(node "$APP/src/cli/main.ts" --version 2>/dev/null || echo neuromesh)"
case ":$PATH:" in
  *":$BIN:"*) ;;
  *) echo "Add $BIN to your PATH, then run: neuromesh" ;;
esac
echo "Open a project folder (a git repository) and run: neuromesh"
