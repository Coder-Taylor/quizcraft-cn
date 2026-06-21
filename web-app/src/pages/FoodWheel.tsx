import { useRef, useState, useEffect, useCallback } from 'react';
import { Dices, Plus, X, RotateCcw } from 'lucide-react';

const DEFAULT_ITEMS = [
  '板面',
  '香扒饭',
  '摇滚炒鸡',
  '盖浇饭',
  '烤肉拌饭',
  '麻辣烫',
  '麦当劳',
];

const COLORS = [
  '#FF6384',
  '#36A2EB',
  '#FFCE56',
  '#4BC0C0',
  '#9966FF',
  '#FF9F40',
  '#C9CBCF',
  '#E8A0BF',
  '#73C6B6',
  '#F0B27A',
  '#85C1E9',
  '#BB8FCE',
];

const STORAGE_KEY = 'food_wheel_items';

function loadItems(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // ignore
  }
  return [...DEFAULT_ITEMS];
}

function saveItems(items: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function drawWheel(
  canvas: HTMLCanvasElement,
  items: string[],
  rotation: number,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx || items.length === 0) return;

  const dpr = window.devicePixelRatio || 1;
  const size = canvas.width / dpr;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 8;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(cx * dpr, cy * dpr);
  ctx.rotate(rotation);
  ctx.translate(-cx * dpr, -cy * dpr);

  const arc = (2 * Math.PI) / items.length;
  const fontSize = Math.max(12, Math.min(16, radius / (items.length * 0.12 + 1.5)));

  for (let i = 0; i < items.length; i++) {
    const startAngle = i * arc - Math.PI / 2;
    const endAngle = startAngle + arc;

    ctx.beginPath();
    ctx.moveTo(cx * dpr, cy * dpr);
    ctx.arc(cx * dpr, cy * dpr, radius * dpr, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = COLORS[i % COLORS.length];
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2 * dpr;
    ctx.stroke();

    // Draw text
    ctx.save();
    ctx.translate(cx * dpr, cy * dpr);
    ctx.rotate(startAngle + arc / 2);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${fontSize * dpr}px "PingFang SC","Microsoft YaHei",sans-serif`;

    const textRadius = radius * 0.65;
    const displayText =
      items[i].length > 6 ? items[i].slice(0, 5) + '…' : items[i];
    ctx.fillText(displayText, textRadius * dpr, 0);

    ctx.restore();
  }

  ctx.restore();

  // Draw center circle
  ctx.beginPath();
  ctx.arc(cx * dpr, cy * dpr, 36 * dpr, 0, 2 * Math.PI);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 2 * dpr;
  ctx.stroke();
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export default function FoodWheel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [items, setItems] = useState<string[]>(() => loadItems());
  const [newItem, setNewItem] = useState('');
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const rotationRef = useRef(0);
  const animFrameRef = useRef<number | null>(null);
  const compositionRef = useRef(false);

  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const size = Math.min(360, window.innerWidth - 48);
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    drawWheel(canvas, items, rotationRef.current);
  }, [items]);

  useEffect(() => {
    initCanvas();
  }, [initCanvas]);

  useEffect(() => {
    const handleResize = () => {
      initCanvas();
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [initCanvas]);

  useEffect(() => {
    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, []);

  const handleSpin = () => {
    if (spinning || items.length < 2) return;
    setResult(null);
    setSpinning(true);

    const totalRotation =
      (Math.random() * 720 + 1800) * (Math.PI / 180); // 5-7 full rotations
    const duration = 3000 + Math.random() * 1500; // 3-4.5 seconds
    const startRotation = rotationRef.current;
    const startTime = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easeOutCubic(progress);
      const currentRotation = startRotation + totalRotation * easedProgress;

      rotationRef.current = currentRotation;
      const canvas = canvasRef.current;
      if (canvas) {
        drawWheel(canvas, items, currentRotation);
      }

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(animate);
      } else {
        setSpinning(false);
        // Determine which item is selected (top = -PI/2 direction)
        const normalized = (-currentRotation % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        const arc = (2 * Math.PI) / items.length;
        const index = Math.floor(((2 * Math.PI - normalized + Math.PI / 2 + arc / 2) % (2 * Math.PI)) / arc);
        setResult(items[index]);
      }
    };

    animFrameRef.current = requestAnimationFrame(animate);
  };

  const addItem = () => {
    const trimmed = newItem.trim();
    if (!trimmed) return;
    if (items.includes(trimmed)) return;

    const newItems = [...items, trimmed];
    setItems(newItems);
    saveItems(newItems);
    setNewItem('');
  };

  const removeItem = (index: number) => {
    if (items.length <= 2) return;
    const newItems = items.filter((_, i) => i !== index);
    setItems(newItems);
    saveItems(newItems);
    // Reset rotation to avoid visual glitch
    rotationRef.current = 0;
    const canvas = canvasRef.current;
    if (canvas) {
      drawWheel(canvas, newItems, 0);
    }
  };

  const resetItems = () => {
    setItems([...DEFAULT_ITEMS]);
    saveItems([...DEFAULT_ITEMS]);
    rotationRef.current = 0;
    const canvas = canvasRef.current;
    if (canvas) {
      drawWheel(canvas, DEFAULT_ITEMS, 0);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !compositionRef.current) {
      addItem();
    }
  };

  return (
    <div className="max-w-lg mx-auto animate-fade-in">
      <h1 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2">
        <Dices className="w-6 h-6 text-primary-500" />
        随机大转盘
      </h1>

      {/* Wheel */}
      <div className="card flex flex-col items-center py-6 mb-6">
        <div className="relative">
          {/* Pointer */}
          <div className="absolute -top-2 left-1/2 -translate-x-1/2 z-10">
            <div
              className="w-0 h-0"
              style={{
                borderLeft: '12px solid transparent',
                borderRight: '12px solid transparent',
                borderTop: '20px solid #1976d2',
                filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.2))',
              }}
            />
          </div>
          <canvas ref={canvasRef} className="block" />
          {/* Spin button overlay */}
          <button
            type="button"
            onClick={handleSpin}
            disabled={spinning || items.length < 2}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 w-[72px] h-[72px] rounded-full bg-primary-500 text-white font-bold text-sm hover:bg-primary-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg flex items-center justify-center"
          >
            {spinning ? (
              <span className="animate-spin">
                <Dices className="w-5 h-5" />
              </span>
            ) : (
              '转！'
            )}
          </button>
        </div>

        {items.length < 2 && (
          <p className="text-sm text-red-500 mt-4">至少需要 2 个选项才能转</p>
        )}
      </div>

      {/* Result Modal */}
      {result !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={() => setResult(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setResult(null)}
              className="float-right rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 transition-colors"
              aria-label="关闭"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="text-5xl mb-4">🎉</div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">抽中了</h2>
            <p
              className="text-3xl font-extrabold mb-6"
              style={{
                color: COLORS[items.indexOf(result) % COLORS.length],
              }}
            >
              {result}！
            </p>
            <button
              type="button"
              onClick={() => {
                setResult(null);
                handleSpin();
              }}
              className="btn-primary w-full text-base"
            >
              再来一次
            </button>
          </div>
        </div>
      )}

      {/* Options Management */}
      <div className="card mb-6">
        <h2 className="text-base font-semibold text-gray-800 mb-3 flex items-center gap-2">
          <Plus className="w-4 h-4 text-primary-500" />
          管理选项
        </h2>

        <div className="flex flex-wrap gap-2 mb-4">
          {items.map((item, i) => (
            <span
              key={`${item}-${i}`}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm text-white"
              style={{ backgroundColor: COLORS[i % COLORS.length] }}
            >
              {item}
              <button
                type="button"
                onClick={() => removeItem(i)}
                disabled={items.length <= 2}
                className="ml-0.5 hover:bg-white/20 rounded-full p-0.5 disabled:opacity-30 transition-colors"
                aria-label={`删除 ${item}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onCompositionStart={() => {
              compositionRef.current = true;
            }}
            onCompositionEnd={() => {
              compositionRef.current = false;
            }}
            onKeyDown={handleKeyDown}
            placeholder="输入新选项"
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
          <button
            type="button"
            onClick={addItem}
            disabled={!newItem.trim()}
            className="btn-primary flex items-center gap-1 text-sm"
          >
            <Plus className="w-4 h-4" />
            添加
          </button>
        </div>
      </div>

      {/* Reset */}
      <div className="text-center">
        <button
          type="button"
          onClick={resetItems}
          className="btn-secondary inline-flex items-center gap-1.5 text-sm"
        >
          <RotateCcw className="w-4 h-4" />
          恢复默认选项
        </button>
      </div>
    </div>
  );
}
