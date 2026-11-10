#!/usr/bin/env python3
"""Vercel WSGI entrypoint for WeatherMood's API and static frontend."""

from __future__ import annotations

import io
import json
import logging
import os
from email.message import Message
from http import HTTPStatus

from flask import Flask, Response, request as flask_request

from server import (
    AIError,
    OAuthError,
    RequestHandler,
    WeatherMoodServer,
    configure_server,
)


_server = WeatherMoodServer.__new__(WeatherMoodServer)
configure_server(_server, ("127.0.0.1", int(os.environ.get("PORT", "8000"))))
app = Flask(__name__, static_folder=None)


class WSGIRequest(RequestHandler):
    def __init__(self, environ: dict, body: bytes) -> None:
        self.server = _server
        self.command = environ.get("REQUEST_METHOD", "GET").upper()
        self.path = environ.get("PATH_INFO", "/")
        query = environ.get("QUERY_STRING", "")
        if query:
            self.path += f"?{query}"
        self.headers = Message()
        for key, value in environ.items():
            if key.startswith("HTTP_"):
                name = key[5:].replace("_", "-").title()
                self.headers[name] = value
        content_type = environ.get("CONTENT_TYPE")
        if content_type:
            self.headers["Content-Type"] = content_type
        content_length = environ.get("CONTENT_LENGTH")
        if content_length:
            self.headers["Content-Length"] = content_length
        self.rfile = io.BytesIO(body)
        self.wfile = io.BytesIO()
        self.response_status = HTTPStatus.OK
        self.response_headers: list[tuple[str, str]] = []

    def send_response(self, code: int, message: str | None = None) -> None:
        self.response_status = HTTPStatus(code)

    def send_header(self, keyword: str, value: str) -> None:
        self.response_headers.append((keyword, value))

    def end_headers(self) -> None:
        return


def _read_body(environ: dict) -> bytes:
    try:
        length = int(environ.get("CONTENT_LENGTH") or 0)
    except ValueError:
        raise OAuthError("Некорректный размер запроса.") from None
    max_length = 65536 if environ.get("PATH_INFO") == "/api/ai/playlist" else 8192
    if length < 0 or length > max_length:
        raise OAuthError("Слишком большой запрос.")
    stream = environ.get("wsgi.input")
    return stream.read(length) if length else b""


@app.route("/", defaults={"path": ""}, methods=["GET", "POST"])
@app.route("/<path:path>", methods=["GET", "POST"])
def dispatch(path: str):
    del path
    environ = flask_request.environ
    request = WSGIRequest(environ, b"")
    try:
        body = _read_body(environ) if request.command == "POST" else b""
        request.rfile = io.BytesIO(body)
        if request.command == "GET":
            request.do_GET()
        elif request.command == "POST":
            request.do_POST()
        else:
            request._send_json(405, {"error": "Метод не поддерживается."})
    except (OAuthError, AIError) as error:
        request._send_json(
            400 if isinstance(error, OAuthError) else 502,
            {"error": str(error)},
        )
    except RuntimeError as error:
        request._send_json(503, {"error": str(error)})
    except Exception:
        logging.exception("WeatherMood request failed")
        request._send_json(500, {"error": "Внутренняя ошибка сервера. Попробуйте позже."})

    response_body = request.wfile.getvalue()
    if not any(name.lower() == "content-length" for name, _ in request.response_headers):
        request.response_headers.append(("Content-Length", str(len(response_body))))
    status_text = (
        f"{request.response_status.value} {request.response_status.phrase}"
    )
    return Response(
        response_body,
        status=status_text,
        headers=request.response_headers,
    )
