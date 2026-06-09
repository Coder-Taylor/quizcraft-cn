import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  animate,
  AnimatePresence,
  motion,
  useMotionValue,
} from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Flag,
  CheckCircle2,
  XCircle,
  BookOpen,
  Timer,
} from "lucide-react";
import { useQuizStore } from "@/stores/quizStore";
import { practiceApi } from "@/api/client";
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

const SWIPE_THRESHOLD = 50;
const SWIPE_DIRECTION_RATIO = 1.25;
const SWIPE_MAX_DRAG = 120;
const CARD_TRANSITION_OFFSET = 24;
const PROGRESS_DOT_WINDOW_RADIUS = 40;

type SwipeDirection = -1 | 1;

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
  return Math.max(-SWIPE_MAX_DRAG, Math.min(SWIPE_MAX_DRAG, value));
};

const cardVariants = {
  enter: (direction: SwipeDirection) => ({
    x: direction * CARD_TRANSITION_OFFSET,
  }),
  center: { x: 0 },
  exit: (direction: SwipeDirection) => ({
    x: direction * -CARD_TRANSITION_OFFSET,
  }),
};

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
  if (starred) {
    return current ? "bg-yellow-400 w-4" : "bg-yellow-400";
  }

  if (current) {
    return "bg-primary-500 w-4";
  }

  if (answered) {
    return correct ? "bg-green-400" : "bg-red-400";
  }

  return "bg-gray-200";
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
    <div className="mt-3 overflow-x-auto pb-1" data-swipe-ignore="true">
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
      <span className="flex-1 pt-1">{text}</span>
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
    nextQuestion,
    prevQuestion,
    jumpToQuestion,
    finishPractice,
    toggleStar,
    starredQuestions,
  } = useQuizStore();

  const [selectedAnswer, setSelectedAnswer] = useState<any>(null);
  const [showResult, setShowResult] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [transitionDirection, setTransitionDirection] =
    useState<SwipeDirection>(1);
  const dragX = useMotionValue(0);
  const dragXRef = useRef(0);
  const swipeStartRef = useRef<SwipeStart | null>(null);

  const currentIndex = practice?.currentIndex ?? -1;

  useEffect(() => {
    if (!practice) {
      navigate("/practice");
      return;
    }

    const currentQ = practice.questions[currentIndex];
    if (currentQ && practice.answers[currentQ.id] !== undefined) {
      setSelectedAnswer(practice.answers[currentQ.id]);
      setShowResult(true);
    } else {
      setSelectedAnswer(null);
      setShowResult(false);
    }
  }, [practice, currentIndex, navigate]);

  const startTime = practice?.startTime;
  const isFinished = practice?.isFinished ?? false;

  useEffect(() => {
    if (!startTime || isFinished) return;

    const timer = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    return () => clearInterval(timer);
  }, [startTime, isFinished]);

  if (!practice) return null;

  const currentQuestion = practice.questions[practice.currentIndex];
  if (!currentQuestion) return null;

  const progress =
    ((practice.currentIndex + 1) / practice.questions.length) * 100;

  const result =
    practice.answers[currentQuestion.id] !== undefined
      ? {
          correct: practice.results[currentQuestion.id],
          correctAnswer: practice.correctAnswers[currentQuestion.id],
          analysis: practice.analyses[currentQuestion.id],
        }
      : null;

  const handleOptionSelect = (index: number) => {
    if (showResult) return;

    if (currentQuestion.type === "multi") {
      // 多选题：切换选择
      const current = (selectedAnswer as number[]) || [];
      const newAnswer = current.includes(index)
        ? current.filter((i) => i !== index)
        : [...current, index].sort();
      setSelectedAnswer(newAnswer);
    } else {
      // 单选题：直接提交
      setSelectedAnswer(index);
      submitAnswer(index);
    }
  };

  const handleJudgeSelect = (value: boolean) => {
    if (showResult) return;
    setSelectedAnswer(value);
    submitAnswer(value);
  };

  const submitAnswer = (answer: any) => {
    if (!currentBank || !currentQuestion) return;

    const questionId = currentQuestion.id;
    const localCorrectAnswer = currentQuestion.answer;
    const localIsCorrect = isAnswerCorrect(
      answer,
      localCorrectAnswer,
      currentQuestion.type,
    );

    setShowResult(true);
    answerQuestion({
      questionId,
      answer,
      isCorrect: localIsCorrect,
      correctAnswer: localCorrectAnswer,
      analysis: currentQuestion.analysis,
    });

    void practiceApi
      .submitAnswer(currentBank, questionId, answer)
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

  const handleMultiSubmit = () => {
    if (
      !selectedAnswer ||
      (selectedAnswer as number[]).length === 0 ||
      showResult
    ) {
      return;
    }
    submitAnswer(selectedAnswer);
  };

  const resetSwipeState = (animateBack = true) => {
    swipeStartRef.current = null;
    dragXRef.current = 0;

    if (animateBack) {
      animate(dragX, 0, { duration: 0.12, ease: "easeOut" });
    } else {
      dragX.set(0);
    }
  };

  const setDragPosition = (value: number) => {
    const clamped = clampSwipeDrag(value);
    dragXRef.current = clamped;
    dragX.set(clamped);
  };

  const handleNext = () => {
    resetSwipeState(false);
    setTransitionDirection(1);
    if (practice.currentIndex < practice.questions.length - 1) {
      nextQuestion();
      setSelectedAnswer(null);
      setShowResult(false);
    } else {
      finishPractice();
      navigate("/result");
    }
  };

  const handlePrev = () => {
    resetSwipeState(false);
    setTransitionDirection(-1);
    prevQuestion();
  };

  const handleCardTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1 || shouldIgnoreSwipeTarget(event.target)) {
      resetSwipeState();
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
    dragX.set(0);
  };

  const handleCardTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    if (!start?.tracking || event.touches.length !== 1) return;

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
    setDragPosition(deltaX);
  };

  const handleCardTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    if (!start?.tracking) {
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
      resetSwipeState(false);
      handleNext();
      return;
    }

    if (practice.currentIndex > 0) {
      resetSwipeState(false);
      handlePrev();
      return;
    }

    resetSwipeState();
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const starred = starredQuestions.includes(currentQuestion.id);
  const difficulty = currentQuestion.stats
    ? getDifficultyLabel(currentQuestion.stats.rate)
    : null;

  return (
    <div className="max-w-3xl mx-auto">
      {/* 顶部进度条 */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-gray-100 -mx-4 px-4 py-3 mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <BookOpen className="w-4 h-4" />
            <span>
              题目 {practice.currentIndex + 1} / {practice.questions.length}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-sm text-gray-500">
              <Timer className="w-4 h-4" />
              <span>{formatTime(elapsedTime)}</span>
            </div>
            <button
              onClick={() => toggleStar(currentQuestion.id)}
              className={`p-1.5 rounded-lg transition-colors ${starred ? "text-yellow-500 bg-yellow-50" : "text-gray-400 hover:bg-gray-100"}`}
            >
              <Flag className={`w-4 h-4 ${starred ? "fill-current" : ""}`} />
            </button>
          </div>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* 题目卡片 */}
      <AnimatePresence custom={transitionDirection} mode="wait">
        <motion.div
          key={currentQuestion.id}
          custom={transitionDirection}
          variants={cardVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.16, ease: "easeOut" }}
        >
          <motion.div
            style={{ x: dragX }}
            onTouchStart={handleCardTouchStart}
            onTouchMove={handleCardTouchMove}
            onTouchEnd={handleCardTouchEnd}
            onTouchCancel={() => resetSwipeState()}
            className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 touch-pan-y will-change-transform"
          >
            {/* 题目信息 */}
            <div className="flex items-center gap-2 mb-4">
              <span
                className={`px-2.5 py-1 rounded-lg text-xs font-medium ${getTypeColor(currentQuestion.type)}`}
              >
                {formatQuestionType(currentQuestion.type)}
              </span>
              {difficulty && (
                <span
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium ${difficulty.color}`}
                >
                  {difficulty.label} · 正确率 {currentQuestion.stats?.rate}%
                </span>
              )}
              <span className="text-xs text-gray-400">
                {currentQuestion.chapter}
              </span>
            </div>

            {/* 题目内容 */}
            <h2 className="text-lg font-medium text-gray-800 mb-6 leading-relaxed">
              {currentQuestion.content}
            </h2>

            {/* 选项区域 */}
            <div className="space-y-3 mb-6">
              {currentQuestion.type === "judge" ? (
                <JudgeButtons
                  selected={selectedAnswer}
                  correct={result?.correctAnswer}
                  showResult={showResult}
                  onSelect={handleJudgeSelect}
                />
              ) : (
                currentQuestion.options?.map((option, index) => {
                  const isSelected =
                    currentQuestion.type === "multi"
                      ? (selectedAnswer as number[])?.includes(index)
                      : selectedAnswer === index;

                  const isCorrect = showResult
                    ? currentQuestion.type === "multi"
                      ? (result?.correctAnswer as number[])?.includes(index)
                      : result?.correctAnswer === index
                    : undefined;

                  const isMissed = Boolean(
                    showResult &&
                    currentQuestion.type === "multi" &&
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
                      showResult={showResult}
                      onClick={() => handleOptionSelect(index)}
                    />
                  );
                })
              )}
            </div>

            {/* 多选题提交按钮 */}
            {currentQuestion.type === "multi" && !showResult && (
              <button
                onClick={handleMultiSubmit}
                disabled={
                  !selectedAnswer || (selectedAnswer as number[]).length === 0
                }
                className="w-full py-3 bg-primary-500 text-white font-medium rounded-xl hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mb-4"
              >
                提交答案
              </button>
            )}

            {/* 结果展示 */}
            {showResult && result && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
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
                      {formatAnswer(result.correctAnswer, currentQuestion.type)}
                    </span>
                  </div>
                )}

                {result.analysis && (
                  <div className="mt-3 pt-3 border-t border-gray-200/50">
                    <div className="text-sm font-medium text-gray-700 mb-1">
                      解析
                    </div>
                    <div className="text-sm text-gray-600 leading-relaxed">
                      {result.analysis}
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {/* 导航按钮 */}
            <div className="pt-4 border-t border-gray-100">
              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={handlePrev}
                  disabled={practice.currentIndex === 0}
                  className="flex items-center gap-1 px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                >
                  <ChevronLeft className="w-5 h-5" />
                  上一题
                </button>

                <button
                  onClick={handleNext}
                  className="flex items-center gap-1 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors flex-shrink-0"
                >
                  {practice.currentIndex === practice.questions.length - 1
                    ? "查看结果"
                    : "下一题"}
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>

              <ProgressDots
                questions={practice.questions}
                currentIndex={practice.currentIndex}
                answers={practice.answers}
                results={practice.results}
                starredQuestions={starredQuestions}
                onJump={jumpToQuestion}
              />
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
