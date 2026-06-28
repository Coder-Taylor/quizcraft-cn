# QuizCraft CN — Android 客户端

刷题助手 v2.0 的 Android 端，WebView 壳加载 `https://superhuazai.me/practice`，与 Web 端、桌面端共用同一后端数据库，实现三端数据同步。

## 技术栈

| 层面 | 技术 |
|------|------|
| 语言 | Java |
| 最低 SDK | Android 7.0 (API 24) |
| 目标 SDK | Android 14 (API 34) |
| WebView | 系统内置 |
| 下拉刷新 | SwipeRefreshLayout |

## 快速开始

### 方式一：直接安装 APK

从 [Releases](https://github.com/jry21223/quizcraft-cn/releases) 下载最新 APK，或在本目录执行：

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### 方式二：Android Studio 构建

```bash
# 1. 打开 Android Studio → File → Open → 选择 android-app 目录
# 2. 等待 Gradle 同步完成
# 3. 点击 Run 按钮（或 Shift+F10）运行到手机

# 或命令行构建
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## 功能

- ✅ 加载 https://superhuazai.me/practice（React SPA）
- ✅ 下拉刷新同步最新题库
- ✅ 返回键弹出退出确认
- ✅ QQ 群号一键复制到剪贴板
- ✅ 页面加载提示「祝大家考试顺利」
- ✅ 离线提示页
- ✅ 多端数据同步（共用 PostgreSQL）

## 项目结构

```
android-app/
├── build.gradle              # 项目级构建
├── settings.gradle           # 项目设置
├── gradlew / gradlew.bat     # Gradle wrapper
├── app/
│   ├── build.gradle          # 模块构建
│   ├── proguard-rules.pro    # 混淆规则
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── java/com/quizcraft/android/
│       │   └── MainActivity.java
│       └── res/
│           ├── layout/       # 布局文件
│           ├── drawable/     # 图标和背景
│           └── values/       # 颜色、字符串、主题
└── gradle/wrapper/           # Gradle 版本管理
```
