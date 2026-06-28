# QuizCraft Android ProGuard 规则
# WebView 需要保留 JavaScript 接口类
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# 保留 WebView 相关类
-keep class android.webkit.** { *; }

# 保留 AppCompatActivity 和相关 AndroidX 类
-keep class androidx.** { *; }
