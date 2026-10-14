#!/bin/zsh
# 生成桌面启动器「人物小镇.app」（默认放到桌面）：
#   zsh scripts/mac-launcher/build.sh [目标文件夹]
# 启动器只记住本项目里 launch.sh 的位置；项目移动后在新位置重新运行一次即可。
set -eu

HERE="${0:A:h}"
DEST="${1:-$HOME/Desktop}"
APP="$DEST/人物小镇.app"
BUNDLE_ID="com.nubis.character-town.launcher"
NODE_BIN="$(command -v node)"

if [[ -e "$APP" ]]; then
  existing="$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$APP/Contents/Info.plist" 2>/dev/null || true)"
  if [[ "$existing" != "$BUNDLE_ID" ]]; then
    print -u2 -r -- "$APP 已存在，但不是这个脚本生成的启动器，没有覆盖。"
    exit 1
  fi
fi

WORK="$(/usr/bin/mktemp -d)"
trap '/bin/rm -rf "$WORK"' EXIT

script="$(<"$HERE/main.js")"
print -r -- "${script//__LAUNCH_SCRIPT__/$HERE/launch.sh}" > "$WORK/main.js"
"$NODE_BIN" "$HERE/make-icon.mjs" "$WORK/icon.iconset" >/dev/null
/usr/bin/iconutil -c icns "$WORK/icon.iconset" -o "$WORK/icon.icns"

/bin/rm -rf "$APP"
/usr/bin/osacompile -l JavaScript -o "$APP" "$WORK/main.js"
/bin/cp "$WORK/icon.icns" "$APP/Contents/Resources/applet.icns"
/bin/rm -f "$APP/Contents/Resources/Assets.car"
PLIST="$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string $BUNDLE_ID" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $BUNDLE_ID" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleName 人物小镇" "$PLIST"
/usr/bin/codesign --force --deep --sign - "$APP" >/dev/null 2>&1
/usr/bin/touch "$APP"
print -r -- "已生成：$APP"
