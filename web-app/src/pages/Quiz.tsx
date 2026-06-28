import {
  type FormEvent,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { animate, motion, useMotionValue } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Flag,
  CheckCircle2,
  XCircle,
  BookOpen,
  Timer,
  MessageCircle,
  Send,
  X,
} from "lucide-react";
import { useQuizStore } from "@/stores/quizStore";
import { feedbackApi, practiceApi } from "@/api/client";
import { RichText } from "@/components/RichText";
import {
  formatQuestionType,
  formatAnswer,
  getTypeColor,
  getDifficultyLabel,
} from "@/utils/format";
import type { Question, QuestionType } from "@/types";

const isAnswerCorrect = (
  answer: any,
  correctAnswer: any,
  type: QuestionType,
) => {
  if (type === "judge") {
    return Boolean(answer) === Boolean(correctAnswer);
  }

  if (type === "multi") {
    const selected = Array.isArray(answer)
      ? [...answer].map(Number).sort()
      : [];
    const correct = Array.isArray(correctAnswer)
      ? [...correctAnswer].map(Number).sort()
      : [];
    return (
      selected.length === correct.length &&
      selected.every((value, index) => value === correct[index])
    );
  }

  return Number(answer) === Number(correctAnswer);
};

const normalizeOptionIndex = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (/^[A-Za-z]$/.test(trimmed)) {
      return trimmed.toUpperCase().charCodeAt(0) - 65;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const isOptionSelected = (
  answer: unknown,
  type: QuestionType,
  optionIndex: number,
) => {
  if (type === "multi") {
    return Array.isArray(answer)
      ? answer.some((item) => normalizeOptionIndex(item) === optionIndex)
      : false;
  }

  return normalizeOptionIndex(answer) === optionIndex;
};

const normalizeJudgeAnswer = (answer: unknown): boolean | null => {
  if (typeof answer === "boolean") return answer;
  if (typeof answer === "string") {
    const normalized = answer.trim().toLowerCase();
    if (["true", "1", "yes", "y", "对", "正确"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "n", "错", "错误"].includes(normalized)) {
      return false;
    }
  }
  if (typeof answer === "number") {
    if (answer === 1) return true;
    if (answer === 0) return false;
  }
  return null;
};

const hasSelectedAnswer = (answer: unknown, type: QuestionType) => {
  if (type === "multi") {
    return Array.isArray(answer) && answer.length > 0;
  }
  if (type === "judge") {
    return normalizeJudgeAnswer(answer) !== null;
  }
  return normalizeOptionIndex(answer) !== null;
};

const SWIPE_THRESHOLD = 50;
const SWIPE_DIRECTION_RATIO = 1.25;
const SWIPE_MAX_DRAG = 120;
const PROGRESS_DOT_WINDOW_RADIUS = 40;
const SLIDE_DURATION = 0.22;
const SLIDE_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

// SWIPE_MAX_DRAG 保留常量便于参数统一管理，但默认实现不再做位移截断，避免影响拖拽跟手效果。

type SwipeStart = {
  x: number;
  y: number;
  currentX: number;
  tracking: boolean;
  horizontal: boolean;
};

const shouldIgnoreSwipeTarget = (target: EventTarget | null) => {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('[data-swipe-ignore="true"]'))
  );
};

const clampSwipeDrag = (value: number) => {
  if (SWIPE_MAX_DRAG <= 0) {
    return value;
  }

  return value;
};

const parsePositiveInt = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const text = typeof value === "string" ? value.trim() : String(value);
  if (!text) {
    return null;
  }

  const parsed = Number(text);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const getQuestionMetadataIndex = (
  question: Question | null | undefined,
): number | null => {
  if (!question) {
    return null;
  }

  const fromNumber = parsePositiveInt(question.number);
  if (fromNumber !== null) {
    return fromNumber;
  }

  const match = question.id.match(/(\d+)\s*$/);
  if (!match) return null;
  return parsePositiveInt(match[1]);
};

const resolveFeedbackQuestionIndex = (
  question: Question | null | undefined,
  fallbackIndex: number,
): number => getQuestionMetadataIndex(question) || fallbackIndex;

const getProgressDotClass = ({
  current,
  answered,
  correct,
  starred,
}: {
  current: boolean;
  answered: boolean;
  correct?: boolean;
  starred: boolean;
}) => {
  const baseClass = "w-2 h-2 rounded-full transition-all transform-gpu";

  if (starred) {
    return `${baseClass} ${current ? "scale-125 bg-yellow-500" : "bg-yellow-400"}`;
  }

  if (current) {
    return `${baseClass} bg-primary-500 scale-125`;
  }

  if (answered) {
    return `${baseClass} ${correct ? "bg-green-400" : "bg-red-400"}`;
  }

  return `${baseClass} bg-gray-200`;
};

type ProgressDotsProps = {
  questions: Question[];
  currentIndex: number;
  answers: Record<string, any>;
  results: Record<string, boolean>;
  starredQuestions: string[];
  onJump: (index: number) => void;
};

const ProgressDots = memo(function ProgressDots({
  questions,
  currentIndex,
  answers,
  results,
  starredQuestions,
  onJump,
}: ProgressDotsProps) {
  const starredSet = useMemo(
    () => new Set(starredQuestions),
    [starredQuestions],
  );

  if (!questions.length) {
    return null;
  }

  const start = Math.max(0, currentIndex - PROGRESS_DOT_WINDOW_RADIUS);
  const end = Math.min(
    questions.length,
    currentIndex + PROGRESS_DOT_WINDOW_RADIUS + 1,
  );

  const renderDot = (question: Question, idx: number) => {
    const answered = answers[question.id] !== undefined;

    return (
      <button
        key={`${question.id}-${idx}`}
        onClick={() => onJump(idx)}
        aria-label={`跳到第 ${idx + 1} 题`}
        className={`w-2 h-2 rounded-full transition-colors ${getProgressDotClass(
          {
            current: idx === currentIndex,
            answered,
            correct: results[question.id],
            starred: starredSet.has(question.id),
          },
        )}`}
      />
    );
  };

  return (
    <div
      className="mt-3 w-full overflow-x-auto pb-1"
      data-swipe-ignore="true"
    >
      <div className="flex items-center gap-1 min-w-max px-0.5">
        {start > 0 && (
          <>
            {renderDot(questions[0], 0)}
            <span className="px-1 text-xs text-gray-300">…</span>
          </>
        )}

        {questions
          .slice(start, end)
          .map((question, offset) => renderDot(question, start + offset))}

        {end < questions.length && (
          <>
            <span className="px-1 text-xs text-gray-300">…</span>
            {renderDot(questions[questions.length - 1], questions.length - 1)}
          </>
        )}
      </div>
    </div>
  );
});

// 选项组件
function OptionButton({
  label,
  text,
  selected,
  correct,
  missed = false,
  showResult,
  onClick,
}: {
  label: string;
  text: string;
  selected: boolean;
  correct?: boolean;
  missed?: boolean;
  showResult: boolean;
  onClick: () => void;
}) {
  let bgClass = "bg-white border-gray-200 hover:border-primary-300";

  if (showResult) {
    if (correct && selected) {
      bgClass = "bg-green-50 border-green-500 text-green-800";
    } else if (missed) {
      bgClass = "bg-green-50 border-green-200 text-green-700";
    } else if (selected) {
      bgClass = "bg-red-50 border-red-500 text-red-800";
    } else {
      bgClass = "bg-gray-50 border-gray-200 text-gray-400";
    }
  } else if (selected) {
    bgClass = "bg-primary-50 border-primary-500 text-primary-700";
  }

  return (
    <button
      onClick={onClick}
      disabled={showResult}
      className={`w-full flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-colors ${bgClass}`}
    >
      <span
        className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${
          showResult
            ? correct && selected
              ? "bg-green-500 text-white"
              : missed
                ? "bg-green-200 text-green-700"
                : selected
                  ? "bg-red-500 text-white"
                  : "bg-gray-200 text-gray-500"
            : selected
              ? "bg-primary-500 text-white"
              : "bg-gray-100 text-gray-600"
        }`}
      >
        {label}
      </span>
      <span className="flex-1 pt-1">
        <RichText text={text} />
      </span>
      {showResult && correct && selected && (
        <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-1" />
      )}
      {showResult && missed && (
        <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0 mt-1" />
      )}
      {showResult && selected && !correct && (
        <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-1" />
      )}
    </button>
  );
}

// 判断题选项
function JudgeButtons({
  selected,
  correct,
  showResult,
  onSelect,
}: {
  selected: boolean | null;
  correct?: boolean;
  showResult: boolean;
  onSelect: (value: boolean) => void;
}) {
  const options = [
    { value: true, label: "对", icon: CheckCircle2 },
    { value: false, label: "错", icon: XCircle },
  ];

  return (
    <div className="flex gap-4">
      {options.map((opt) => {
        const isSelected = selected === opt.value;
        const isCorrect = showResult && correct === opt.value;

        let btnClass = "bg-white border-gray-200 hover:border-primary-300";
        if (showResult) {
          if (correct === opt.value) {
            btnClass = "bg-green-50 border-green-500 text-green-800";
          } else if (isSelected) {
            btnClass = "bg-red-50 border-red-500 text-red-800";
          }
        } else if (isSelected) {
          btnClass = "bg-primary-50 border-primary-500 text-primary-700";
        }

        return (
          <button
            key={opt.label}
            onClick={() => onSelect(opt.value)}
            disabled={showResult}
            className={`flex-1 flex items-center justify-center gap-2 py-4 rounded-xl border-2 font-medium transition-colors ${btnClass}`}
          >
            <opt.icon
              className={`w-5 h-5 ${isCorrect ? "text-green-500" : isSelected && showResult ? "text-red-500" : ""}`}
            />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export default function Quiz() {
  const navigate = useNavigate();
  const {
    practice,
    currentBank,
    answerQuestion,
    jumpToQuestion,
    finishPractice,
    toggleStar,
    starredQuestions,
  } = useQuizStore();

  const [selectedAnswer, setSelectedAnswer] = useState<any>(null);
  const [showResult, setShowResult] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [isSliding, setIsSliding] = useState(false);
  const trackX = useMotionValue(0);
  const dragXRef = useRef(0);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const swipeStartRef = useRef<SwipeStart | null>(null);

  const [visualCurrentIndex, setVisualCurrentIndex] = useState(0);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackSuggestion, setFeedbackSuggestion] = useState("");
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackError, setFeedbackError] = useState("");

  const currentIndex = practice?.currentIndex ?? -1;
  const hasPractice = Boolean(practice);
  const activeQuestion = practice?.questions[currentIndex];
  const activeQuestionId = activeQuestion?.id;
  const activeBankKey = practice?.bankKey || currentBank;
  const activeAnswer = activeQuestionId
    ? practice?.answers[activeQuestionId]
    : undefined;

  useLayoutEffect(() => {
    if (!viewportRef.current) return;

    const node = viewportRef.current;
    const updateWidth = () => {
      const width = Math.floor(node.getBoundingClientRect().width);
      setViewportWidth(width > 0 ? width : 0);
    };

    updateWidth();

    const ro = new ResizeObserver(() => {
      updateWidth();
    });

    ro.observe(node);
    return () => ro.disconnect();
  }, [hasPractice]);

  useEffect(() => {
    if (!hasPractice) {
      navigate("/practice");
    }
  }, [hasPractice, navigate]);

  useLayoutEffect(() => {
    if (!hasPractice) return;

    if (activeAnswer !== undefined) {
    setSelectedAnswer(activeAnswer);
    setShowResult(true);
  } else {
    setSelectedAnswer(null);
    setShowResult(false);
  }
  }, [hasPractice, activeQuestionId, activeAnswer]);

  useLayoutEffect(() => {
    if (!hasPractice || !practice) return;

    setVisualCurrentIndex(practice.currentIndex);
  }, [hasPractice, practice?.currentIndex, practice]);

  useLayoutEffect(() => {
    if (!hasPractice || !viewportWidth) {
      return;
    }

    trackX.set(-viewportWidth);
    dragXRef.current = 0;
    swipeStartRef.current = null;
    setIsSliding(false);
  }, [hasPractice, currentIndex, practice?.questions.length, viewportWidth, trackX]);

  const startTime = practice?.startTime;
  const isFinished = practice?.isFinished ?? false;

  useEffect(() => {
    if (!startTime || isFinished) return;

    const timer = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    return () => clearInterval(timer);
  }, [startTime, isFinished]);

  const practiceQuestionCount = practice?.questions.length ?? 0;
  const visualIndex = practice && practiceQuestionCount > 0
    ? Math.min(
      Math.max(visualCurrentIndex, 0),
      practiceQuestionCount - 1,
    )
    : 0;
  const feedbackQuestionIndex = resolveFeedbackQuestionIndex(
    activeQuestion,
    visualIndex + 1,
  );

  useEffect(() => {
    if (!hasPractice || practiceQuestionCount === 0) {
      return;
    }
    try {
      // 与题目索引脱钩，优先使用题库元数据 index（如 question.number 或 id 后缀）
      localStorage.setItem(
        "quizcraft_last_feedback_question_index",
        String(feedbackQuestionIndex),
      );
    } catch {
      // ignore storage errors
    }
  }, [hasPractice, practiceQuestionCount, feedbackQuestionIndex]);

  if (!hasPractice || !practice || !activeQuestion) return null;

  const progress = ((visualIndex + 1) / practice.questions.length) * 100;

  const prevQuestion = currentIndex > 0 ? practice.questions[currentIndex - 1] : null;
  const nextQuestionRef =
    currentIndex < practice.questions.length - 1
      ? practice.questions[currentIndex + 1]
      : null;

  const canSubmitCurrent = Boolean(
    activeQuestion && hasSelectedAnswer(selectedAnswer, activeQuestion.type),
  );

  const openFeedbackModal = () => {
    setFeedbackSuggestion("");
    setFeedbackMessage("");
    setFeedbackError("");
    setFeedbackOpen(true);
  };

  const closeFeedbackModal = () => {
    if (feedbackSubmitting) return;
    setFeedbackOpen(false);
  };

  const handleFeedbackSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeQuestion) return;

    const normalizedSuggestion = feedbackSuggestion.trim();
    if (!normalizedSuggestion) {
      setFeedbackError("建议改正内容不能为空");
      return;
    }

    setFeedbackSubmitting(true);
    setFeedbackError("");
    setFeedbackMessage("");
    try {
      await feedbackApi.submit({
        question_index: feedbackQuestionIndex,
        question_bank: activeBankKey || undefined,
        question_id: activeQuestion.id,
        question_content: activeQuestion.content,
        suggestion: normalizedSuggestion,
      });
      setFeedbackMessage("反馈提交成功，感谢你的建议！");
      setFeedbackSuggestion("");
    } catch (error) {
      setFeedbackError((error as Error).message || "提交失败");
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const alignTrackToCenter = (animateBack = true) => {
    if (!viewportWidth) {
      return;
    }

    if (animateBack) {
      animate(trackX, -viewportWidth, { duration: 0.12, ease: "easeOut" });
    } else {
      trackX.set(-viewportWidth);
    }
  };

  const setTrackDragPosition = (value: number) => {
    if (!viewportWidth) {
      return;
    }

    const processed = clampSwipeDrag(value);
    dragXRef.current = processed;
    trackX.set(-viewportWidth + processed);
  };

  const resetSwipeState = (animateBack = true) => {
    swipeStartRef.current = null;
    dragXRef.current = 0;
    alignTrackToCenter(animateBack);
  };

  const resetQuestionViewState = () => {
    setSelectedAnswer(null);
    setShowResult(false);
  };

  const slideToIndex = (targetIndex: number) => {
    if (!practice || isSliding) {
      return;
    }

    const { currentIndex, questions } = practice;
    const maxIndex = questions.length - 1;
    const nextIndex = Math.max(0, Math.min(maxIndex, targetIndex));

    if (nextIndex === currentIndex) return;

    resetQuestionViewState();

    if (!viewportWidth || Math.abs(nextIndex - currentIndex) > 1) {
      setVisualCurrentIndex(nextIndex);
      jumpToQuestion(nextIndex);
      trackX.set(-viewportWidth);
      return;
    }

    const targetX = nextIndex > currentIndex ? -2 * viewportWidth : 0;

    setVisualCurrentIndex(nextIndex);
    setIsSliding(true);
    const controls = animate(trackX, targetX, {
      duration: SLIDE_DURATION,
      ease: SLIDE_EASE,
    });

    void controls.then(() => {
      jumpToQuestion(nextIndex);
      trackX.set(-viewportWidth);
      setIsSliding(false);
    });
  };

  const handleJump = (index: number) => {
    if (!practice) return;
    if (index === practice.currentIndex) return;
    if (index < 0 || index >= practice.questions.length) return;

    slideToIndex(index);
  };

  const handleNext = () => {
    if (!practice || isSliding) return;

    if (practice.currentIndex < practice.questions.length - 1) {
      slideToIndex(practice.currentIndex + 1);
    } else {
      finishPractice();
      navigate("/result");
    }
  };

  const handlePrev = () => {
    if (!practice || isSliding) return;
    if (practice.currentIndex <= 0) {
      return;
    }

    slideToIndex(practice.currentIndex - 1);
  };

  const handleCardTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (
      isSliding ||
      !viewportWidth ||
      event.touches.length !== 1 ||
      shouldIgnoreSwipeTarget(event.target)
    ) {
      return;
    }

    const touch = event.touches[0];
    swipeStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      currentX: 0,
      tracking: true,
      horizontal: false,
    };

    dragXRef.current = 0;
    trackX.set(-viewportWidth);
  };

  const handleCardTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    if (!start?.tracking || event.touches.length !== 1 || !viewportWidth) return;

    const touch = event.touches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (!start.horizontal) {
      if (absY > 12 && absY > absX) {
        resetSwipeState();
        return;
      }
      if (absX < 12 || absX < absY * SWIPE_DIRECTION_RATIO) {
        return;
      }
      start.horizontal = true;
    }

    start.currentX = deltaX;
    setTrackDragPosition(deltaX);
  };

  const handleCardTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    if (!start?.tracking || !viewportWidth) {
      resetSwipeState();
      return;
    }

    const changedTouch = event.changedTouches[0];
    const fallbackDeltaX = changedTouch
      ? changedTouch.clientX - start.x
      : dragXRef.current;
    const fallbackDeltaY = changedTouch ? changedTouch.clientY - start.y : 0;
    const finalX = clampSwipeDrag(start.currentX || fallbackDeltaX);
    const finalIsHorizontal =
      start.horizontal ||
      (Math.abs(fallbackDeltaX) >= SWIPE_THRESHOLD &&
        Math.abs(fallbackDeltaX) >=
          Math.abs(fallbackDeltaY) * SWIPE_DIRECTION_RATIO);

    if (!finalIsHorizontal || Math.abs(finalX) < SWIPE_THRESHOLD) {
      resetSwipeState();
      return;
    }

    if (finalX < 0) {
      if (practice.currentIndex < practice.questions.length - 1) {
        slideToIndex(practice.currentIndex + 1);
      } else {
        resetSwipeState();
      }

      return;
    }

    if (practice.currentIndex > 0) {
      slideToIndex(practice.currentIndex - 1);
      return;
    }

    resetSwipeState();
  };

  const renderCard = (question: Question | null, isCurrent = false) => {
    if (!question) {
      return (
        <div className="w-full flex-shrink-0 min-w-full px-0.5">
          <div className="bg-white rounded-2xl border border-transparent p-6 min-h-[300px]" />
        </div>
      );
    }

    const savedAnswer = practice.answers[question.id];
    const hasSavedAnswer = savedAnswer !== undefined;
    const cardAnswer = isCurrent
      ? selectedAnswer ?? (hasSavedAnswer ? savedAnswer : null)
      : hasSavedAnswer
        ? savedAnswer
        : null;
    const cardShowResult = isCurrent ? showResult : hasSavedAnswer;
    const result =
      hasSavedAnswer
        ? {
            correct: practice.results[question.id],
            correctAnswer: practice.correctAnswers[question.id],
            analysis: practice.analyses[question.id],
          }
        : null;

    const difficulty = question.stats
      ? getDifficultyLabel(question.stats.rate)
      : null;

    return (
      <div className="w-full flex-shrink-0 min-w-full px-0.5">
        <div
          onTouchStart={isCurrent ? handleCardTouchStart : undefined}
          onTouchMove={isCurrent ? handleCardTouchMove : undefined}
          onTouchEnd={isCurrent ? handleCardTouchEnd : undefined}
          onTouchCancel={isCurrent ? () => resetSwipeState() : undefined}
          className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-6 touch-pan-y will-change-transform ${
            isCurrent ? "" : "pointer-events-none"
          }`}
        >
          <div className="flex items-center gap-2 mb-4">
            <span
              className={`px-2.5 py-1 rounded-lg text-xs font-medium ${getTypeColor(question.type)}`}
            >
              {formatQuestionType(question.type)}
            </span>
            {difficulty && (
              <span
                className={`px-2.5 py-1 rounded-lg text-xs font-medium ${difficulty.color}`}
              >
                {difficulty.label} · 正确率 {question.stats?.rate}%
              </span>
            )}
            <span className="text-xs text-gray-400">{question.chapter}</span>
          </div>

          <h2 className="text-lg font-medium text-gray-800 mb-6 leading-relaxed">
            <RichText text={question.content} />
          </h2>

          <div className="space-y-3 mb-6">
            {question.type === "judge" ? (
              <JudgeButtons
                selected={normalizeJudgeAnswer(cardAnswer)}
                correct={
                  cardShowResult
                    ? normalizeJudgeAnswer(result?.correctAnswer) ?? undefined
                    : undefined
                }
                showResult={cardShowResult}
                onSelect={isCurrent ? handleJudgeSelect : () => undefined}
              />
            ) : (
              question.options?.map((option, index) => {
                const isSelected = isOptionSelected(
                  cardAnswer,
                  question.type,
                  index,
                );

                const isCorrect = cardShowResult
                  ? isOptionSelected(result?.correctAnswer, question.type, index)
                  : false;

                const isMissed = Boolean(
                  cardShowResult &&
                    question.type === "multi" &&
                    isCorrect &&
                    !isSelected,
                );

                return (
                  <OptionButton
                    key={index}
                    label={String.fromCharCode(65 + index)}
                    text={option}
                    selected={Boolean(isSelected)}
                    correct={isCorrect}
                    missed={isMissed}
                    showResult={cardShowResult}
                    onClick={
                      isCurrent ? () => handleOptionSelect(index) : () => undefined
                    }
                  />
                );
              })
            )}
          </div>

          {isCurrent && !showResult && (
            <div className="min-h-[52px] mb-4 flex items-end">
              <button
                onClick={handleSubmitCurrent}
                disabled={!canSubmitCurrent || isSliding}
                className="w-full py-3 bg-primary-500 text-white font-medium rounded-xl hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                提交答案
              </button>
            </div>
          )}

          {isCurrent && showResult && result && (
            <div
              className={`rounded-xl p-4 mb-4 ${result.correct ? "bg-green-50 border border-green-100" : "bg-red-50 border border-red-100"}`}
            >
              <div className="flex items-center gap-2 mb-2">
                {result.correct ? (
                  <>
                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                    <span className="font-medium text-green-800">
                      回答正确！
                    </span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-5 h-5 text-red-500" />
                    <span className="font-medium text-red-800">回答错误</span>
                  </>
                )}
              </div>

              {!result.correct && (
                <div className="text-sm text-gray-700 mb-2">
                  正确答案：
                  <span className="font-medium text-green-700">
                    {formatAnswer(result.correctAnswer, question.type)}
                  </span>
                </div>
              )}

              {result.analysis && (
                <div className="mt-3 pt-3 border-t border-gray-200/50">
                  <div className="text-sm font-medium text-gray-700 mb-1">
                    解析
                  </div>
                  <div className="text-sm text-gray-600 leading-relaxed">
                    <RichText text={result.analysis} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const handleOptionSelect = (index: number) => {
    if (showResult) return;

    if (activeQuestion.type === "multi") {
      // 多选题：切换选择
      const current = (selectedAnswer as number[]) || [];
      const newAnswer = current.includes(index)
        ? current.filter((i) => i !== index)
        : [...current, index].sort();
      setSelectedAnswer(newAnswer);
    } else {
      // 单选题：只更新选中
      setSelectedAnswer(index);
    }
  };

  const handleSubmitCurrent = () => {
    if (!activeQuestion || showResult || !canSubmitCurrent || isSliding) return;

    if (
      activeQuestion.type === "multi" &&
      (!Array.isArray(selectedAnswer) || selectedAnswer.length === 0)
    ) {
      return;
    }

    submitAnswer(selectedAnswer);
  };

  const submitAnswer = (answer: any) => {
    if (!activeBankKey || !activeQuestion) return;

    const questionId = activeQuestion.id;
    const localCorrectAnswer = activeQuestion.answer;
    const localIsCorrect = isAnswerCorrect(
      answer,
      localCorrectAnswer,
      activeQuestion.type,
    );

    setShowResult(true);
    answerQuestion({
      questionId,
      answer,
      isCorrect: localIsCorrect,
      correctAnswer: localCorrectAnswer,
      analysis: activeQuestion.analysis,
    });

    void practiceApi
      .submitAnswer(activeBankKey, questionId, answer)
      .then((res) => {
        // 以后如果后端隐藏答案或规则调整，以后端结果为准进行一次轻量校正。
        answerQuestion({
          questionId,
          answer,
          isCorrect: res.correct,
          correctAnswer: res.correct_answer,
          analysis: res.analysis,
        });
      })
      .catch((error) => {
        console.error("同步答题统计失败:", error);
      });
  };

  const handleJudgeSelect = (value: boolean) => {
    if (showResult) return;
    setSelectedAnswer(value);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const starred = starredQuestions.includes(activeQuestion.id);

  return (
      <div className="max-w-3xl mx-auto">
      {feedbackOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={closeFeedbackModal}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
            data-swipe-ignore="true"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-800">反馈本题</h2>
                <p className="mt-1 text-xs text-gray-500">
                  {activeBankKey} · 第 {feedbackQuestionIndex} 题 · {activeQuestion.id}
                </p>
              </div>
              <button
                type="button"
                onClick={closeFeedbackModal}
                disabled={feedbackSubmitting}
                className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 disabled:opacity-50"
                aria-label="关闭反馈弹窗"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mb-4 rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm leading-relaxed text-gray-600">
              <RichText text={activeQuestion.content} />
            </div>

            <form onSubmit={handleFeedbackSubmit} className="space-y-3">
              <textarea
                rows={6}
                value={feedbackSuggestion}
                onChange={(event) => setFeedbackSuggestion(event.target.value)}
                placeholder="例如：正确答案应为 B；选项 C 有错别字；解析和答案不一致..."
                className="w-full resize-y rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 outline-none transition-colors focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
                maxLength={2000}
                disabled={feedbackSubmitting}
                autoFocus
              />
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>最多 2000 字，提交后不会离开当前刷题进度</span>
                <span>{feedbackSuggestion.length}/2000</span>
              </div>

              {feedbackError && <p className="text-sm text-red-600">{feedbackError}</p>}
              {feedbackMessage && <p className="text-sm text-green-600">{feedbackMessage}</p>}

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={closeFeedbackModal}
                  disabled={feedbackSubmitting}
                  className="flex-1 rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
                >
                  继续刷题
                </button>
                <button
                  type="submit"
                  disabled={feedbackSubmitting || !feedbackSuggestion.trim()}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary-500 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  {feedbackSubmitting ? "提交中..." : "提交反馈"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* 顶部进度条 */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-gray-100 -mx-4 px-4 py-3 mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <BookOpen className="w-4 h-4" />
            <span>
              题目 {visualIndex + 1} / {practice.questions.length}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={openFeedbackModal}
              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
              aria-label="反馈本题"
            >
              <MessageCircle className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-1 text-sm text-gray-500">
              <Timer className="w-4 h-4" />
              <span>{formatTime(elapsedTime)}</span>
            </div>
            <button
              onClick={() => toggleStar(activeQuestion.id)}
              className={`p-1.5 rounded-lg transition-colors ${starred ? "text-yellow-500 bg-yellow-50" : "text-gray-400 hover:bg-gray-100"}`}
            >
              <Flag className={`w-4 h-4 ${starred ? "fill-current" : ""}`} />
            </button>
          </div>
        </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary-500 transition-all duration-[120ms]"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

        {/* 题目卡片 */}
        <div className="overflow-hidden" ref={viewportRef}>
          <motion.div style={{ x: trackX }} className="flex">
            {renderCard(prevQuestion)}
            {renderCard(activeQuestion, true)}
            {renderCard(nextQuestionRef)}
          </motion.div>
        </div>
            <div className="pt-4 border-t border-gray-100">
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePrev}
                  disabled={isSliding || practice.currentIndex === 0}
                  className="flex items-center justify-center gap-1 px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-1"
                >
                  <ChevronLeft className="w-5 h-5" />
                  上一题
                </button>

                <button
                  onClick={handleNext}
                  disabled={isSliding}
                  className="flex items-center justify-center gap-1 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-1"
                >
                  {visualIndex === practice.questions.length - 1
                    ? "查看结果"
                    : "下一题"}
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>

          <ProgressDots
            questions={practice.questions}
            currentIndex={visualIndex}
            answers={practice.answers}
            results={practice.results}
            starredQuestions={starredQuestions}
            onJump={handleJump}
          />
        </div>
      </div>
  );
}
