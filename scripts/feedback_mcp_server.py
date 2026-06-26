#!/usr/bin/env python3
"""MCP service for quiz feedback query and submission."""

from __future__ import annotations

import json
from contextlib import suppress
from datetime import datetime
from pathlib import Path
from typing import Any, Optional
import os
import traceback

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
import uvicorn

PROJECT_ROOT = Path(__file__).resolve().parents[1]
FEEDBACK_FILE = os.getenv("FEEDBACK_FILE", str(PROJECT_ROOT / "feedbacks.json"))


def _coerce_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value)


def _coerce_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _parse_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        raise ValueError(f"invalid datetime: {value!r}, expected ISO 8601 format")


def _serialize_timestamp(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, str):
        return value
    return str(value)


def _db_enabled() -> bool:
    with suppress(Exception):
        import db_storage

        if db_storage.is_available():
            return True
    return False


def _load_feedback_from_db(
    bank: Optional[str] = None,
    question_index: Optional[int] = None,
    question_id: Optional[str] = None,
    source_page: Optional[str] = None,
    user_id: Optional[str] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    min_id: Optional[int] = None,
    max_id: Optional[int] = None,
    limit: Optional[int] = None,
) -> list[dict[str, Any]]:
    import db_storage

    clauses: list[str] = []
    params: list[Any] = []

    if bank:
        clauses.append("f.question_bank = %s")
        params.append(str(bank).strip())
    if question_index:
        clauses.append("f.question_index = %s")
        params.append(int(question_index))
    if question_id:
        clauses.append("f.question_id = %s")
        params.append(str(question_id).strip())
    if source_page:
        clauses.append("COALESCE(f.source_page, 'quiz') = %s")
        params.append(str(source_page).strip())
    if user_id:
        clauses.append("f.user_id = %s")
        params.append(str(user_id).strip())

    parsed_start = _parse_datetime(start_time)
    parsed_end = _parse_datetime(end_time)
    if parsed_start is not None:
        clauses.append("f.created_at >= %s")
        params.append(parsed_start)
    if parsed_end is not None:
        clauses.append("f.created_at <= %s")
        params.append(parsed_end)
    if min_id is not None:
        clauses.append("f.feedback_id >= %s")
        params.append(int(min_id))
    if max_id is not None:
        clauses.append("f.feedback_id <= %s")
        params.append(int(max_id))

    where_sql = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    limit_sql = f" LIMIT {int(limit)}" if limit else ""
    sql = f"""
        SELECT
            f.feedback_id,
            f.question_index,
            f.question_id,
            f.question_content,
            f.question_bank,
            f.suggestion,
            f.user_id,
            COALESCE(u.display_name, '') AS user_name,
            COALESCE(f.source_page, 'quiz') AS source_page,
            f.created_at
        FROM feedbacks f
        LEFT JOIN users u ON u.user_id = f.user_id
        {where_sql}
        ORDER BY f.feedback_id DESC
        {limit_sql}
    """

    records: list[dict[str, Any]] = []
    with db_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()

    for row in rows:
        if not row:
            continue
        (
            feedback_id,
            question_index_value,
            question_id_value,
            question_content_value,
            question_bank_value,
            suggestion_value,
            user_id_value,
            user_name_value,
            source_page_value,
            created_at_value,
        ) = row

        records.append(
            {
                "feedback_id": _coerce_int(feedback_id),
                "question_index": _coerce_int(question_index_value),
                "question_id": _coerce_str(question_id_value) or None,
                "question_content": _coerce_str(question_content_value) or None,
                "question_bank": _coerce_str(question_bank_value) or None,
                "suggestion": _coerce_str(suggestion_value),
                "user_id": _coerce_str(user_id_value) or None,
                "user_name": _coerce_str(user_name_value) or None,
                "source_page": _coerce_str(source_page_value) or "quiz",
                "created_at": _serialize_timestamp(created_at_value),
            }
        )
    return records


def _load_feedback_from_file(
    bank: Optional[str] = None,
    question_index: Optional[int] = None,
    question_id: Optional[str] = None,
    source_page: Optional[str] = None,
    user_id: Optional[str] = None,
    min_id: Optional[int] = None,
    max_id: Optional[int] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    limit: Optional[int] = None,
) -> list[dict[str, Any]]:
    path = Path(FEEDBACK_FILE)
    if not path.exists():
        return []

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if not isinstance(raw, list):
        return []

    parsed_start = _parse_datetime(start_time)
    parsed_end = _parse_datetime(end_time)

    records: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        fid = _coerce_int(item.get("feedback_id"))
        qidx = _coerce_int(item.get("question_index"))
        created = item.get("created_at")
        created_time = None
        with suppress(Exception):
            if isinstance(created, str):
                created_time = _parse_datetime(created)
        if parsed_start is not None and created_time is not None and created_time < parsed_start:
            continue
        if parsed_end is not None and created_time is not None and created_time > parsed_end:
            continue
        if bank and str(item.get("question_bank") or "") != str(bank):
            continue
        if question_index and qidx != question_index:
            continue
        if question_id and str(item.get("question_id") or "") != str(question_id):
            continue
        if source_page and str(item.get("source_page") or "quiz") != str(source_page):
            continue
        if user_id and str(item.get("user_id") or "") != str(user_id):
            continue
        if min_id is not None and fid < int(min_id):
            continue
        if max_id is not None and fid > int(max_id):
            continue

        records.append(
            {
                "feedback_id": fid,
                "question_index": qidx,
                "question_id": _coerce_str(item.get("question_id")) or None,
                "question_content": _coerce_str(item.get("question_content")) or None,
                "question_bank": _coerce_str(item.get("question_bank")) or None,
                "suggestion": _coerce_str(item.get("suggestion")),
                "user_id": _coerce_str(item.get("user_id")) or None,
                "user_name": "",
                "source_page": _coerce_str(item.get("source_page") or "quiz") or "quiz",
                "created_at": _coerce_str(item.get("created_at")),
            }
        )

    records.sort(key=lambda item: item.get("feedback_id", 0), reverse=True)
    if limit and limit > 0:
        return records[: int(limit)]
    return records


def _save_feedback_to_file(
    question_index: int,
    suggestion: str,
    question_bank: Optional[str],
    question_id: Optional[str],
    question_content: Optional[str],
    user_id: Optional[str],
    source_page: str = "quiz",
) -> dict[str, Any]:
    path = Path(FEEDBACK_FILE)
    payload: list[dict[str, Any]] = []
    if path.exists():
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(raw, list):
                payload = [x for x in raw if isinstance(x, dict)]
        except (OSError, json.JSONDecodeError):
            payload = []

    next_id = 1
    if payload:
        tail = payload[-1].get("feedback_id")
        try:
            next_id = int(tail) + 1
        except (TypeError, ValueError):
            next_id = 1

    now = datetime.now().isoformat()
    normalized_suggestion = (suggestion or "").strip()
    if len(normalized_suggestion) > 2000:
        raise ValueError("suggestion is too long")

    record = {
        "feedback_id": next_id,
        "question_index": int(question_index),
        "question_id": (question_id or "").strip() or None,
        "question_content": (question_content or "").strip() or None,
        "question_bank": (question_bank or "").strip() or None,
        "suggestion": normalized_suggestion,
        "user_id": (user_id or "").strip() or None,
        "source_page": (source_page or "quiz").strip() or "quiz",
        "created_at": now,
    }
    payload.append(record)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return record


def _build_tool_server():
    host = os.getenv("MCP_HOST", "127.0.0.1").strip() or "127.0.0.1"
    port = os.getenv("MCP_PORT", "10088").strip() or "10088"
    transport = os.getenv("MCP_TRANSPORT", "streamable-http").strip().lower()
    host_port = int(port)

    mcp = FastMCP(
        "quizcraft-feedback",
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
    )

    @mcp.tool()
    def list_feedback(
        bank: Optional[str] = None,
        question_index: Optional[int] = None,
        question_id: Optional[str] = None,
        source_page: Optional[str] = None,
        user_id: Optional[str] = None,
        min_id: Optional[int] = None,
        max_id: Optional[int] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        limit: int = 200,
    ) -> dict[str, Any]:
        normalized_limit = int(limit) if limit else 0
        if normalized_limit < 0:
            normalized_limit = 0
        if normalized_limit > 5000:
            normalized_limit = 5000

        use_db = _db_enabled()
        try:
            if use_db:
                items = _load_feedback_from_db(
                    bank=bank,
                    question_index=question_index,
                    question_id=question_id,
                    source_page=source_page,
                    user_id=user_id,
                    min_id=min_id,
                    max_id=max_id,
                    start_time=start_time,
                    end_time=end_time,
                    limit=normalized_limit or None,
                )
            else:
                items = _load_feedback_from_file(
                    bank=bank,
                    question_index=question_index,
                    question_id=question_id,
                    source_page=source_page,
                    user_id=user_id,
                    min_id=min_id,
                    max_id=max_id,
                    start_time=start_time,
                    end_time=end_time,
                    limit=normalized_limit or None,
                )
        except Exception as exc:
            if use_db:
                raise RuntimeError(f"query db failed: {exc}")
            raise

        return {
            "count": len(items),
            "items": items,
        }

    @mcp.tool()
    def get_feedback(feedback_id: int) -> dict[str, Any]:
        item_id = int(feedback_id)
        item_list = list_feedback(min_id=item_id, max_id=item_id, limit=1)["items"]
        if not item_list:
            return {"found": False, "item": None}
        return {"found": True, "item": item_list[0]}

    @mcp.tool()
    def submit_feedback(
        question_index: int,
        suggestion: str,
        question_bank: Optional[str] = None,
        question_id: Optional[str] = None,
        question_content: Optional[str] = None,
        user_id: Optional[str] = None,
        source_page: str = "quiz",
    ) -> dict[str, Any]:
        normalized = (suggestion or "").strip()
        if question_index <= 0:
            raise ValueError("question_index must be greater than 0")
        if not normalized:
            raise ValueError("suggestion cannot be empty")
        if len(normalized) > 2000:
            raise ValueError("suggestion is too long")

        normalized_source = (source_page or "quiz").strip() or "quiz"
        if _db_enabled():
            import db_storage

            result = db_storage.create_feedback(
                question_index=question_index,
                suggestion=normalized,
                question_bank=(question_bank or "").strip() or None,
                question_id=(question_id or "").strip() or None,
                question_content=(question_content or "").strip() or None,
                source_page=normalized_source,
                user_id=(user_id or "").strip() or None,
            )
            return {
                "ok": True,
                "feedback_id": result["feedback_id"],
                "question_index": result["question_index"],
                "created_at": result["created_at"],
            }

        record = _save_feedback_to_file(
            question_index=question_index,
            suggestion=normalized,
            question_bank=(question_bank or "").strip() or None,
            question_id=(question_id or "").strip() or None,
            question_content=(question_content or "").strip() or None,
            user_id=(user_id or "").strip() or None,
            source_page=normalized_source,
        )
        return {
            "ok": True,
            "feedback_id": record["feedback_id"],
            "question_index": record["question_index"],
            "created_at": record["created_at"],
        }

    mcp_app = mcp.streamable_http_app()
    if transport != "streamable-http":
        raise RuntimeError(f"unsupported MCP_TRANSPORT={transport}, only streamable-http is supported")

    api_key = os.getenv("MCP_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("MCP_API_KEY is required")

    class MCPAuthMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next):
            if request.url.path.startswith("/mcp"):
                token = request.headers.get("X-API-Key", "")
                if token != api_key:
                    return JSONResponse({"error": "unauthorized"}, status_code=401)
            return await call_next(request)

    mcp_app.add_middleware(MCPAuthMiddleware)

    async def healthz(_request: Request) -> JSONResponse:
        return JSONResponse({"ok": True})

    mcp_app.router.routes.append(Route("/healthz", healthz))

    return mcp_app, host, host_port


def main() -> int:
    try:
        app, host, port = _build_tool_server()
        uvicorn.run(
            app,
            host=host,
            port=port,
            log_level="info",
        )
        return 0
    except Exception as exc:
        print(f"[fatal] {exc}")
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
