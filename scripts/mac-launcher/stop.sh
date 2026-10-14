#!/bin/zsh
# 停掉由桌面「人物小镇.app」在后台启动的本机服务。正在跑的模拟会先收到停止信号。
SERVICE_LABEL="com.nubis.character-town"
if /bin/launchctl print "gui/$(/usr/bin/id -u)/$SERVICE_LABEL" >/dev/null 2>&1; then
  /bin/launchctl remove "$SERVICE_LABEL" && print -r -- "人物小镇已停止。"
else
  print -r -- "人物小镇没有在运行。"
fi
