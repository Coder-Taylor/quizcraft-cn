import { Outlet, Link, useLocation } from 'react-router-dom';
import {
  BookOpen,
  Trophy,
  FileText,
  Home,
  MessageSquare,
  Dices,
  Github,
  Heart,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { IS_OPS_MODE } from '@/config/appMode';
import { useEffect, useState } from 'react';

const navItems = IS_OPS_MODE
  ? [
      { path: '/practice', icon: BookOpen, label: '刷题' },
      { path: '/ranking', icon: Trophy, label: '排行榜' },
      { path: '/feedback', icon: MessageSquare, label: '反馈' },
      { path: '/wheel', icon: Dices, label: '随机大转盘' },
    ]
  : [
      { path: '/', icon: Home, label: '首页' },
      { path: '/practice', icon: BookOpen, label: '刷题' },
      { path: '/extract', icon: FileText, label: '题库工坊' },
      { path: '/ranking', icon: Trophy, label: '排行榜' },
      { path: '/feedback', icon: MessageSquare, label: '反馈' },
      { path: '/wheel', icon: Dices, label: '随机大转盘' },
  ];

const donateQrUrl =
  (import.meta.env.VITE_DONATE_QR_URL?.trim()) || '/wechat-receive-qrcode.jpg';

export default function Layout() {
  const location = useLocation();
  const [showDonateModal, setShowDonateModal] = useState(false);
  const [qrLoadFailed, setQrLoadFailed] = useState(false);

  useEffect(() => {
    if (!showDonateModal) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowDonateModal(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [showDonateModal]);
  
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-blue-50 via-gray-50 to-white">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to={IS_OPS_MODE ? "/practice" : "/"} className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary-500 rounded-lg flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg text-gray-800">
              {IS_OPS_MODE ? '在线刷题' : '刷题助手'}
            </span>
          </Link>
          
          <nav className="flex items-center gap-1">
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                  location.pathname === item.path
                    ? 'bg-primary-50 text-primary-600'
                    : 'text-gray-600 hover:bg-gray-100'
                )}
              >
                <item.icon className="w-4 h-4" />
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            ))}
          </nav>
        </div>
      </header>
      
      {/* 主内容区 */}
      <main className="w-full max-w-5xl mx-auto px-4 py-6 flex-1">
        <Outlet />
      </main>
      
      {/* 页脚 */}
      <footer className="border-t border-white/70 bg-white/55 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 py-6 text-center">
          <div className="flex flex-col items-center gap-2 text-sm text-gray-500">
            <p>刷题助手 · Jerry</p>
            <button
              type="button"
              onClick={() => {
                setShowDonateModal(true);
                setQrLoadFailed(false);
              }}
              className="inline-flex items-center gap-2 rounded-full border border-yellow-200 bg-yellow-50 px-3 py-1.5 text-xs font-medium text-yellow-700 transition-colors hover:border-yellow-300 hover:bg-yellow-100"
            >
              <Heart className="h-3.5 w-3.5" />
              <span>Buy me a coffee</span>
            </button>
            <a
              href="https://github.com/jry21223/quizcraft-cn"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:border-primary-200 hover:text-primary-600"
            >
              <Github className="h-3.5 w-3.5" />
              <span>开源项目，可自行部署</span>
            </a>
          </div>
        </div>
      </footer>

      {showDonateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={() => setShowDonateModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-800">支持作者</h2>
              <button
                type="button"
                onClick={() => setShowDonateModal(false)}
                className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 transition-colors"
                aria-label="关闭"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">微信扫码支持 · 感谢支持</p>
            <div className="rounded-xl border border-gray-100 p-3 flex items-center justify-center bg-gray-50">
              {qrLoadFailed ? (
                <p className="text-xs text-gray-500 leading-relaxed text-center">
                  未配置微信收款码，请在 VITE_DONATE_QR_URL 中配置图片链接
                </p>
              ) : (
                <img
                  src={donateQrUrl}
                  alt="微信收款码"
                  className="w-full max-w-[240px] rounded-lg border border-gray-100"
                  onError={() => setQrLoadFailed(true)}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
