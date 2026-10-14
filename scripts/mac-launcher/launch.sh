#!/bin/zsh
# 双击桌面「人物小镇.app」时运行：找到 Node（≥ 24），让本机服务在后台常驻
# （由 launchd 托管，关掉浏览器也不停；要停就运行同目录的 stop.sh），
# 确认它真的起来了，再打开开始界面。
#
# 环境变量：CHARACTER_TOWN_PORT（默认 8788，避开开发时常用的 8787）、
# CHARACTER_TOWN_NO_OPEN=1（只启动、不打开浏览器）。

set -u

PROJECT_DIR="${0:A:h:h:h}"
PORT="${CHARACTER_TOWN_PORT:-8788}"
RUNTIME_DIR="$HOME/Library/Application Support/人物小镇"
SERVICE_LABEL="com.nubis.character-town"
SERVICE_TARGET="gui/$(/usr/bin/id -u)/$SERVICE_LABEL"
OUT_LOG="$RUNTIME_DIR/server.out.log"
ERR_LOG="$RUNTIME_DIR/server.err.log"
STARTED_MARK="$RUNTIME_DIR/started"
PAGE_URL="http://127.0.0.1:$PORT/play.html"

show_error() {
  print -u2 -r -- "$1"
}

is_town_running() {
  /usr/bin/curl -fsS --max-time 1 "$PAGE_URL" 2>/dev/null | /usr/bin/grep -q "<title>人物小镇</title>"
}

# 桌面 .app 经 AppleScript `do shell script` 运行，PATH 只有系统默认目录，
# 不含 Homebrew / nvm，所以先试 PATH，再按常见位置找，并且要 24 或更新的版本。
find_node() {
  local candidate major
  local -a candidates
  candidates=(
    "$(command -v node 2>/dev/null)"
    /opt/homebrew/bin/node
    /usr/local/bin/node
    "$HOME"/.nvm/versions/node/*/bin/node(NnOn)
    "$HOME"/.volta/bin/node
    /usr/bin/node
  )
  for candidate in "${candidates[@]}"; do
    [[ -n "$candidate" && -x "$candidate" ]] || continue
    major="$("$candidate" -p 'process.versions.node.split(".")[0]' 2>/dev/null)"
    if [[ "$major" == <-> ]] && (( major >= 24 )); then
      print -r -- "$candidate"
      return 0
    fi
  done
  return 1
}

# 服务启动以后项目里有文件改过（例如更新了代码），就该重启一次才能用上新版本。
code_changed_since_start() {
  [[ -f "$STARTED_MARK" ]] || return 0
  [[ -n "$(/usr/bin/find "$PROJECT_DIR/server.mjs" "$PROJECT_DIR/play.html" "$PROJECT_DIR/stage.html" "$PROJECT_DIR/src" \
    -newer "$STARTED_MARK" -type f -print -quit 2>/dev/null)" ]]
}

# 正在跑的模拟不能被重启打断。
run_in_progress() {
  /usr/bin/curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/runs" 2>/dev/null | /usr/bin/grep -q '"active":{'
}

stop_service() {
  /bin/launchctl remove "$SERVICE_LABEL" >/dev/null 2>&1 || true
  for _ in {1..40}; do
    /bin/launchctl print "$SERVICE_TARGET" >/dev/null 2>&1 || return 0
    /bin/sleep 0.25
  done
}

start_service() {
  /bin/mkdir -p "$RUNTIME_DIR"
  stop_service
  : > "$STARTED_MARK"
  /bin/launchctl submit -l "$SERVICE_LABEL" -o "$OUT_LOG" -e "$ERR_LOG" -- \
    /usr/bin/env PORT="$PORT" HOST=127.0.0.1 "$NODE_BIN" "$PROJECT_DIR/server.mjs"
  for _ in {1..60}; do
    is_town_running && return 0
    /bin/sleep 0.25
  done
  return 1
}

if [[ ! -f "$PROJECT_DIR/server.mjs" || ! -f "$PROJECT_DIR/play.html" ]]; then
  show_error "找不到人物小镇的程序文件：$PROJECT_DIR"
  show_error "项目文件夹是不是移动或改名了？在新位置运行一次 scripts/mac-launcher/build.sh 重新生成启动器。"
  exit 1
fi

NODE_BIN="$(find_node)" || {
  show_error "没有找到 Node.js 24 或更新的版本。"
  show_error "请到 https://nodejs.org/ 安装（或 brew install node），装好后再双击人物小镇。"
  exit 1
}

if is_town_running; then
  if code_changed_since_start && ! run_in_progress; then
    start_service || {
      show_error "人物小镇更新后重启失败。"
      show_error "日志：$OUT_LOG"
      show_error "错误：$ERR_LOG"
      exit 1
    }
  fi
else
  if /usr/sbin/lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    show_error "端口 $PORT 已被别的程序占用，人物小镇无法启动。"
    show_error "可以先关掉那个程序，或者设置 CHARACTER_TOWN_PORT 换一个端口。"
    exit 1
  fi
  start_service || {
    show_error "人物小镇的本机服务没有启动起来。"
    show_error "使用的 Node：$NODE_BIN"
    show_error "日志：$OUT_LOG"
    show_error "错误：$ERR_LOG"
    exit 1
  }
fi

if [[ "${CHARACTER_TOWN_NO_OPEN:-0}" != "1" ]]; then
  /usr/bin/open "$PAGE_URL"
fi
