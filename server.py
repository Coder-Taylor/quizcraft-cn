#!/usr/bin/env python3
# -*- coding: UTF-8 -*
"""
刷题系统后端 - FastAPI 版本
提供 RESTful API 和 WebSocket 实时推送
"""

import json
import os
import re
import tempfile
import shutil
import asyncio
import hashlib
import time
from typing import Dict, List, Optional, Any, Set, Tuple
from datetime import datetime
from collections import defaultdict
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

# 导入 LLM 服务
try:
    from llm_service import LLMService, LLMConfig
except ImportError:
    LLMService = None
    LLMConfig = None


# WebSocket 连接管理
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
    
    async def connect(self, client_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[client_id] = websocket
    
    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]
    
    async def send_progress(self, client_id: str, current: int, total: int, message: str = ""):
        if client_id in self.active_connections:
            await self.active_connections[client_id].send_json({
                "type": "progress",
                "current": current,
                "total": total,
                "percentage": round(current / total * 100, 1),
                "message": message
            })
    
    async def send_complete(self, client_id: str, questions: List[Dict]):
        if client_id in self.active_connections:
            await self.active_connections[client_id].send_json({
                "type": "complete",
                "questions": questions
            })
    
    async def send_error(self, client_id: str, error: str):
        if client_id in self.active_connections:
            await self.active_connections[client_id].send_json({
                "type": "error",
                "error": error
            })

manager = ConnectionManager()


# ============== 数据模型 ==============

class PracticeSettings(BaseModel):
    mode: str = "random"
    params: Dict[str, Any] = {}


class StartPracticeRequest(BaseModel):
    bank: str
    mode: str
    params: Dict[str, Any]


class SubmitAnswerRequest(BaseModel):
    bank: str
    question_id: str
    answer: Any
    user_id: Optional[str] = None


class UserRequest(BaseModel):
    name: Optional[str] = None


class AnalysisConfig(BaseModel):
    provider: str = "deepseek"
    apiKey: str = ""
    apiUrl: Optional[str] = None
    model: Optional[str] = None
    # 可选：支持多 API 配置并发（每个配置可使用不同 provider）
    apiConfigs: Optional[List[Dict[str, Any]]] = None


class AnalyzeRequest(BaseModel):
    questions: List[Dict]
    config: AnalysisConfig


class ExportRequest(BaseModel):
    questions: List[Dict]
    name: str


class SaveBankRequest(BaseModel):
    name: str
    questions: List[Dict]
    key: Optional[str] = None
    color: Optional[str] = None
    overwrite: bool = False


# ============== 全局状态 ==============

QUESTION_BANKS: Dict[str, Dict] = {}
USER_STATS: Dict[str, Dict] = defaultdict(lambda: {
    "name": "",
    "correct": 0,
    "total": 0,
    "practice_history": []
})
NAME_TO_ID: Dict[str, str] = {}
NEXT_USER_ID = 1
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TIKU_DIR = os.path.join(BASE_DIR, "tiku")
EXPORT_DIR = os.path.join(BASE_DIR, "exports")
RANK_FILE = os.path.join(BASE_DIR, "rankings_v2.json")
QUESTION_STATS_FILE = os.path.join(BASE_DIR, "question_stats.json")
API_CONFIG_CACHE: Dict[str, Tuple[float, List["LLMConfig"]]] = {}
API_CONFIG_CACHE_TTL = 30 * 60  # 30 分钟
QUESTION_GLOBAL_STATS: Dict[str, Dict[str, Dict[str, float]]] = defaultdict(dict)
BANK_COLOR_PALETTE = [
    "#1976d2",
    "#2e7d32",
    "#c62828",
    "#6a1b9a",
    "#ef6c00",
    "#00838f",
    "#5d4037",
    "#7b1fa2",
]

JUDGE_TRUE_VALUES = {
    "true", "t", "1", "yes", "y", "right",
    "对", "正确", "是", "√",
}
JUDGE_FALSE_VALUES = {
    "false", "f", "0", "no", "n", "wrong",
    "错", "错误", "否", "×",
}


# ============== 题库加载 ==============

def normalize_bank_color(color: Optional[str], fallback_key: str = "") -> str:
    if isinstance(color, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", color.strip()):
        return color.strip()
    if not fallback_key:
        return BANK_COLOR_PALETTE[0]
    digest = hashlib.md5(fallback_key.encode("utf-8")).hexdigest()
    return BANK_COLOR_PALETTE[int(digest[:8], 16) % len(BANK_COLOR_PALETTE)]


def sanitize_bank_key(raw: Optional[str]) -> str:
    text = str(raw or "").strip().lower()
    safe = re.sub(r"[^\w\u4e00-\u9fff-]+", "_", text).strip("_")
    return safe or f"bank_{int(time.time())}"


def register_question_bank(
    key: str,
    name: str,
    color: Optional[str],
    file_path: str,
    data: Any,
    files: Optional[List[str]] = None,
):
    QUESTION_BANKS[key] = {
        "name": name,
        "files": files or [os.path.basename(file_path)],
        "color": normalize_bank_color(color, key),
        "file": file_path,
        "data": data,
    }


def load_bank_from_file(
    key: str,
    file_path: str,
    name: Optional[str] = None,
    color: Optional[str] = None,
    files: Optional[List[str]] = None,
) -> bool:
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if not isinstance(data, dict):
            raise ValueError("题库文件顶层必须是 JSON 对象")

        meta = data.get("meta", {}) if isinstance(data, dict) else {}
        register_question_bank(
            key=key,
            name=str(name or meta.get("name") or key),
            color=color or meta.get("color"),
            file_path=file_path,
            data=data,
            files=files,
        )
        print(f"✓ 加载题库: {QUESTION_BANKS[key]['name']} ({key}) <- {file_path}")
        return True
    except Exception as e:
        print(f"✗ 加载失败 {key}: {e}")
        return False


def build_bank_summary(key: str, bank: Dict[str, Any]) -> Dict[str, Any]:
    data = bank["data"]
    chapters = []

    parsed_questions = parse_question_bank(data, key)
    seen = set()
    for q in parsed_questions:
        ch_name = q.get("chapter")
        ch_id = q.get("chapter_id")
        if not ch_name:
            continue
        if not ch_id:
            ch_id = str(ch_name)
        if ch_id not in seen:
            chapters.append({"id": ch_id, "name": ch_name})
            seen.add(ch_id)

    if not chapters:
        chapters = [{"id": "ch01", "name": "默认章节"}]

    total = 0
    if isinstance(data, dict) and "questions" in data:
        total = len(parsed_questions)
    elif isinstance(data, dict) and "meta" in data:
        total = data["meta"].get("total", 0)
    elif isinstance(data, dict):
        total = sum(
            len(items)
            for types in data.values()
            if isinstance(types, dict)
            for items in types.values()
            if isinstance(items, list)
        )

    return {
        "key": key,
        "name": bank["name"],
        "color": bank["color"],
        "total": total,
        "chapters": chapters,
    }


def build_standard_bank_data(name: str, questions: List[Dict], color: Optional[str] = None) -> Dict[str, Any]:
    normalized_questions: List[Dict[str, Any]] = []
    chapter_to_id: Dict[str, str] = {}

    for idx, raw in enumerate(questions, start=1):
        if not isinstance(raw, dict):
            continue

        content = str(
            raw.get("content")
            or raw.get("question")
            or raw.get("title")
            or ""
        ).strip()
        if not content:
            raise HTTPException(status_code=400, detail=f"第 {idx} 题题干不能为空")

        chapter_name = str(raw.get("chapter") or "默认章节").strip() or "默认章节"
        chapter_id = str(raw.get("chapter_id") or "").strip()
        if not chapter_id:
            chapter_id = chapter_to_id.setdefault(chapter_name, f"ch{len(chapter_to_id) + 1:02d}")

        q_type = _normalize_q_type(raw.get("type"), _answer_to_text(raw.get("answer"), "single"))
        analysis = str(raw.get("analysis") or "").strip()

        question: Dict[str, Any] = {
            "id": str(raw.get("id") or f"q{idx:04d}"),
            "number": str(raw.get("number") or idx),
            "type": q_type,
            "content": content,
            "analysis": analysis,
            "chapter": chapter_name,
            "chapter_id": chapter_id,
            "stats": {
                "total": 0,
                "correct": 0,
                "rate": 0,
            },
        }

        if q_type == "judge":
            normalized_answer = normalize_judge_answer(raw.get("answer"))
            if normalized_answer is None:
                raise HTTPException(status_code=400, detail=f"第 {idx} 题判断题答案必须是“对/错”")
            question["answer"] = normalized_answer
            question["options"] = None
            normalized_questions.append(question)
            continue

        options = [opt for opt in _normalize_options(raw.get("options")) if opt]
        if len(options) < 2:
            raise HTTPException(status_code=400, detail=f"第 {idx} 题至少需要 2 个有效选项")

        normalized_type, normalized_answer = normalize_choice_answer(
            raw.get("answer"),
            q_type,
            options,
            analysis,
            content,
        )
        if normalized_answer is None:
            raise HTTPException(status_code=400, detail=f"第 {idx} 题答案格式无效，请检查正确答案")

        question["type"] = normalized_type
        question["options"] = options
        question["answer"] = normalized_answer
        normalized_questions.append(question)

    if not normalized_questions:
        raise HTTPException(status_code=400, detail="题库中没有可保存的题目")

    meta = {
        "name": name,
        "version": "1.0.0",
        "created_at": datetime.now().isoformat(),
        "total": len(normalized_questions),
        "chapter_count": len(chapter_to_id) or 1,
    }
    normalized_color = normalize_bank_color(color, name)
    if normalized_color:
        meta["color"] = normalized_color

    return {
        "meta": meta,
        "questions": normalized_questions,
    }

def load_question_banks():
    """加载所有题库"""
    QUESTION_BANKS.clear()
    os.makedirs(TIKU_DIR, exist_ok=True)
    banks = {
        "sixiu": {
            "name": "思想道德与法治",
            "files": ["sixiu_with_stats.json", "sixiu.json"],
            "color": "#2e7d32"
        },
        "xigai": {
            "name": "习概",
            "files": ["xigai.json"],
            "color": "#1976d2"
        },
        "history": {
            "name": "近代史",
            "files": ["history.json", "chapters.json"],
            "color": "#c62828"
        }
    }

    loaded_files: Set[str] = set()
    for key, config in banks.items():
        file_path = None
        candidates = config.get("files", [])
        # 兼容：优先项目根目录，其次 tiku 目录
        for candidate in candidates:
            candidate_paths = [
                os.path.join(BASE_DIR, candidate),
                os.path.join(TIKU_DIR, candidate),
            ]
            for candidate_path in candidate_paths:
                if os.path.exists(candidate_path):
                    file_path = candidate_path
                    break
            if file_path:
                break

        if file_path and os.path.exists(file_path):
            if load_bank_from_file(
                key=key,
                file_path=file_path,
                name=config["name"],
                color=config["color"],
                files=config.get("files"),
            ):
                loaded_files.add(os.path.abspath(file_path))

    for filename in sorted(os.listdir(TIKU_DIR)):
        if not filename.endswith(".json"):
            continue
        file_path = os.path.join(TIKU_DIR, filename)
        abs_path = os.path.abspath(file_path)
        key = os.path.splitext(filename)[0]
        if abs_path in loaded_files or key in QUESTION_BANKS:
            continue
        if load_bank_from_file(key=key, file_path=file_path):
            loaded_files.add(abs_path)


def save_rankings():
    """保存排行榜"""
    try:
        data = {
            "users": dict(USER_STATS),
            "name_to_id": NAME_TO_ID,
        }
        with open(RANK_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"保存排行榜失败: {e}")


def load_rankings():
    """加载排行榜"""
    global NEXT_USER_ID
    if not os.path.exists(RANK_FILE):
        return
    try:
        with open(RANK_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        users = data.get("users", {})
        name_to_id = data.get("name_to_id", {})
        USER_STATS.clear()
        USER_STATS.update(users)
        NAME_TO_ID.clear()
        NAME_TO_ID.update(name_to_id)
        if users:
            numeric_ids = [int(uid) for uid in users.keys() if uid.isdigit()]
            NEXT_USER_ID = max(numeric_ids + [0]) + 1
    except Exception as e:
        print(f"加载排行榜失败: {e}")


def save_question_stats():
    """保存全站题目统计"""
    try:
        with open(QUESTION_STATS_FILE, 'w', encoding='utf-8') as f:
            json.dump(dict(QUESTION_GLOBAL_STATS), f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"保存题目统计失败: {e}")


def load_question_stats():
    """加载全站题目统计"""
    if not os.path.exists(QUESTION_STATS_FILE):
        return
    try:
        with open(QUESTION_STATS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        QUESTION_GLOBAL_STATS.clear()
        for bank, stats in data.items():
            if isinstance(stats, dict):
                QUESTION_GLOBAL_STATS[bank] = stats
    except Exception as e:
        print(f"加载题目统计失败: {e}")


def apply_global_question_stats(bank_key: str, questions: List[Dict]) -> List[Dict]:
    """将全站统计覆盖到题目列表"""
    bank_stats = QUESTION_GLOBAL_STATS.get(bank_key, {})
    if not bank_stats:
        return questions
    for q in questions:
        qid = str(q.get("id", ""))
        if not qid:
            continue
        stat = bank_stats.get(qid)
        if not stat:
            continue
        q["stats"] = {
            "total": int(stat.get("total", 0)),
            "correct": int(stat.get("correct", 0)),
            "rate": float(stat.get("rate", 0)),
        }
    return questions


def update_global_question_stats(bank_key: str, question_id: str, is_correct: bool):
    """更新全站题目统计"""
    bank_stats = QUESTION_GLOBAL_STATS.setdefault(bank_key, {})
    current = bank_stats.setdefault(question_id, {"total": 0, "correct": 0, "rate": 0})
    current_total = int(current.get("total", 0)) + 1
    current_correct = int(current.get("correct", 0)) + (1 if is_correct else 0)
    current_rate = round(current_correct / current_total * 100, 1) if current_total else 0
    bank_stats[question_id] = {
        "total": current_total,
        "correct": current_correct,
        "rate": current_rate,
    }


# ============== 工具函数 ==============

def normalize_judge_answer(value: Any) -> Optional[bool]:
    """将判断题答案统一转换为布尔值。无法识别时返回 None。"""
    if isinstance(value, bool):
        return value

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if value == 1:
            return True
        if value == 0:
            return False

    if isinstance(value, str):
        text = value.strip().lower()
        if text in JUDGE_TRUE_VALUES:
            return True
        if text in JUDGE_FALSE_VALUES:
            return False

    return None


def infer_judge_answer_from_analysis(analysis: Any, allow_positive_fallback: bool = False) -> Optional[bool]:
    """从解析文本中推断判断题答案。"""
    if not isinstance(analysis, str):
        return None

    text = analysis.strip()
    if not text:
        return None

    head = text[:64]
    false_markers = [
        "错误", "不正确", "有误", "不准确", "不成立", "不符合", "并非",
        "不是", "不属于", "不能", "不存在", "不对",
    ]
    true_markers = ["正确", "无误", "成立", "准确", "符合", "确实", "属实"]

    if any(marker in head for marker in false_markers):
        return False
    if any(marker in head for marker in true_markers):
        return True

    if re.search(r"(因此|所以|由此可见|综上).{0,12}(错误|不正确|不准确)", text):
        return False
    if re.search(r"(因此|所以|由此可见|综上).{0,12}(正确|成立|准确)", text):
        return True

    if allow_positive_fallback and not any(marker in text for marker in false_markers):
        return True

    return None


def normalize_text_for_match(text: Any) -> str:
    if not isinstance(text, str):
        return ""
    return re.sub(r"[^0-9A-Za-z一-鿿]+", "", text).lower()


def extract_choice_letters(text: Any) -> Optional[List[str]]:
    if not isinstance(text, str):
        return None
    letters = re.findall(r"[A-F]", text.upper())
    if not letters:
        return None
    deduped: List[str] = []
    for letter in letters:
        if letter not in deduped:
            deduped.append(letter)
    return deduped or None


def choice_letters_to_answer(letters: List[str], q_type: str) -> Tuple[str, Any]:
    indices = [ord(letter) - 65 for letter in letters if 'A' <= letter <= 'F']
    if not indices:
        return q_type, None
    if q_type == "multi" or len(indices) > 1:
        return "multi", indices
    return "single", indices[0]


def infer_choice_answer_from_analysis(
    analysis: Any,
    options: Optional[List[str]],
    q_type: str,
    stem: str = "",
) -> Tuple[str, Any]:
    if not isinstance(analysis, str):
        return q_type, None

    text = analysis.strip()
    if not text:
        return q_type, None

    explicit_patterns = [
        r"正确答案(?:是|为|应为|应是)?[:：]?\s*([A-F](?:\s*[、,，和及]\s*[A-F])*)",
        r"答案(?:是|为|应为|应是)?[:：]?\s*([A-F](?:\s*[、,，和及]\s*[A-F])*)",
        r"([A-F](?:\s*[、,，和及]\s*[A-F])+)项均正确",
        r"([A-F](?:\s*[、,，和及]\s*[A-F])+)选项均正确",
        r"选项\s*([A-F](?:\s*[、,，和及]\s*[A-F])*)\s*(?:正确|符合|准确)",
    ]
    for pattern in explicit_patterns:
        match = re.search(pattern, text, re.I)
        if match:
            letters = extract_choice_letters(match.group(1))
            if letters:
                return choice_letters_to_answer(letters, q_type)

    normalized_stem = normalize_text_for_match(stem)
    if any(marker in normalized_stem for marker in ["错误", "不正确", "不准确", "不属于", "不恰当"]):
        match = re.search(r"([A-F])项(?:错误|不正确|不准确|不符合|不属于)", text, re.I)
        if match:
            letters = extract_choice_letters(match.group(1))
            if letters:
                return choice_letters_to_answer(letters, "single")
    else:
        match = re.search(r"([A-F])项(?:正确|符合|准确)", text, re.I)
        if match:
            letters = extract_choice_letters(match.group(1))
            if letters:
                return choice_letters_to_answer(letters, q_type)

    if not options:
        return q_type, None

    normalized_analysis = normalize_text_for_match(text)
    if not normalized_analysis:
        return q_type, None

    negative_markers = [
        "其他选项", "其余选项", "均不", "错误", "不正确", "不准确",
        "不符合", "不选", "均非", "表述错误",
    ]
    negative_positions = [
        pos for pos in (normalized_analysis.find(normalize_text_for_match(marker)) for marker in negative_markers)
        if pos >= 0
    ]
    cutoff = min(negative_positions) if negative_positions else len(normalized_analysis)

    positions: List[Tuple[int, int]] = []
    for index, option in enumerate(options):
        normalized_option = normalize_text_for_match(option)
        if not normalized_option:
            continue
        pos = normalized_analysis.find(normalized_option)
        if pos >= 0:
            positions.append((index, pos))

    early_indices = [index for index, pos in positions if pos < cutoff and pos < 50]
    if early_indices:
        return choice_letters_to_answer([chr(index + 65) for index in early_indices], q_type)

    if len(positions) == 1:
        only_index = positions[0][0]
        return choice_letters_to_answer([chr(only_index + 65)], q_type)

    return q_type, None


def normalize_choice_answer(
    answer: Any,
    q_type: str,
    options: Optional[List[str]],
    analysis: Any,
    stem: str = "",
) -> Tuple[str, Any]:
    if isinstance(answer, list):
        normalized_indices = [int(item) for item in answer if isinstance(item, (int, float, str)) and str(item).isdigit()]
        if normalized_indices:
            if q_type == "multi" or len(normalized_indices) > 1:
                return "multi", normalized_indices
            return "single", normalized_indices[0]

    if isinstance(answer, (int, float)) and not isinstance(answer, bool):
        return ("multi", [int(answer)]) if q_type == "multi" else ("single", int(answer))

    letters = extract_choice_letters(answer)
    if letters:
        return choice_letters_to_answer(letters, q_type)

    return infer_choice_answer_from_analysis(analysis, options, q_type, stem)


def parse_question_bank(data: Dict, bank_key: str) -> List[Dict]:
    """解析题库为统一格式"""
    questions = []
    
    # 检测格式类型
    if "questions" in data:
        # 新格式：补齐 chapter/chapter_id 兼容字段
        chapter_to_id: Dict[str, str] = {}
        next_chapter_no = 1
        normalized: List[Dict] = []
        for i, raw_q in enumerate(data["questions"]):
            if not isinstance(raw_q, dict):
                continue
            q = dict(raw_q)
            q_type = str(q.get("type", "single")).lower()
            q["type"] = q_type
            chapter_name = (
                q.get("chapter")
                or q.get("chapterName")
                or q.get("section")
                or q.get("章节")
            )
            chapter_id = q.get("chapter_id")

            if chapter_name and not chapter_id:
                if chapter_name not in chapter_to_id:
                    chapter_to_id[chapter_name] = f"ch{next_chapter_no:02d}"
                    next_chapter_no += 1
                chapter_id = chapter_to_id[chapter_name]
                q["chapter_id"] = chapter_id
                q["chapter"] = chapter_name
            elif chapter_id and not chapter_name:
                q["chapter"] = str(chapter_id)

            # 保底 id
            if not q.get("id"):
                q["id"] = f"q{i+1:04d}"

            options = q.get("options")
            answer = q.get("answer")

            if isinstance(options, list) and len(options) > 0:
                q["options"] = options
            else:
                q["options"] = None

            answer_is_blank = answer is None or (isinstance(answer, str) and not answer.strip())

            if q_type in ("single", "multi") and q.get("options"):
                normalized_type, normalized_answer = normalize_choice_answer(
                    answer,
                    q_type,
                    q.get("options"),
                    q.get("analysis"),
                    q.get("content", ""),
                )
                q["type"] = normalized_type
                if normalized_answer is not None:
                    q["answer"] = normalized_answer

            # 仅兼容“被错误标成 single 的判断题”；multi 一律不转判断题
            if q_type == "single" and not q.get("options"):
                inferred_answer = normalize_judge_answer(answer)
                if inferred_answer is None and answer_is_blank:
                    inferred_answer = infer_judge_answer_from_analysis(
                        q.get("analysis"),
                        allow_positive_fallback=True,
                    )
                if inferred_answer is not None:
                    q["type"] = "judge"
                    q["answer"] = inferred_answer
                    q["options"] = None

            if q.get("type") == "judge":
                normalized_answer = normalize_judge_answer(q.get("answer"))
                if normalized_answer is None and answer_is_blank:
                    normalized_answer = infer_judge_answer_from_analysis(
                        q.get("analysis"),
                        allow_positive_fallback=True,
                    )
                if normalized_answer is not None:
                    q["answer"] = normalized_answer
                q["options"] = None

            # 题目数据异常：选择题缺失选项或答案未能规范化时，直接跳过
            if q.get("type") in ("single", "multi") and not q.get("options"):
                continue
            if q.get("type") == "single" and not isinstance(q.get("answer"), int):
                continue
            if q.get("type") == "multi" and not isinstance(q.get("answer"), list):
                continue

            normalized.append(q)
        return apply_global_question_stats(bank_key, normalized)
    
    # 旧格式转换
    qid = 1
    chapter_no = 1
    for chapter_name, types in data.items():
        chapter_id = f"ch{chapter_no:02d}"
        chapter_no += 1
        
        for type_name, items in types.items():
            q_type = "single"
            if "多选" in type_name or "多项" in type_name:
                q_type = "multi"
            elif "判断" in type_name:
                q_type = "judge"
            
            for item_text in items:
                question = parse_question_text(item_text, q_type, chapter_id, chapter_name, qid)
                if question:
                    questions.append(question)
                    qid += 1
    
    return apply_global_question_stats(bank_key, questions)


def parse_question_text(text: str, q_type: str, chapter_id: str, chapter_name: str, qid: int) -> Optional[Dict]:
    """解析单个题目文本"""
    lines = text.strip().split('\n')
    if not lines:
        return None
    
    # 提取题干
    stem = lines[0]
    # 去掉题号
    stem = re.sub(r'^\d+[、.]\s*', '', stem)
    
    # 提取选项
    options = []
    answer = None
    analysis = ""
    
    for line in lines[1:]:
        line = line.strip()
        if not line:
            continue
        
        # 答案行
        answer_match = re.match(r'^答案\s*[：:]\s*(.+)$', line)
        if answer_match:
            answer_text = answer_match.group(1).strip()
            
            if q_type == "judge":
                answer = answer_text.lower() in ["对", "正确", "√", "true", "t", "是", "yes", "y"]
            elif q_type == "multi":
                # 多选答案转为索引数组
                answer = [ord(c.upper()) - 65 for c in answer_text if c.upper() in 'ABCDEF']
            else:
                # 单选转为索引
                m = re.search(r'[A-Fa-f]', answer_text)
                answer = ord(m.group(0).upper()) - 65 if m else 0
        
        # 解析行
        elif re.match(r'^解析\s*[：:]', line):
            analysis = re.sub(r'^解析\s*[：:]\s*', '', line).strip()
        
        # 选项行
        elif re.match(r'^[A-F][、.．]', line):
            option_text = re.sub(r'^[A-F][、.．]\s*', '', line)
            options.append(option_text)
    
    return {
        "id": f"q{qid:04d}",
        "type": q_type,
        "chapter": chapter_name,
        "chapter_id": chapter_id,
        "content": stem,
        "options": options if options else None,
        "answer": answer,
        "analysis": analysis,
        "stats": {
            "total": 0,
            "correct": 0,
            "rate": 0
        }
    }


# ============== FastAPI 应用 ==============

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    print("🚀 正在初始化...")
    load_question_banks()
    load_rankings()
    load_question_stats()
    print(f"📚 已加载 {len(QUESTION_BANKS)} 个题库")
    yield
    print("👋 正在关闭...")
    save_rankings()
    save_question_stats()


app = FastAPI(
    title="刷题系统 API",
    description="React + TypeScript 刷题应用后端",
    version="2.0.0",
    lifespan=lifespan
)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============== API 路由 ==============

@app.get("/api/banks")
async def get_banks():
    """获取题库列表"""
    return {
        "banks": [
            build_bank_summary(key, bank)
            for key, bank in QUESTION_BANKS.items()
        ]
    }


@app.post("/api/practice/start")
async def start_practice(request: StartPracticeRequest):
    """开始练习"""
    if request.bank not in QUESTION_BANKS:
        raise HTTPException(status_code=404, detail="题库不存在")
    
    bank_data = QUESTION_BANKS[request.bank]["data"]
    questions = parse_question_bank(bank_data, request.bank)
    
    mode = request.mode
    params = request.params
    raw_count = params.get("count", 20)
    try:
        count = int(raw_count)
    except (TypeError, ValueError):
        count = 20
    unlimited = count <= 0
    
    import random

    def _sample(pool: List[Dict]) -> List[Dict]:
        if not pool:
            return []
        if unlimited:
            return random.sample(pool, len(pool))
        return random.sample(pool, min(count, len(pool)))
    
    if mode == "random":
        # 随机模式
        selected = _sample(questions)
    
    elif mode == "chapter":
        # 章节模式
        chapter_id = params.get("chapter_id")
        chapter_q = [q for q in questions if q.get("chapter_id") == chapter_id or q.get("chapter") == chapter_id]
        selected = _sample(chapter_q)
    
    elif mode == "hard":
        # 难题模式
        threshold = params.get("threshold", 50)
        hard_q = [q for q in questions if q.get("stats", {}).get("total", 0) > 0 and q.get("stats", {}).get("rate", 100) < threshold]
        if not hard_q:
            # 如果没有统计，随机选
            hard_q = questions
        hard_q.sort(key=lambda x: x.get("stats", {}).get("rate", 100))
        selected = hard_q if unlimited else hard_q[:count]
    
    else:
        selected = _sample(questions)
    
    # 计算平均正确率
    avg_rate = sum(q.get("stats", {}).get("rate", 0) for q in selected) / len(selected) if selected else 0
    
    return {
        "questions": selected,
        "total": len(selected),
        "avg_rate": round(avg_rate, 1)
    }


@app.post("/api/practice/submit")
async def submit_answer(request: SubmitAnswerRequest):
    """提交答案"""
    if request.bank not in QUESTION_BANKS:
        raise HTTPException(status_code=404, detail="题库不存在")
    
    bank_data = QUESTION_BANKS[request.bank]["data"]
    questions = parse_question_bank(bank_data, request.bank)
    
    question = next((q for q in questions if q["id"] == request.question_id), None)
    if not question:
        raise HTTPException(status_code=404, detail="题目不存在")
    
    # 检查答案
    user_answer = request.answer
    correct_answer = question["answer"]
    q_type = question["type"]
    
    is_correct = False
    response_correct_answer = correct_answer
    if q_type == "judge":
        normalized_user_answer = normalize_judge_answer(user_answer)
        normalized_correct_answer = normalize_judge_answer(correct_answer)
        if normalized_correct_answer is not None:
            response_correct_answer = normalized_correct_answer
        is_correct = (
            normalized_user_answer is not None
            and normalized_correct_answer is not None
            and normalized_user_answer == normalized_correct_answer
        )
    elif q_type == "multi":
        user_sorted = sorted(user_answer) if isinstance(user_answer, list) else []
        correct_sorted = sorted(correct_answer) if isinstance(correct_answer, list) else []
        is_correct = user_sorted == correct_sorted
    else:
        is_correct = user_answer == correct_answer
    
    # 更新用户统计
    if request.user_id:
        USER_STATS[request.user_id]["total"] += 1
        if is_correct:
            USER_STATS[request.user_id]["correct"] += 1
        save_rankings()

    # 更新全站题目统计
    update_global_question_stats(request.bank, request.question_id, is_correct)
    save_question_stats()
    
    return {
        "correct": is_correct,
        "correct_answer": response_correct_answer,
        "analysis": question.get("analysis", ""),
        "stats": question.get("stats", {}),
        "user_stats": {
            "correct": USER_STATS[request.user_id]["correct"],
            "total": USER_STATS[request.user_id]["total"],
            "rate": round(USER_STATS[request.user_id]["correct"] / USER_STATS[request.user_id]["total"] * 100, 1)
        } if request.user_id else None
    }


@app.post("/api/user")
async def set_user(request: UserRequest):
    """设置用户信息"""
    global NEXT_USER_ID
    
    name = request.name or ""
    
    # 检查是否已存在
    if name and name in NAME_TO_ID:
        user_id = NAME_TO_ID[name]
        return {
            "user_id": user_id,
            "name": name,
            **USER_STATS[user_id]
        }
    
    # 创建新用户
    user_id = str(NEXT_USER_ID)
    NEXT_USER_ID += 1
    
    USER_STATS[user_id] = {
        "name": name or user_id,
        "correct": 0,
        "total": 0,
        "practice_history": []
    }
    
    if name:
        NAME_TO_ID[name] = user_id
    
    save_rankings()
    
    return {
        "user_id": user_id,
        "name": name or user_id,
        "correct": 0,
        "total": 0
    }


@app.get("/api/ranking")
async def get_ranking():
    """获取排行榜"""
    ranking = []
    for user_id, stats in USER_STATS.items():
        if stats["total"] > 0:
            ranking.append({
                "user_id": user_id,
                "name": stats.get("name", user_id),
                "correct": stats["correct"],
                "total": stats["total"],
                "accuracy": round(stats["correct"] / stats["total"] * 100, 1)
            })
    
    ranking.sort(key=lambda x: (-x["correct"], -x["accuracy"]))
    return {"ranking": ranking[:50]}


# ============== 文件提取 API ==============

@app.post("/api/extract/parse")
async def extract_parse(file: UploadFile = File(...)):
    """解析上传的文件"""
    # 保存临时文件
    suffix = os.path.splitext(file.filename)[1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name
    
    try:
        # 根据文件类型提取文本
        text = ""
        suffix_lower = suffix.lower()
        if suffix_lower == '.pdf':
            text = extract_text_from_pdf(tmp_path)
            questions = parse_questions_from_text(text)
        elif suffix_lower in ['.docx', '.doc']:
            text = extract_text_from_docx(tmp_path)
            questions = parse_questions_from_docx(tmp_path)
        elif suffix_lower == '.json':
            text = content.decode('utf-8-sig')
            questions = parse_questions_from_json_text(text)
            if not questions:
                raise HTTPException(status_code=400, detail="JSON 文件中未识别到题目，请检查字段或结构")
            return {
                "content": text[:1000] + "..." if len(text) > 1000 else text,
                "questions": questions
            }
        else:
            text = content.decode('utf-8-sig')
            questions = parse_questions_from_text(text)

        return {
            "content": text[:1000] + "..." if len(text) > 1000 else text,
            "questions": questions
        }
    finally:
        os.unlink(tmp_path)


def extract_text_from_pdf(path: str) -> str:
    """从 PDF 提取文本"""
    try:
        import PyPDF2
        text = ""
        with open(path, 'rb') as f:
            reader = PyPDF2.PdfReader(f)
            for page in reader.pages:
                text += page.extract_text() + "\n"
        return text
    except ImportError:
        raise HTTPException(status_code=500, detail="需要安装 PyPDF2: pip install PyPDF2")


def extract_text_from_docx(path: str) -> str:
    """从 Word 提取文本"""
    try:
        from docx import Document
        doc = Document(path)
        return "\n".join([p.text for p in doc.paragraphs])
    except ImportError:
        raise HTTPException(status_code=500, detail="需要安装 python-docx: pip install python-docx")


def parse_questions_from_docx(path: str) -> List[Dict]:
    """按段落结构解析 Word 题库，避免题干中的 IP/版本号被误判成新题号。"""
    try:
        from docx import Document
    except ImportError:
        raise HTTPException(status_code=500, detail="需要安装 python-docx: pip install python-docx")

    question_start_pattern = re.compile(r'^(?P<number>\d+)[、.．]\s*(?P<content>.+)$')
    option_pattern = re.compile(r'^(?P<label>[A-F])[、.．]\s*(?P<text>.+)$')
    answer_pattern = re.compile(r'^答案\s*[：:]\s*(?P<answer>.+)$')
    analysis_pattern = re.compile(r'^(?:解析|答案解析)\s*[：:]\s*(?P<analysis>.*)$')
    type_pattern = re.compile(r'【(?P<type>单选题|多选题|判断题)】')

    doc = Document(path)
    paragraphs = [re.sub(r'\s+', ' ', p.text).strip() for p in doc.paragraphs if p.text and p.text.strip()]
    questions: List[Dict[str, Any]] = []
    current: Optional[Dict[str, Any]] = None
    analysis_lines: List[str] = []
    chapter_name = "默认章节"
    chapter_id = "ch01"

    def finalize_current():
        nonlocal current, analysis_lines
        if not current:
            return
        current["content"] = re.sub(r'\s+', ' ', current["content"]).strip()
        current["options"] = [re.sub(r'\s+', ' ', option).strip() for option in current["options"] if option.strip()]
        current["analysis"] = re.sub(r'\s+', ' ', " ".join(analysis_lines or [current["analysis"]])).strip()
        if current["type"] == "judge" and not current["options"]:
            current["options"] = None
        questions.append(current)
        current = None
        analysis_lines = []

    def ensure_current(number: str, raw_content: str):
        nonlocal current, analysis_lines
        finalize_current()
        content = raw_content.strip()
        q_type = "single"
        type_match = type_pattern.search(content)
        if type_match:
            type_map = {"单选题": "single", "多选题": "multi", "判断题": "judge"}
            q_type = type_map[type_match.group("type")]
            content = type_pattern.sub("", content, count=1).strip()
        current = {
            "id": f"q{len(questions) + 1:04d}",
            "number": str(number),
            "type": q_type,
            "content": content,
            "options": [],
            "answer": "",
            "analysis": "",
            "chapter": chapter_name,
            "chapter_id": chapter_id,
        }
        analysis_lines = []

    for paragraph in paragraphs:
        question_match = question_start_pattern.match(paragraph)
        if question_match:
            ensure_current(question_match.group("number"), question_match.group("content"))
            continue

        if current is None:
            continue

        answer_match = answer_pattern.match(paragraph)
        if answer_match:
            answer_text = answer_match.group("answer").strip()
            answer_letters = extract_choice_letters(answer_text)
            if answer_letters:
                current["answer"] = "".join(answer_letters)
                if len(answer_letters) > 1:
                    current["type"] = "multi"
            else:
                current["answer"] = answer_text
            continue

        analysis_match = analysis_pattern.match(paragraph)
        if analysis_match:
            analysis_head = analysis_match.group("analysis").strip()
            analysis_lines = [analysis_head] if analysis_head else []
            continue

        option_match = option_pattern.match(paragraph)
        if option_match:
            current["options"].append(option_match.group("text").strip())
            continue

        if analysis_lines:
            analysis_lines.append(paragraph)
            continue

        if current["options"]:
            current["options"][-1] = f"{current['options'][-1]} {paragraph}".strip()
            continue

        current["content"] = f"{current['content']} {paragraph}".strip()

    finalize_current()
    return questions


def _answer_to_text(answer: Any, q_type: str) -> str:
    """将不同题库答案格式统一为文本格式。"""
    if answer is None:
        return ""
    if isinstance(answer, bool):
        return "对" if answer else "错"
    if isinstance(answer, int):
        if q_type in {"single", "multi"} and 0 <= answer < 26:
            return chr(65 + answer)
        return str(answer)
    if isinstance(answer, list):
        letters = []
        for item in answer:
            if isinstance(item, int) and 0 <= item < 26:
                letters.append(chr(65 + item))
            else:
                letters.append(str(item))
        return "".join(letters)
    return str(answer)


def _normalize_q_type(raw_type: Any, answer_text: str = "") -> str:
    type_text = str(raw_type or "").strip().lower()
    if type_text in {"single", "radio", "choice", "single_choice"}:
        return "single"
    if type_text in {"multi", "multiple", "multiple_choice", "checkbox"}:
        return "multi"
    if type_text in {"judge", "tf", "truefalse", "boolean"}:
        return "judge"

    # 中文题型兼容
    if any(k in str(raw_type) for k in ["多选", "多项"]):
        return "multi"
    if any(k in str(raw_type) for k in ["判断", "是非"]):
        return "judge"
    if any(k in str(raw_type) for k in ["单选", "单项"]):
        return "single"

    # 由答案兜底推断
    if answer_text and len(answer_text) > 1 and all(c.upper() in "ABCDEF" for c in answer_text):
        return "multi"
    if answer_text in {"对", "错", "正确", "错误", "√", "×", "true", "false", "True", "False"}:
        return "judge"
    return "single"


def _normalize_options(raw_options: Any) -> List[str]:
    if raw_options is None:
        return []
    if isinstance(raw_options, list):
        return [str(x).strip() for x in raw_options]
    if isinstance(raw_options, dict):
        # 兼容 {"A":"xxx","B":"yyy"}
        items = sorted(raw_options.items(), key=lambda kv: str(kv[0]))
        return [str(v).strip() for _, v in items]
    return []


def _normalize_question_item(raw: Dict, qid: int) -> Dict:
    content = (
        raw.get("content")
        or raw.get("question")
        or raw.get("title")
        or raw.get("stem")
        or raw.get("text")
        or raw.get("题目")
        or raw.get("题干")
        or ""
    )
    raw_answer = raw.get(
        "answer",
        raw.get("correctAnswer", raw.get("correct_answer", raw.get("答案", "")))
    )
    prelim_answer = _answer_to_text(raw_answer, "single")
    q_type = _normalize_q_type(
        raw.get("type", raw.get("questionType", raw.get("q_type", raw.get("题型", "")))),
        prelim_answer
    )
    answer_text = _answer_to_text(raw_answer, q_type)
    options = _normalize_options(
        raw.get(
            "options",
            raw.get("choices", raw.get("option", raw.get("optionList", raw.get("选项"))))
        )
    )
    return {
        "id": str(raw.get("id", f"q{qid:04d}")),
        "number": str(raw.get("number", qid)),
        "type": q_type,
        "content": str(content).strip(),
        "options": options or [],
        "answer": answer_text,
        "analysis": str(raw.get("analysis", raw.get("explanation", raw.get("解析", raw.get("答案解析", ""))))).strip(),
        "chapter": raw.get("chapter", raw.get("chapterName", raw.get("section", raw.get("章节")))),
    }


def parse_questions_from_json_text(text: str) -> List[Dict]:
    """从 JSON 文本解析题目，兼容多种题库结构。"""
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"JSON 格式错误: {e.msg}")

    def _extract_from_list(items: Any) -> List[Dict]:
        if not isinstance(items, list):
            return []
        return [
            _normalize_question_item(item, idx + 1)
            for idx, item in enumerate(items)
            if isinstance(item, dict)
        ]

    # 1) 标准结构: {"questions": [...]}
    if isinstance(data, dict) and isinstance(data.get("questions"), list):
        return _extract_from_list(data["questions"])

    # 1.1) 常见变体: {"data": {"questions": [...]}} / {"items":[...]} / {"list":[...]}
    if isinstance(data, dict):
        for key in ["items", "list", "records", "problemList", "题目", "试题", "questionList", "dataList"]:
            if isinstance(data.get(key), list):
                return _extract_from_list(data[key])
        nested = data.get("data")
        if isinstance(nested, dict):
            for key in ["questions", "items", "list", "records", "problemList", "题目", "试题", "questionList", "dataList"]:
                if isinstance(nested.get(key), list):
                    return _extract_from_list(nested[key])
        if isinstance(nested, list):
            return _extract_from_list(nested)

    # 1.2) 章节数组: {"chapters":[{"name":"xx","questions":[...]}]}
    if isinstance(data, dict) and isinstance(data.get("chapters"), list):
        questions: List[Dict] = []
        qid = 1
        for chapter in data["chapters"]:
            if not isinstance(chapter, dict):
                continue
            chapter_name = chapter.get("name", chapter.get("chapter", ""))
            chapter_questions = chapter.get("questions", chapter.get("items", []))
            if not isinstance(chapter_questions, list):
                continue
            for item in chapter_questions:
                if not isinstance(item, dict):
                    continue
                norm = _normalize_question_item(item, qid)
                if chapter_name and not norm.get("chapter"):
                    norm["chapter"] = chapter_name
                questions.append(norm)
                qid += 1
        if questions:
            return questions

    # 2) 直接数组: [...]
    if isinstance(data, list):
        return _extract_from_list(data)

    # 3) 旧章节结构: {chapter: {type: [text, ...]}}
    def _is_legacy_chapter_shape(obj: Any) -> bool:
        if not isinstance(obj, dict) or not obj:
            return False
        for v in obj.values():
            if not isinstance(v, dict) or not v:
                return False
            if not all(isinstance(items, list) for items in v.values()):
                return False
        return True

    if isinstance(data, dict) and _is_legacy_chapter_shape(data):
        legacy_questions = parse_question_bank(data, "uploaded_json")
        return [
            _normalize_question_item(item, idx + 1)
            for idx, item in enumerate(legacy_questions)
            if isinstance(item, dict)
        ]

    # 4) 最后兜底：在字典中递归查找“看起来像题目列表”的数组
    def _looks_like_question(item: Any) -> bool:
        if not isinstance(item, dict):
            return False
        keys = set(item.keys())
        candidates = {
            "content", "question", "title", "stem", "text", "题目", "题干",
            "options", "choices", "optionList", "选项",
            "answer", "correctAnswer", "correct_answer", "答案"
        }
        return len(keys & candidates) >= 2

    def _find_question_list(node: Any) -> Optional[List[Dict]]:
        if isinstance(node, list) and node and all(isinstance(x, dict) for x in node):
            if sum(1 for x in node if _looks_like_question(x)) >= max(1, len(node) // 3):
                return _extract_from_list(node)
        if isinstance(node, dict):
            for v in node.values():
                found = _find_question_list(v)
                if found:
                    return found
        return None

    if isinstance(data, dict):
        found = _find_question_list(data)
        if found:
            return found

    raise HTTPException(status_code=400, detail="不支持的 JSON 题库结构，请提供 questions/items/list 或章节结构")


def parse_questions_from_text(text: str) -> List[Dict]:
    """从文本解析题目 - 支持超紧凑格式（多题选项混在同一行）"""
    questions = []
    full_text = text.replace('\r', '\n')

    def normalize_chapter_name(name: str) -> str:
        chapter = re.sub(r'\s+', ' ', name or "").strip()
        chapter = chapter.replace("＋", "+")
        return chapter

    # 识别章节标题（支持“绪论+第一章 ...”和“第二章 ...”等）
    chapter_pattern = re.compile(
        r'((?:绪论\s*\+\s*第[一二三四五六七八九十0-9]+章[^\n]{0,60})|(?:第[一二三四五六七八九十百0-9]+章[^\n]{0,60}))'
    )

    all_chapters = [normalize_chapter_name(m.group(1)) for m in chapter_pattern.finditer(full_text)]
    initial_chapter = next((c for c in all_chapters if "绪论" in c or "第一章" in c), "")

    chapter_to_id: Dict[str, str] = {}
    next_chapter_no = 1

    def get_chapter_id(chapter_name: str) -> str:
        nonlocal next_chapter_no
        name = normalize_chapter_name(chapter_name)
        if not name:
            return "ch01"
        if name not in chapter_to_id:
            chapter_to_id[name] = f"ch{next_chapter_no:02d}"
            next_chapter_no += 1
        return chapter_to_id[name]
    
    # 第一步：预处理文本，在题号前添加换行（方便分割）
    # 将 "...D、xxx 2、" 替换为 "...D、xxx\n2、"
    processed_text = re.sub(r'(?<=[A-Fa-f、.．\s])(\d+)([、.．])', r'\n\1\2', full_text)
    
    # 第二步：按题号分割
    raw_blocks = re.split(r'\n(?=\d+[、.．])', processed_text)
    
    qid = 1
    current_chapter = initial_chapter
    for block in raw_blocks:
        block = block.strip()
        if not block:
            continue
        
        # 提取题号
        match = re.match(r'^(\d+)[、.．]\s*(.+)', block, re.DOTALL)
        if not match:
            continue
        
        content = match.group(2).strip()

        # 识别并剥离题干中夹带的章节标题（常见于 PDF/Word 提取）
        inline_chapter = None
        apply_to_current = False
        chapter_match = re.search(r'\n\s*' + chapter_pattern.pattern, content)
        if chapter_match:
            inline_chapter = normalize_chapter_name(chapter_match.group(1))
            content = content[:chapter_match.start()].strip()
        else:
            # 章节标题单独落在题干开头的场景
            start_match = re.match(r'^\s*' + chapter_pattern.pattern + r'\s*[\n]+', content)
            if start_match:
                inline_chapter = normalize_chapter_name(start_match.group(1))
                content = content[start_match.end():].strip()
                apply_to_current = True

        if inline_chapter and apply_to_current:
            current_chapter = inline_chapter
        
        # 初始化题目
        question = {
            "id": f"q{qid:04d}",
            "number": str(qid),
            "type": "single",
            "content": "",
            "options": [],
            "answer": "",
            "analysis": "",
            "chapter": current_chapter or "默认章节",
            "chapter_id": get_chapter_id(current_chapter or "默认章节"),
        }
        
        # 分离答案（在行尾或独立一行）
        answer_patterns = [
            r'答案\s*[：:]\s*([A-Fa-f]+|[对错]|正确|错误)',
        ]
        for pattern in answer_patterns:
            answer_match = re.search(pattern, content)
            if answer_match:
                answer = answer_match.group(1).strip()
                question["answer"] = answer.upper() if len(answer) <= 4 else answer
                # 从内容中移除答案部分
                content = content[:answer_match.start()] + content[answer_match.end():]
                content = content.strip()
                
                if answer in ["对", "错", "正确", "错误", "√", "×"]:
                    question["type"] = "judge"
                elif len(answer) > 1 and all(c.upper() in 'ABCDEF' for c in answer):
                    question["type"] = "multi"
                break
        
        # 分离解析
        analysis_match = re.search(r'解析\s*[：:]\s*(.+?)(?=\n\s*\d+[、.．]|\Z)', content, re.DOTALL)
        if analysis_match:
            question["analysis"] = analysis_match.group(1).strip()
            content = content[:analysis_match.start()] + content[analysis_match.end():]
            content = content.strip()
        
        # 提取选项 - 这是关键部分
        # 使用更精确的模式匹配选项
        # 匹配 A、xxx 或 A. xxx 或 A xxx 格式，直到下一个选项或行尾
        options = []
        
        # 方法1：尝试找到所有 A/B/C/D 开头的选项
        # 使用更严格的模式，确保捕获完整选项
        opt_pattern = r'([A-F])[、.．\s]+([^A-F\n]+?)(?=(?:[A-F][、.．\s]|\n|$))'
        opt_matches = list(re.finditer(opt_pattern, content, re.MULTILINE))
        
        if len(opt_matches) >= 2:
            # 找到第一个选项的位置
            first_opt_pos = opt_matches[0].start()
            question["content"] = content[:first_opt_pos].strip()
            
            for opt_match in opt_matches:
                opt_letter = opt_match.group(1)
                opt_text = opt_match.group(2).strip()
                # 清理选项文本
                opt_text = re.sub(r'\s+', ' ', opt_text)
                # 移除可能的下一题内容（如果选项文本包含数字+顿号）
                opt_text = re.sub(r'\d+[、.．].*$', '', opt_text).strip()
                options.append(opt_text)
        
        # 方法2：如果没找到足够选项，尝试按单个字母分割
        if len(options) < 2:
            # 按 A、B、C、D 分割
            parts = re.split(r'(?=[A-F])[、.．\s]*', content)
            if len(parts) > 1:
                question["content"] = parts[0].strip()
                for i, part in enumerate(parts[1:]):
                    if part.strip():
                        # 移除选项字母
                        opt_text = re.sub(r'^[A-F]\s*', '', part).strip()
                        opt_text = re.sub(r'\d+[、.．].*$', '', opt_text).strip()
                        if opt_text:
                            options.append(opt_text)
        
        question["options"] = options
        
        # 如果仍然没有选项，可能是判断题或格式错误
        if not options and not question["type"] == "judge":
            question["content"] = content.strip()
        
        questions.append(question)
        qid += 1

        # 章节标题落在题目末尾时，从下一题开始生效
        if inline_chapter and not apply_to_current:
            current_chapter = inline_chapter
    
    return questions
    
    return questions


@app.post("/api/extract/analyze")
async def generate_analysis(request: AnalyzeRequest):
    """使用 LLM 生成解析 - 高并发版本"""
    questions = request.questions
    config = request.config
    
    # 检查 LLMService 是否可用
    if LLMService is None or LLMConfig is None:
        for q in questions:
            if not q.get("analysis"):
                q["analysis"] = generate_mock_analysis(q)
        return {"questions": questions}
    
    try:
        # 支持多 API 并发（多 provider / 多 key）
        results = await _run_analysis_with_config(questions, config)
        return {"questions": results}
    
    except Exception as e:
        print(f"LLM 调用失败: {e}")
        import traceback
        traceback.print_exc()
        # 返回模拟数据作为备用
        for q in questions:
            if not q.get("analysis"):
                q["analysis"] = generate_mock_analysis(q)
        return {"questions": questions}


def generate_mock_analysis(q: Dict) -> str:
    """生成模拟解析（备用）"""
    type_names = {
        "single": "单选题",
        "multi": "多选题",
        "judge": "判断题"
    }
    
    templates = [
        f"本题考查相关知识点的理解。正确答案是 {q.get('answer', 'N/A')}。",
        f"这是一道{type_names.get(q['type'], '选择')}题，需要掌握基础概念。答案为 {q.get('answer', 'N/A')}。",
        f"解析：根据教材内容，本题正确答案为 {q.get('answer', 'N/A')}。",
    ]
    
    import random
    return random.choice(templates)


# ============== WebSocket 实时进度 ==============

def _split_api_entries(raw: str) -> List[str]:
    """支持逗号/分号/换行分隔多个条目"""
    if not raw:
        return []
    parts = re.split(r"[,\n;]+", raw)
    return [p.strip() for p in parts if p.strip()]


def _build_config_cache_key(config: AnalysisConfig) -> str:
    payload = {
        "provider": config.provider,
        "apiKey": config.apiKey,
        "apiUrl": config.apiUrl,
        "model": config.model,
        "apiConfigs": config.apiConfigs or [],
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _parse_entry_with_fallback(entry: str, fallback: AnalysisConfig) -> "LLMConfig":
    """
    支持以下格式：
    1) 纯 Key: sk-xxx
    2) provider:key: deepseek:sk-xxx
    3) provider|key|apiUrl|model: openai|sk-xxx|https://.../v1|gpt-4o-mini
    """
    provider = fallback.provider
    api_url = fallback.apiUrl
    model = fallback.model
    api_key = entry

    if "|" in entry:
        parts = [p.strip() for p in entry.split("|")]
        if len(parts) >= 2:
            provider = parts[0] or provider
            api_key = parts[1]
        if len(parts) >= 3 and parts[2]:
            api_url = parts[2]
        if len(parts) >= 4 and parts[3]:
            model = parts[3]
    elif ":" in entry and len(entry.split(":", 1)[0]) <= 20:
        maybe_provider, maybe_key = entry.split(":", 1)
        if maybe_provider in {"openai", "deepseek", "siliconflow"} and maybe_key.strip():
            provider = maybe_provider
            api_key = maybe_key.strip()

    return LLMConfig(
        provider=provider,
        api_keys=[api_key],
        base_url=api_url,
        model=model,
        max_concurrent=5,
        timeout=30.0,
        max_retries=2
    )


def _normalize_llm_configs(config: AnalysisConfig) -> List["LLMConfig"]:
    """将前端配置归一化为多个 LLMConfig，并做缓存。"""
    cache_key = _build_config_cache_key(config)
    now = time.time()
    cached = API_CONFIG_CACHE.get(cache_key)
    if cached and now - cached[0] < API_CONFIG_CACHE_TTL:
        return cached[1]

    normalized: List["LLMConfig"] = []

    if config.apiConfigs:
        for item in config.apiConfigs:
            api_key = str(item.get("apiKey", "")).strip()
            if not api_key:
                continue
            normalized.append(
                LLMConfig(
                    provider=str(item.get("provider", config.provider or "deepseek")),
                    api_keys=[api_key],
                    base_url=item.get("apiUrl") or config.apiUrl,
                    model=item.get("model") or config.model,
                    max_concurrent=5,
                    timeout=30.0,
                    max_retries=2
                )
            )
    else:
        entries = _split_api_entries(config.apiKey)
        if not entries:
            raise ValueError("API Key 不能为空")

        plain_keys = [e for e in entries if "|" not in e and ":" not in e]
        if plain_keys and len(plain_keys) == len(entries):
            normalized.append(
                LLMConfig(
                    provider=config.provider,
                    api_keys=plain_keys,
                    base_url=config.apiUrl,
                    model=config.model,
                    max_concurrent=5,
                    timeout=30.0,
                    max_retries=2
                )
            )
        else:
            for entry in entries:
                normalized.append(_parse_entry_with_fallback(entry, config))

    if not normalized:
        raise ValueError("未解析到有效的 API 配置")

    expired = [k for k, (ts, _) in API_CONFIG_CACHE.items() if now - ts >= API_CONFIG_CACHE_TTL]
    for k in expired:
        API_CONFIG_CACHE.pop(k, None)
    API_CONFIG_CACHE[cache_key] = (now, normalized)
    return normalized


async def _run_analysis_with_config(
    questions: List[Dict],
    config: AnalysisConfig,
    progress_callback=None
) -> List[Dict]:
    configs = _normalize_llm_configs(config)

    if len(configs) == 1:
        provider = LLMService.create(configs[0])
        try:
            return await LLMService.generate_analysis_batch(
                provider,
                questions,
                progress_callback=progress_callback
            )
        finally:
            await LLMService.close_provider(provider)

    return await LLMService.generate_analysis_with_multi_keys(
        configs,
        questions,
        progress_callback=progress_callback
    )

class WebSocketProgressConfig(BaseModel):
    provider: str = "deepseek"
    apiKey: str = ""
    apiUrl: Optional[str] = None
    model: Optional[str] = None
    apiConfigs: Optional[List[Dict[str, Any]]] = None


@app.websocket("/ws/analyze/{client_id}")
async def websocket_analyze(websocket: WebSocket, client_id: str):
    """WebSocket 实时解析进度"""
    await manager.connect(client_id, websocket)
    
    try:
        # 等待前端发送题目和配置
        data = await websocket.receive_json()
        questions = data.get("questions", [])
        config_data = data.get("config", {})
        
        if not questions:
            await manager.send_error(client_id, "没有题目需要解析")
            return
        
        # 检查 LLMService
        if LLMService is None or LLMConfig is None:
            # 使用模拟数据
            for i, q in enumerate(questions):
                if not q.get("analysis"):
                    q["analysis"] = generate_mock_analysis(q)
                await manager.send_progress(client_id, i + 1, len(questions), f"正在解析题目 {i+1}")
                await asyncio.sleep(0.1)  # 模拟延迟
            
            await manager.send_complete(client_id, questions)
            return
        
        try:
            config = AnalysisConfig(
                provider=config_data.get("provider", "deepseek"),
                apiKey=config_data.get("apiKey", ""),
                apiUrl=config_data.get("apiUrl"),
                model=config_data.get("model"),
                apiConfigs=config_data.get("apiConfigs")
            )
            
            # 创建进度回调
            async def progress_callback(current: int, total: int):
                await manager.send_progress(
                    client_id, 
                    current, 
                    total, 
                    f"已完成 {current}/{total} 道题目"
                )
            
            # 批量生成解析（支持多 API 异步）
            results = await _run_analysis_with_config(
                questions,
                config,
                progress_callback=progress_callback
            )
            
            await manager.send_complete(client_id, results)
            
        except Exception as e:
            print(f"WebSocket 解析失败: {e}")
            import traceback
            traceback.print_exc()
            
            # 返回模拟数据
            for q in questions:
                if not q.get("analysis"):
                    q["analysis"] = generate_mock_analysis(q)
            await manager.send_complete(client_id, questions)
    
    except WebSocketDisconnect:
        manager.disconnect(client_id)
    except Exception as e:
        await manager.send_error(client_id, str(e))
        manager.disconnect(client_id)


@app.post("/api/extract/export")
async def export_bank(request: ExportRequest):
    """导出标准 JSON 题库"""
    safe_name = re.sub(r"[^\w\u4e00-\u9fff-]+", "_", request.name).strip("_") or "question_bank"
    output_file = f"{safe_name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    output_path = os.path.join(EXPORT_DIR, output_file)
    os.makedirs(EXPORT_DIR, exist_ok=True)

    bank_data = build_standard_bank_data(request.name, request.questions)

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(bank_data, f, ensure_ascii=False, indent=2)

    return {"download_url": f"/api/download/{output_file}"}


@app.post("/api/banks/save")
async def save_bank(request: SaveBankRequest):
    """保存题库到 tiku 目录并刷新题库列表"""
    bank_name = request.name.strip() or "未命名题库"
    bank_key = sanitize_bank_key(request.key or bank_name)
    output_path = os.path.join(TIKU_DIR, f"{bank_key}.json")

    if os.path.exists(output_path) and not request.overwrite:
        raise HTTPException(status_code=409, detail="题库代号已存在，请修改代号或启用覆盖保存")

    os.makedirs(TIKU_DIR, exist_ok=True)
    bank_data = build_standard_bank_data(bank_name, request.questions, request.color)

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(bank_data, f, ensure_ascii=False, indent=2)

    load_question_banks()

    if bank_key not in QUESTION_BANKS:
        raise HTTPException(status_code=500, detail="题库保存成功，但刷新列表失败")

    return {
        "message": "题库已保存",
        "bank": build_bank_summary(bank_key, QUESTION_BANKS[bank_key]),
        "file": os.path.relpath(output_path, BASE_DIR),
    }


@app.get("/api/download/{filename}")
async def download_file(filename: str):
    """下载文件"""
    safe_filename = os.path.basename(filename)
    file_path = os.path.join(EXPORT_DIR, safe_filename)
    if os.path.exists(file_path):
        return FileResponse(file_path, filename=safe_filename)
    raise HTTPException(status_code=404, detail="文件不存在")


@app.get("/api/stats/global")
async def get_global_stats(bank: str):
    """获取题库统计"""
    if bank not in QUESTION_BANKS:
        raise HTTPException(status_code=404, detail="题库不存在")
    
    bank_data = QUESTION_BANKS[bank]["data"]
    questions = parse_question_bank(bank_data, bank)
    
    stats = {
        "total": len(questions),
        "by_type": defaultdict(int),
        "by_chapter": defaultdict(int),
        "by_difficulty": {"easy": 0, "medium": 0, "hard": 0}
    }
    
    for q in questions:
        stats["by_type"][q["type"]] += 1
        stats["by_chapter"][q.get("chapter", "未知")] += 1
        
        rate = q.get("stats", {}).get("rate", 0)
        if rate >= 70:
            stats["by_difficulty"]["easy"] += 1
        elif rate >= 50:
            stats["by_difficulty"]["medium"] += 1
        else:
            stats["by_difficulty"]["hard"] += 1
    
    return {"stats": stats}


# ============== 主入口 ==============

if __name__ == "__main__":
    import uvicorn
    host = (os.getenv("APP_HOST") or "0.0.0.0").strip() or "0.0.0.0"
    raw_port = (os.getenv("APP_PORT") or os.getenv("PORT") or "10086").strip()
    try:
        port = int(raw_port)
    except ValueError:
        port = 10086

    print("🚀 启动刷题系统后端...")
    print(f"📚 API 文档: http://127.0.0.1:{port}/docs")
    uvicorn.run(app, host=host, port=port)
