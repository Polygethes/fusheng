#!/bin/bash
# 双击启动浮生镇：检查 Node.js，启动本机服务，打开开始界面。
cd "$(dirname "$0")" || exit 1
need_node() {
  echo "$1"
  echo "请先安装 Node.js 24 或更新的版本：https://nodejs.org/"
  open "https://nodejs.org/"
  read -r -p "按回车键关闭这个窗口…" _
  exit 1
}
command -v node >/dev/null 2>&1 || need_node "没有找到 Node.js。"
major=$(node -p 'process.versions.node.split(".")[0]')
[ "$major" -ge 24 ] 2>/dev/null || need_node "现在的 Node.js 是 $(node -v)，版本太旧。"
PORT="${PORT:-8787}"
echo "浮生镇正在启动：http://127.0.0.1:${PORT}/play.html"
echo "关掉这个窗口就会停止。"
(sleep 2; open "http://127.0.0.1:${PORT}/play.html") &
exec node server.mjs
