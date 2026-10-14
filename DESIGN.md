---
name: "人物小镇"
description: "一座把角色内心、现实行动与故事书写分层呈现的实时戏剧沙盘"
colors:
  void: "#101214"
  graphite: "#171A1D"
  raised-graphite: "#202428"
  paper: "#F2EFE9"
  quiet-ink: "#A9AFB5"
  divider: "#343A40"
  psyche: "#8197BC"
  reality: "#D46B4D"
  story: "#86A17C"
typography:
  display:
    fontFamily: "ui-serif, Songti SC, STSong, Georgia, serif"
    fontSize: "32px"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "0"
  body:
    fontFamily: "ui-serif, Songti SC, STSong, Georgia, serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.9
    letterSpacing: "0"
  ui:
    fontFamily: "Inter, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0"
rounded:
  sm: "4px"
  md: "8px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "16px"
  lg: "24px"
  xl: "36px"
components:
  button-primary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.void}"
    rounded: "{rounded.sm}"
    padding: "10px 16px"
    height: "44px"
  input:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
    height: "44px"
  reading-surface:
    backgroundColor: "{colors.void}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "24px"
---

# Design System: 人物小镇

## Overview

**Creative North Star: "三层剧场"**

界面像一座横向展开的排练场：观众可以进入人物的内心，回到正在发生的现实，再走进编辑故事的写作间。三个空间共享同一套安静、精准的框架，但各自有明确的阅读节奏和功能边界。

系统拒绝后台仪表盘、卡片堆、机制标签和游戏 HUD。信息层级主要依靠版面宽度、细分隔线、文字密度与少量语义色建立；设置、档案和调试能力收进次级入口。

**Key Characteristics:**
- 三个一级空间始终可见，其他功能渐进披露。
- 长文本是画面主体，控件沿边缘安静排列。
- 平面分层、窄边框、短动效，不使用装饰性渐变。
- 桌面端充分利用横向空间，移动端保持单一阅读焦点。

## Colors

底色是中性的墨黑与石墨灰，三种低饱和语义色只用于标记空间和当前状态。

### Primary
- **现实朱红** (`#D46B4D`)：播放、正在发生和现实空间的唯一强调色。

### Secondary
- **心理雾蓝** (`#8197BC`)：角色私密视角、选择人物和心理空间状态。

### Tertiary
- **故事苔绿** (`#86A17C`)：故事草稿、保存状态与故事空间。

### Neutral
- **舞台黑** (`#101214`)：应用背景与主要阅读面。
- **石墨** (`#171A1D`)：工具栏、编辑器和次级区域。
- **亮石墨** (`#202428`)：悬停和选中前景。
- **纸白** (`#F2EFE9`)：主要文字与高优先级按钮。
- **静墨灰** (`#A9AFB5`)：时间、地点和辅助信息。
- **分隔灰** (`#343A40`)：结构线、输入边框和区域边界。

**The Sparse Accent Rule.** 每个空间只使用自己的语义色，语义色不超过可见画面的约一成。

## Typography

**Display Font:** `ui-serif`, Songti SC, STSong, Georgia, serif  
**Body Font:** `ui-serif`, Songti SC, STSong, Georgia, serif  
**UI Font:** Inter, PingFang SC, Microsoft YaHei, system-ui, sans-serif

**Character:** 正文接近小说排印，控件保持现代、紧凑和清晰。两类字形的切换直接提示用户正在阅读内容还是操作工具。

### Hierarchy
- **Display** (500, 32px, 1.25)：世界名或当前空间标题，只在主画面出现一次。
- **Headline** (500, 22px, 1.4)：人物名、场景题头和故事标题。
- **Title** (600, 15px, 1.4)：工具组和列表标题。
- **Body** (400, 17px, 1.9)：内心独白、现实散文与故事正文，行宽控制在 46–72ch。
- **Label** (500, 13–14px, 1.4)：按钮、状态和元信息，不使用负字距。

**The Prose Leads Rule.** 正文永远比标签更醒目；不得用大标题、粗标签或彩色徽章打断连续阅读。

## Elevation

系统以平面和色阶分层，不用宽泛阴影。区域通过 `1px` 分隔线、背景明度差和固定的空间边界获得深度；只有浮层菜单可以使用轻微、短距离阴影。

**The Flat-by-Default Rule.** 静止表面保持平坦，焦点通过边框和颜色变化表达，不通过抬升表达。

## Components

### Buttons
- **Shape:** 轻微直角感，`4px` 圆角，最小高度 `44px`。
- **Primary:** 纸白底、舞台黑字；现实播放按钮可使用现实朱红。
- **Hover / Focus:** 背景仅提升一个色阶；键盘焦点使用 `2px` 外描边。
- **Ghost:** 透明底和分隔灰边框，只承载次级命令。

### Chips
- **Style:** 仅用于紧凑选项和状态，不作装饰；默认透明背景和单线边框。
- **State:** 选中时使用所属空间的语义色文字与柔和底色，并保留图标或字重差异。

### Cards / Containers
- **Corner Style:** 最大 `8px`，多数主区域不使用卡片。
- **Background:** 主空间是全宽平面；卡片只允许用于可重复的角色或档案条目。
- **Shadow Strategy:** 默认无阴影。
- **Border:** `1px` 分隔灰；禁止卡片嵌套卡片。
- **Internal Padding:** `16–24px`，长文本区域可到 `36px`。

### Inputs / Fields
- **Style:** 石墨背景、分隔灰边框、`4px` 圆角，标签置于字段上方或使用可访问名称。
- **Focus:** 边框切换为空间语义色，并有可见外描边。
- **Error / Disabled:** 错误使用文字说明；禁用状态降低对比但保持可读。

### Navigation
- 三个空间是唯一一级导航，并始终以文字名称呈现。
- 建镇、档案、导入导出和重置放入次级菜单，不与空间争夺注意力。
- 当前空间同时使用底线、语义色和 `aria-current` 表达。

## Do's and Don'ts

### Do
- 让心理、现实、故事的数据来源和视觉节奏都清楚不同。
- 保留宽阔连续的阅读面，并让控制条贴近它所影响的内容。
- 用具体时间、地点、人物和保存状态代替机制术语。
- 在移动端一次只展示一个主要阅读或编辑表面。

### Don't
- 不恢复十三个并列顶栏入口。
- 不把每条行动、想法或对白装进独立卡片。
- 不在现实空间泄露私密心理，也不在故事空间自动修改正史。
- 不使用暖棕单色、霓虹渐变、玻璃拟态、发光圆球或夸张大标题。
