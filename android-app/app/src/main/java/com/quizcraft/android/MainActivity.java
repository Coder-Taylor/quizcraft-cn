package com.quizcraft.android;

import android.annotation.SuppressLint;
import android.app.Dialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.drawable.ColorDrawable;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.Bundle;
import android.util.DisplayMetrics;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

/**
 * QuizCraft CN - Android 端 WebView 壳
 * <p>
 * 多端协同：加载 https://superhuazai.me/practice
 * 所有练习数据通过后端 API 存入 PostgreSQL，与 Web 端/桌面端实时同步。
 */
public class MainActivity extends AppCompatActivity {

    private static final String TARGET_URL = "https://superhuazai.me/practice";
    private static final String USER_AGENT_SUFFIX = " QuizCraft-Android/1.0";

    private WebView webView;
    private SwipeRefreshLayout swipeRefreshLayout;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        initViews();
        configureWebView();
        configureSwipeRefresh();
        registerBackHandler();
        loadTargetUrl();
    }

    /**
     * 注册返回键处理（兼容手势返回 + 导航栏返回）
     * 使用 OnBackPressedDispatcher 替代过时的 onKeyDown/onBackPressed，
     * 确保在 Android 14+ 上正常响应。
     *
     * QuizCraft 是 React SPA，内部路由使用 pushState 管理历史，
     * WebView 的 canGoBack() 无法正确判断"是否在首页"，
     * 所以直接弹出退出确认弹窗。
     */
    private void registerBackHandler() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                showExitDialog();
            }
        });
    }

    /**
     * 初始化视图组件
     */
    private void initViews() {
        swipeRefreshLayout = findViewById(R.id.swipeRefresh);
        webView = findViewById(R.id.webView);

        // 设置 SwipeRefresh 的颜色主题
        swipeRefreshLayout.setColorSchemeResources(
                R.color.primary,
                R.color.accent,
                R.color.primary_dark
        );
    }

    /**
     * 配置 WebView 的各项设置
     */
    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();

        // ---- 核心功能 ----
        settings.setJavaScriptEnabled(true);                 // 启用 JavaScript（SPA 必需）
        settings.setDomStorageEnabled(true);                 // 启用 DOM 存储（SPA 必需）

        // ---- 缩放控制 ----
        settings.setSupportZoom(false);                      // 禁止双指缩放
        settings.setBuiltInZoomControls(false);              // 隐藏缩放控件
        settings.setDisplayZoomControls(false);              // 禁用屏幕缩放控件

        // ---- 加载优化 ----
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);    // 默认缓存策略
        settings.setLoadWithOverviewMode(true);              // 自适应屏幕宽度
        settings.setUseWideViewPort(true);                   // 支持 viewport meta 标签

        // ---- 安全与兼容 ----
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW); // 禁止混合内容
        settings.setAllowFileAccess(false);                  // 禁止文件协议访问
        settings.setAllowContentAccess(false);               // 禁止内容协议访问

        // ---- User-Agent（便于后端识别 Android 端流量） ----
        String originalUA = settings.getUserAgentString();
        if (originalUA != null && !originalUA.contains("QuizCraft-Android")) {
            settings.setUserAgentString(originalUA + USER_AGENT_SUFFIX);
        }

        // ---- 客户端设置 ----
        webView.setWebViewClient(new QuizCraftWebViewClient());
        webView.setWebChromeClient(new QuizCraftChromeClient());
        webView.setScrollBarStyle(ViewGroup.SCROLLBARS_INSIDE_OVERLAY);
    }

    /**
     * 配置下拉刷新
     */
    private void configureSwipeRefresh() {
        swipeRefreshLayout.setOnRefreshListener(() -> {
            // 下拉刷新：重新加载当前页面
            if (isNetworkAvailable()) {
                webView.reload();
            } else {
                Toast.makeText(this, "网络不可用，请检查连接", Toast.LENGTH_SHORT).show();
                swipeRefreshLayout.setRefreshing(false);
            }
        });
    }

    /**
     * 加载目标网址
     */
    private void loadTargetUrl() {
        if (isNetworkAvailable()) {
            webView.loadUrl(TARGET_URL);
        } else {
            showOfflinePage();
        }
    }

    // ========================
    //  返回键处理
    // ========================

    // ========================
    //  返回键处理（由 OnBackPressedDispatcher 接管）
    //  见 registerBackHandler() 方法
    // ========================

    /**
     * 显示退出确认弹窗 — 匹配网站卡片风格
     *
     * 使用自定义布局，模仿网站的白底圆角卡片设计：
     * - 蓝色顶部装饰条（匹配网站 header）
     * - 白色圆角主体
     * - QQ 群粉色高亮标签
     * - 双按钮：退出程序（蓝色）、留在APP（灰色）
     */
    private void showExitDialog() {
        Dialog dialog = new Dialog(this);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        dialog.setContentView(R.layout.dialog_exit);
        dialog.setCanceledOnTouchOutside(false);
        dialog.setCancelable(false);

        // 设置弹窗窗口样式
        Window window = dialog.getWindow();
        if (window != null) {
            window.setBackgroundDrawable(new ColorDrawable(android.graphics.Color.TRANSPARENT));
            // 计算屏幕宽度的 85% 作为弹窗宽度，左右留白
            DisplayMetrics metrics = new DisplayMetrics();
            window.getWindowManager().getDefaultDisplay().getMetrics(metrics);
            int dialogWidth = (int) (metrics.widthPixels * 0.85);
            window.setLayout(dialogWidth, WindowManager.LayoutParams.WRAP_CONTENT);
            // 设置窗口进入/退出动画
            window.setWindowAnimations(android.R.style.Animation_Dialog);
        }

        // ---- QQ 群号一键复制 ----
        final String QQ_NUMBER = "1031855485";
        View qqLayout = dialog.findViewById(R.id.qq_group_layout);
        TextView qqHint = dialog.findViewById(R.id.qq_copy_hint);
        qqLayout.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                ClipData clip = ClipData.newPlainText("QQ群", QQ_NUMBER);
                clipboard.setPrimaryClip(clip);
                // 复制后反馈：文字变色 + Toast
                qqHint.setText("✅ 已复制！快去QQ粘贴加群吧");
                qqHint.setTextColor(getColor(R.color.primary));
                Toast.makeText(MainActivity.this, "QQ群号已复制到剪贴板", Toast.LENGTH_SHORT).show();
            }
        });

        // ---- 按钮事件 ----
        dialog.findViewById(R.id.btn_stay).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                dialog.dismiss();
            }
        });

        dialog.findViewById(R.id.btn_exit).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                dialog.dismiss();
                finishAffinity();
            }
        });

        dialog.show();
    }

    // ========================
    //  离线页面
    // ========================

    /**
     * 检查网络是否可用
     */
    private boolean isNetworkAvailable() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        if (cm == null) return false;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            NetworkCapabilities caps = cm.getNetworkCapabilities(cm.getActiveNetwork());
            return caps != null && (
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ||
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
            );
        }
        return true;
    }

    /**
     * 展示离线提示页面（内联 HTML）
     */
    private void showOfflinePage() {
        String offlineHtml = "<!DOCTYPE html>" +
                "<html lang=\"zh-CN\">" +
                "<head>" +
                "<meta charset=\"UTF-8\">" +
                "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">" +
                "<title>网络不可用</title>" +
                "<style>" +
                "  * { margin: 0; padding: 0; box-sizing: border-box; }" +
                "  body {" +
                "    font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;" +
                "    display: flex; flex-direction: column; align-items: center;" +
                "    justify-content: center; min-height: 100vh;" +
                "    background: linear-gradient(135deg, #EFF6FF 0%, #F9FAFB 100%);" +
                "    padding: 32px; text-align: center;" +
                "  }" +
                "  .icon { font-size: 72px; margin-bottom: 24px; }" +
                "  h2 { color: #1F2937; margin-bottom: 12px; font-size: 22px; }" +
                "  p { color: #6B7280; margin-bottom: 24px; font-size: 15px; line-height: 1.6; }" +
                "  .btn {" +
                "    display: inline-block; padding: 12px 32px;" +
                "    background: #3B82F6; color: #fff; border: none; border-radius: 8px;" +
                "    font-size: 16px; cursor: pointer; text-decoration: none;" +
                "  }" +
                "  .btn:hover { background: #2563EB; }" +
                "  .sub { margin-top: 16px; font-size: 12px; color: #999; }" +
                "</style>" +
                "</head>" +
                "<body>" +
                "<div class=\"icon\">&#128274;</div>" +
                "<h2>网络连接失败</h2>" +
                "<p>请检查网络连接后重试<br/>刷题数据将在联网后自动同步</p>" +
                "<a class=\"btn\" href=\"javascript:location.reload()\">重新加载</a>" +
                "<div class=\"sub\">SuperHuazai 刷题助手 &#8226; 多端协同</div>" +
                "</body>" +
                "</html>";

        webView.loadDataWithBaseURL(TARGET_URL, offlineHtml, "text/html", "UTF-8", null);
    }

    // ========================
    //  WebViewClient
    // ========================

    private class QuizCraftWebViewClient extends WebViewClient {

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            super.onPageStarted(view, url, favicon);

            // 页面加载时显示提示
            Toast.makeText(MainActivity.this, R.string.toast_loading, Toast.LENGTH_SHORT).show();

            // 确保 SwipeRefresh 在加载开始时显示
            if (!swipeRefreshLayout.isRefreshing()) {
                swipeRefreshLayout.setRefreshing(true);
            }
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            // 页面加载完成后停止刷新动画
            swipeRefreshLayout.setRefreshing(false);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            // 只对主框架加载错误做离线处理（忽略子资源如图片、字体等）
            if (request != null && request.isForMainFrame()) {
                showOfflinePage();
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            String url = request.getUrl().toString();

            // 仅允许加载目标域名下的页面
            if (url != null && (url.startsWith("https://superhuazai.me") ||
                    url.startsWith("http://superhuazai.me"))) {
                return false; // 让 WebView 正常加载
            }

            // 其他 URL（外部链接）在当前 WebView 中打开
            return false;
        }
    }

    // ========================
    //  WebChromeClient
    // ========================

    private class QuizCraftChromeClient extends WebChromeClient {
        // 可在此添加进度条、标题同步等功能
        // 目前使用 Toast + SwipeRefresh 已满足需求
    }

    // ========================
    //  生命周期管理
    // ========================

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) {
            webView.onPause();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
        }
    }

    @Override
    protected void onDestroy() {
        // 释放 WebView 资源，防止内存泄漏
        if (webView != null) {
            swipeRefreshLayout.removeView(webView);
            webView.removeAllViews();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // 配置变更时保留 WebView 状态
    }
}
