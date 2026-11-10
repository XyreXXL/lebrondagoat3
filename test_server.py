import http.client
import io
import json
import os
import threading
import unittest
import secrets
import urllib.parse
from types import SimpleNamespace
from unittest.mock import patch

from server import (
    AI_DEFAULT_MODEL,
    AI_DEFAULT_URL,
    COOKIE_NAME,
    SESSIONS,
    RequestHandler,
    SessionStore,
    WeatherMoodServer,
    AIError,
    request_ai_playlist,
    _spotify_api,
    make_session_cookie,
    read_session_cookie,
)


class OAuthSessionTests(unittest.TestCase):
    def test_gemini_api_key_environment_name_is_supported(self):
        with patch.dict(
            os.environ,
            {
                "AI_API_KEY": "",
                "GEMINI_API_KEY": "gemini-test-key",
                "AI_MODEL": "gemini-2.5-flash",
                "AI_API_URL": (
                    "https://generativelanguage.googleapis.com/v1beta/openai/"
                    "chat/completions"
                ),
            },
            clear=True,
        ):
            server = WeatherMoodServer(("127.0.0.1", 0))
            try:
                self.assertEqual(server.ai_api_key, "gemini-test-key")
                self.assertEqual(server.ai_model, "gemini-2.5-flash")
                self.assertTrue(server.ai_configured)
            finally:
                server.server_close()

    def test_redis_session_store_uses_expiring_server_side_records(self):
        class FakeResponse:
            def __init__(self, result):
                self.body = json.dumps({"result": result}).encode()

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return None

            def read(self, _limit):
                return self.body

        with patch.dict(
            os.environ,
            {
                "UPSTASH_REDIS_REST_URL": "https://redis.example.test",
                "UPSTASH_REDIS_REST_TOKEN": "redis-test-token",
            },
        ), patch(
            "server.urllib.request.urlopen",
            side_effect=[
                FakeResponse("OK"),
                FakeResponse(json.dumps({"expires_at": 9999999999})),
                FakeResponse("OK"),
            ],
        ) as urlopen:
            session = SessionStore()
            created = session.create("test-session")
            self.assertIn("expires_at", created)
            session.update("test-session", {"oauth_state": "state"})
        commands = [
            json.loads(call.args[0].data.decode("utf-8"))
            for call in urlopen.call_args_list
        ]
        self.assertEqual(len(commands), 3)
        self.assertEqual(commands[0][0], "SET")
        self.assertEqual(commands[0][3], "EX")
        self.assertEqual(commands[1][0], "GET")
        self.assertEqual(commands[2][0], "SET")
        self.assertIn('"oauth_state": "state"', commands[2][2])

    def test_redis_sessions_are_isolated_and_disconnect_deletes_only_owner_session(self):
        stored = {}

        class FakeResponse:
            def __init__(self, result):
                self.body = json.dumps({"result": result}).encode()

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return None

            def read(self, _limit):
                return self.body

        def fake_urlopen(request, timeout):
            command = json.loads(request.data.decode())
            operation, key, *arguments = command
            if operation == "GET":
                return FakeResponse(stored.get(key))
            if operation == "SET":
                stored[key] = arguments[0]
                return FakeResponse("OK")
            if operation == "DEL":
                stored.pop(key, None)
                return FakeResponse(1)
            raise AssertionError(f"Unexpected Redis command: {operation}")

        with patch.dict(
            os.environ,
            {
                "UPSTASH_REDIS_REST_URL": "https://redis.example.test",
                "UPSTASH_REDIS_REST_TOKEN": "redis-test-token",
            },
        ), patch("server.urllib.request.urlopen", side_effect=fake_urlopen):
            sessions = SessionStore()
            sessions.create("user-a")
            sessions.create("user-b")
            sessions.update("user-a", {"tokens": {"access_token": "private-a"}})
            sessions.update("user-b", {"tokens": {"access_token": "private-b"}})
            self.assertEqual(
                sessions.get("user-a")["tokens"]["access_token"], "private-a"
            )
            self.assertEqual(
                sessions.get("user-b")["tokens"]["access_token"], "private-b"
            )
            sessions.delete("user-a")
            self.assertIsNone(sessions.get("user-a"))
            self.assertEqual(
                sessions.get("user-b")["tokens"]["access_token"], "private-b"
            )

    def test_production_missing_secrets_disables_oauth_without_breaking_server_start(self):
        with patch.dict(
            os.environ,
            {
                "APP_ENV": "production",
                "SPOTIFY_CLIENT_ID": "",
                "SPOTIFY_CLIENT_SECRET": "",
                "SPOTIFY_REDIRECT_URI": "https://weather.example.test/api/spotify/callback",
                "WEATHERMOOD_SESSION_SECRET": "",
                "SPOTIFY_COOKIE_SECURE": "",
                "UPSTASH_REDIS_REST_URL": "",
                "UPSTASH_REDIS_REST_TOKEN": "",
                "KV_REST_API_URL": "",
                "KV_REST_API_TOKEN": "",
            },
            clear=True,
        ):
            server = WeatherMoodServer(("127.0.0.1", 0))
            try:
                self.assertFalse(server.spotify_configured)
                self.assertFalse(server.session_store_available)
                self.assertTrue(server.cookie_secure)
                self.assertIn("WEATHERMOOD_SESSION_SECRET", server.spotify_configuration_error)
                self.assertIn("Upstash Redis", server.spotify_configuration_error)
            finally:
                server.server_close()

    def test_spotify_track_keeps_only_safe_album_artwork_urls(self):
        track = RequestHandler._safe_track(
            {
                "name": "Song",
                "artists": [{"name": "Artist"}],
                "album": {
                    "name": "Album",
                    "images": [
                        {"url": "https://i.scdn.co/image/cover", "width": 300, "height": 300},
                        {"url": "http://example.test/unsafe", "width": 100, "height": 100},
                    ],
                },
            }
        )
        self.assertEqual(track["album"]["name"], "Album")
        self.assertEqual(
            track["album"]["images"],
            [{"url": "https://i.scdn.co/image/cover", "width": 300, "height": 300}],
        )

    def test_signed_cookie_rejects_tampering(self):
        secret = b"test session signing secret"
        cookie = make_session_cookie("session-id", secret)
        self.assertEqual(read_session_cookie(cookie, secret), "session-id")
        self.assertIsNone(read_session_cookie(cookie + "x", secret))
        self.assertIsNone(read_session_cookie(cookie, b"different key"))

    def test_ai_ranks_only_real_candidates_and_receives_structured_context(self):
        response_body = json.dumps(
            {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "trackIds": [102, 101],
                                    "mood": "Тихий дождливый джаз",
                                    "reason": "Мягкий джаз подходит дождливому вечеру.",
                                }
                            )
                        }
                    }
                ]
            }
        ).encode()

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_):
                return None

            def read(self, _limit):
                return response_body

        payload = {
            "context": {
                "city": "Москва",
                "timezone": "Europe/Moscow",
                "localTime": "21:45",
                "localDate": "10 ноября",
                "weekday": "вторник",
                "dayPart": "вечером",
                "temperatureC": 7,
                "weatherCode": 61,
                "weatherDescription": "Дождь",
                "genre": "Jazz",
            },
            "preferences": {
                "spotify": {
                    "topArtists": [{"name": "Miles Davis", "genres": ["jazz"]}],
                    "genres": ["jazz"],
                    "topTracks": [],
                    "recentTracks": [],
                    "savedTracks": [],
                },
                "likedTracks": [],
                "interactionHistory": [],
                "recentRecommendations": [],
            },
            "candidates": [
                {"id": 101, "title": "Rain", "artist": "Artist A", "identity": "artist a|rain"},
                {"id": 102, "title": "Night", "artist": "Artist B", "identity": "artist b|night"},
            ],
        }
        captured = {}

        def fake_urlopen(request, timeout):
            captured["request"] = request
            captured["timeout"] = timeout
            return FakeResponse()

        with patch("server.urllib.request.urlopen", side_effect=fake_urlopen):
            result = request_ai_playlist(
                payload,
                api_key="server-secret",
                api_url=AI_DEFAULT_URL,
                model=AI_DEFAULT_MODEL,
            )
        request_payload = json.loads(captured["request"].data)
        prompt = "\n".join(
            message["content"] for message in request_payload["messages"]
        )
        self.assertEqual(result["trackIds"], [102, 101])
        self.assertEqual(
            request_payload["response_format"], {"type": "json_object"}
        )
        self.assertIn("Europe/Moscow", prompt)
        self.assertIn("Miles Davis", prompt)
        self.assertIn("Night", prompt)
        self.assertEqual(captured["request"].get_header("Authorization"), "Bearer server-secret")

    def test_ai_retries_invalid_json_and_accepts_string_catalog_ids(self):
        response_bodies = [
            json.dumps(
                {"choices": [{"message": {"content": "not valid JSON"}}]}
            ).encode(),
            json.dumps(
                {
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps(
                                    {
                                        "trackIds": ["101"],
                                        "mood": "Тёплый дождливый джаз",
                                        "reason": "Мягкий джаз соответствует погоде и времени суток.",
                                    }
                                )
                            }
                        }
                    ]
                }
            ).encode(),
        ]
        request_payloads = []

        class FakeResponse:
            def __init__(self, body):
                self.body = body

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return None

            def read(self, _limit):
                return self.body

        def fake_urlopen(request, timeout):
            request_payloads.append(json.loads(request.data.decode("utf-8")))
            return FakeResponse(response_bodies.pop(0))

        payload = {
            "context": {
                "city": "Москва",
                "genre": "Jazz",
                "temperatureC": 7,
                "weatherDescription": "Дождь",
                "dayPart": "вечером",
            },
            "candidates": [
                {"id": 101, "title": "Rain", "artist": "Artist A"},
                {"id": 102, "title": "Night", "artist": "Artist B"},
            ],
        }
        with patch("server.urllib.request.urlopen", side_effect=fake_urlopen):
            result = request_ai_playlist(
                payload,
                api_key="server-secret",
                api_url=AI_DEFAULT_URL,
                model="gemini-2.5-flash",
            )

        self.assertEqual(result["trackIds"], [101])
        self.assertEqual(len(request_payloads), 2)
        self.assertEqual(
            request_payloads[0]["response_format"], {"type": "json_object"}
        )
        self.assertEqual(
            request_payloads[1]["response_format"], {"type": "json_object"}
        )
        self.assertIn(
            "Предыдущий ответ не прошёл проверку формата",
            request_payloads[1]["messages"][-1]["content"],
        )

    def test_ai_reports_invalid_json_after_single_safe_retry(self):
        response_body = json.dumps(
            {"choices": [{"message": {"content": "not valid JSON"}}]}
        ).encode()

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_):
                return None

            def read(self, _limit):
                return response_body

        payload = {
            "context": {"city": "Москва", "genre": "Jazz"},
            "candidates": [{"id": 101, "title": "Rain", "artist": "Artist A"}],
        }
        with patch(
            "server.urllib.request.urlopen", return_value=FakeResponse()
        ) as urlopen:
            with self.assertRaisesRegex(AIError, "дважды вернул некорректный JSON"):
                request_ai_playlist(
                    payload,
                    api_key="server-secret",
                    api_url=AI_DEFAULT_URL,
                    model="gemini-2.5-flash",
                )
        self.assertEqual(urlopen.call_count, 2)

    def test_ai_rejects_fabricated_track_ids(self):
        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_):
                return None

            def read(self, _limit):
                return json.dumps(
                    {
                        "choices": [
                            {
                                "message": {
                                    "content": json.dumps(
                                        {
                                            "trackIds": [999],
                                            "mood": "Настроение",
                                            "reason": "Подходит погоде.",
                                        }
                                    )
                                }
                            }
                        ]
                    }
                ).encode()

        payload = {
            "context": {"city": "Москва", "genre": "Jazz"},
            "candidates": [{"id": 101, "title": "Rain", "artist": "Artist A"}],
        }
        with patch("server.urllib.request.urlopen", return_value=FakeResponse()):
            with self.assertRaisesRegex(AIError, "вне реального каталога"):
                request_ai_playlist(
                    payload,
                    api_key="server-secret",
                    api_url=AI_DEFAULT_URL,
                    model=AI_DEFAULT_MODEL,
                )

    def test_ai_excludes_previously_recommended_candidates(self):
        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_):
                return None

            def read(self, _limit):
                return json.dumps(
                    {
                        "choices": [
                            {
                                "message": {
                                    "content": json.dumps(
                                        {
                                            "trackIds": [101, 102],
                                            "mood": "Атмосферно",
                                            "reason": "Подходит текущей погоде.",
                                        }
                                    )
                                }
                            }
                        ]
                    }
                ).encode()

        payload = {
            "context": {"city": "Москва", "genre": "Jazz"},
            "preferences": {"recentRecommendations": ["artist a|rain"]},
            "candidates": [
                {"id": 101, "title": "Rain", "artist": "Artist A", "identity": "artist a|rain"},
                {"id": 102, "title": "Night", "artist": "Artist B", "identity": "artist b|night"},
            ],
        }
        with patch("server.urllib.request.urlopen", return_value=FakeResponse()):
            result = request_ai_playlist(
                payload,
                api_key="server-secret",
                api_url=AI_DEFAULT_URL,
                model=AI_DEFAULT_MODEL,
            )
        self.assertEqual(result["trackIds"], [102])

    def test_api_request_adds_bearer_authentication_header(self):
        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_):
                return None

            def read(self, _limit):
                return b'{"ok": true}'

        with patch("server.urllib.request.urlopen", return_value=FakeResponse()) as urlopen:
            _spotify_api("/me", "verification-token")
        request = urlopen.call_args.args[0]
        self.assertEqual(request.get_header("Authorization"), "Bearer verification-token")

    def test_expired_access_token_is_refreshed_without_losing_refresh_token(self):
        session_id = secrets.token_urlsafe(24)
        SESSIONS.create(session_id)
        SESSIONS.update(
            session_id,
            {
                "tokens": {
                    "access_token": "expired-token",
                    "refresh_token": "refresh-token",
                },
                "token_expires_at": 0,
            },
        )
        handler = object.__new__(RequestHandler)
        handler.server = SimpleNamespace(client_id="client", client_secret="secret")
        with patch(
            "server._form_request",
            return_value={"access_token": "fresh-token", "expires_in": 3600},
        ) as refresh:
            access_token = handler._refresh_access_token(session_id)
        self.assertEqual(access_token, "fresh-token")
        self.assertEqual(
            SESSIONS.get(session_id)["tokens"]["refresh_token"],
            "refresh-token",
        )
        self.assertEqual(refresh.call_args.args[1]["refresh_token"], "refresh-token")
        SESSIONS.delete(session_id)


class ApiRouteTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(
            os.environ,
            {
                "SPOTIFY_CLIENT_ID": "test-client",
                "SPOTIFY_CLIENT_SECRET": "test-secret",
                "SPOTIFY_REDIRECT_URI": "http://127.0.0.1:8000/api/spotify/callback",
                "AI_API_KEY": "",
                "AI_API_URL": AI_DEFAULT_URL,
                "AI_MODEL": AI_DEFAULT_MODEL,
                "WEATHERMOOD_SESSION_SECRET": "test-session-secret-with-more-than-32-bytes",
                "APP_ENV": "",
                "SPOTIFY_COOKIE_SECURE": "",
            },
        )
        self.environment.start()
        self.server = WeatherMoodServer(("127.0.0.1", 0))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.connection = http.client.HTTPConnection(*self.server.server_address, timeout=3)

    def tearDown(self):
        self.connection.close()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        self.environment.stop()

    def request(self, method, path, headers=None, body=None):
        self.connection.request(method, path, body=body, headers=headers or {})
        response = self.connection.getresponse()
        return response.status, response.getheaders(), response.read()

    def test_status_issues_http_only_signed_session_cookie(self):
        self.server.cookie_secure = True
        status, headers, body = self.request("GET", "/api/spotify/status")
        payload = json.loads(body)
        cookie = next(value for name, value in headers if name == "Set-Cookie")
        self.assertEqual(status, 200)
        self.assertTrue(payload["configured"])
        self.assertFalse(payload["connected"])
        self.assertIn(f"{COOKIE_NAME}=", cookie)
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Lax", cookie)
        self.assertIn("Secure", cookie)

    def test_login_uses_server_authorization_code_flow_and_minimal_scopes(self):
        _, headers, _ = self.request("GET", "/api/spotify/status")
        cookie = next(value.split(";", 1)[0] for name, value in headers if name == "Set-Cookie")
        status, _, body = self.request(
            "POST",
            "/api/spotify/login",
            {"Cookie": cookie, "Content-Length": "0"},
        )
        authorization_url = json.loads(body)["authorizationUrl"]
        params = urllib.parse.parse_qs(urllib.parse.urlsplit(authorization_url).query)
        self.assertEqual(status, 200)
        self.assertEqual(urllib.parse.urlsplit(authorization_url).hostname, "accounts.spotify.com")
        self.assertTrue(params["state"][0])
        self.assertEqual(params["redirect_uri"], ["http://127.0.0.1:8000/api/spotify/callback"])
        self.assertNotIn("code_challenge", params)
        self.assertIn("user-top-read", params["scope"][0])
        self.assertNotIn("test-secret", authorization_url)

    def test_untrusted_oauth_state_does_not_exchange_code(self):
        _, headers, _ = self.request("GET", "/api/spotify/status")
        cookie = next(value.split(";", 1)[0] for name, value in headers if name == "Set-Cookie")
        session_id = read_session_cookie(
            cookie.split("=", 1)[1],
            self.server.cookie_secret,
        )
        SESSIONS.update(
            session_id,
            {"oauth_state": "expected-state", "code_verifier": "verifier"},
        )
        status, headers, _ = self.request(
            "GET",
            "/api/spotify/callback?state=attacker-state&code=not-a-real-code",
            {"Cookie": cookie},
        )
        location = next(value for name, value in headers if name == "Location")
        self.assertEqual(status, 303)
        self.assertEqual(location, "/?spotify_error=invalid_state")

    def test_oauth_callback_keeps_tokens_only_in_server_session(self):
        _, headers, _ = self.request("GET", "/api/spotify/status")
        cookie = next(value.split(";", 1)[0] for name, value in headers if name == "Set-Cookie")
        status, _, body = self.request(
            "POST",
            "/api/spotify/login",
            {"Cookie": cookie, "Content-Length": "0"},
        )
        self.assertEqual(status, 200)
        auth_params = urllib.parse.parse_qs(
            urllib.parse.urlsplit(json.loads(body)["authorizationUrl"]).query
        )
        callback = "/api/spotify/callback?" + urllib.parse.urlencode(
            {"state": auth_params["state"][0], "code": "one-time-code"}
        )
        with patch(
            "server._form_request",
            return_value={
                "access_token": "access-token-test",
                "refresh_token": "refresh-token-test",
                "expires_in": 3600,
            },
        ) as exchange, patch(
            "server._spotify_api",
            return_value={"display_name": "Test Listener"},
        ) as profile:
            status, headers, _ = self.request("GET", callback, {"Cookie": cookie})
        location = next(value for name, value in headers if name == "Location")
        self.assertEqual(status, 303)
        self.assertEqual(location, "/?spotify=connected")
        session_id = read_session_cookie(cookie.split("=", 1)[1], self.server.cookie_secret)
        session = SESSIONS.get(session_id)
        self.assertEqual(session["tokens"]["access_token"], "access-token-test")
        self.assertEqual(session["tokens"]["refresh_token"], "refresh-token-test")
        self.assertEqual(session["display_name"], "Test Listener")
        exchange.assert_called_once()
        profile.assert_called_once_with("/me", "access-token-test")

    def test_static_frontend_and_unauthenticated_profile(self):
        status, _, body = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(b"city-local-time", body)
        status, _, body = self.request("GET", "/api/spotify/profile")
        self.assertEqual(status, 401)
        self.assertIn("Подключите", json.loads(body)["error"])

    def test_vercel_wsgi_entrypoint_serves_spotify_status_and_frontend(self):
        from app import app as vercel_app

        def make_request(path, *, method="GET", cookie="", body=b"", query=""):
            response = {}

            def start_response(status, headers):
                response["status"] = status
                response["headers"] = headers

            body = b"".join(
                vercel_app(
                    {
                        "REQUEST_METHOD": method,
                        "PATH_INFO": path,
                        "QUERY_STRING": query,
                        "HTTP_HOST": "weather.example.test",
                        "HTTP_COOKIE": cookie,
                        "CONTENT_LENGTH": str(len(body)),
                        "SERVER_NAME": "weather.example.test",
                        "SERVER_PORT": "443",
                        "SERVER_PROTOCOL": "HTTP/1.1",
                        "REMOTE_ADDR": "127.0.0.1",
                        "wsgi.version": (1, 0),
                        "wsgi.url_scheme": "https",
                        "wsgi.errors": io.StringIO(),
                        "wsgi.input": io.BytesIO(body),
                        "wsgi.multithread": False,
                        "wsgi.multiprocess": False,
                        "wsgi.run_once": False,
                    },
                    start_response,
                )
            )
            return response, body

        response, body = make_request("/api/spotify/status")
        payload = json.loads(body)
        self.assertEqual(response["status"], "200 OK")
        self.assertTrue(payload["configured"])
        self.assertTrue(
            any(name.lower() == "set-cookie" for name, _ in response["headers"])
        )
        cookie = next(
            value.split(";", 1)[0]
            for name, value in response["headers"]
            if name.lower() == "set-cookie"
        )
        login_response, _ = make_request(
            "/api/spotify/login", method="GET", cookie=cookie
        )
        self.assertEqual(login_response["status"], "303 See Other")
        authorization_url = next(
            value
            for name, value in login_response["headers"]
            if name.lower() == "location"
        )
        state = urllib.parse.parse_qs(urllib.parse.urlsplit(authorization_url).query)["state"][0]
        with patch(
            "server._form_request",
            return_value={
                "access_token": "wsgi-access-token",
                "refresh_token": "wsgi-refresh-token",
                "expires_in": 3600,
            },
        ), patch(
            "server._spotify_api",
            return_value={"display_name": "WeatherMood Listener"},
        ):
            callback_response, callback_body = make_request(
                "/api/spotify/callback",
                cookie=cookie,
                query=urllib.parse.urlencode(
                    {"state": state, "code": "test-auth-code"}
                ),
            )
        self.assertEqual(callback_response["status"], "303 See Other")
        self.assertTrue(
            any(
                name.lower() == "location" and value == "/?spotify=connected"
                for name, value in callback_response["headers"]
            )
        )
        self.assertEqual(callback_body, b"")
        status_response, status_body = make_request(
            "/api/spotify/status", cookie=cookie
        )
        connected_status = json.loads(status_body)
        self.assertEqual(status_response["status"], "200 OK")
        self.assertTrue(connected_status["connected"])
        self.assertEqual(connected_status["displayName"], "WeatherMood Listener")
        disconnected_response, disconnected_body = make_request(
            "/api/spotify/disconnect", method="POST", cookie=cookie
        )
        self.assertEqual(disconnected_response["status"], "200 OK")
        self.assertFalse(json.loads(disconnected_body)["connected"])
        self.assertTrue(
            any(
                name.lower() == "set-cookie" and "Max-Age=0" in value
                for name, value in disconnected_response["headers"]
            )
        )
        response, body = make_request("/")
        self.assertEqual(response["status"], "200 OK")
        self.assertIn("погодный ритм".encode("utf-8"), body)
        for static_file in ("/app.js", "/styles.css"):
            response, body = make_request(static_file)
            self.assertEqual(response["status"], "200 OK")
            self.assertGreater(len(body), 0)
        with patch(
            "server.SessionStore._redis_config",
            side_effect=RuntimeError("Некорректная конфигурация Upstash Redis REST."),
        ):
            response, body = make_request("/api/spotify/status")
        self.assertEqual(response["status"], "503 Service Unavailable")
        self.assertIn("Upstash Redis", json.loads(body)["error"])

    def test_vercel_config_builds_and_routes_to_python_wsgi_entrypoint(self):
        config_path = os.path.join(os.path.dirname(__file__), "vercel.json")
        with open(config_path, encoding="utf-8") as config_file:
            config = json.load(config_file)

        self.assertEqual(config["builds"], [{"src": "app.py", "use": "@vercel/python"}])
        self.assertEqual(config["routes"], [{"src": "/(.*)", "dest": "app.py"}])

    def test_ai_endpoint_requires_configuration_session_and_same_origin(self):
        status, _, body = self.request("GET", "/api/ai/status")
        self.assertEqual(status, 200)
        self.assertFalse(json.loads(body)["configured"])
        self.assertIn("AI_API_KEY", json.loads(body)["error"])

        self.server.ai_api_key = "server-only-test-key"
        _, headers, _ = self.request("GET", "/api/ai/status")
        cookie = next(value.split(";", 1)[0] for name, value in headers if name == "Set-Cookie")
        host, port = self.server.server_address
        payload = json.dumps(
            {
                "context": {"city": "Москва", "genre": "Jazz"},
                "candidates": [{"id": 101, "title": "Rain", "artist": "Artist A"}],
            }
        )
        with patch(
            "server.request_ai_playlist",
            return_value={
                "trackIds": [101],
                "mood": "Атмосферно",
                "reason": "Подходит погоде.",
                "model": AI_DEFAULT_MODEL,
            },
        ) as recommend:
            status, _, body = self.request(
                "POST",
                "/api/ai/playlist",
                {
                    "Cookie": cookie,
                    "Origin": f"http://{host}:{port}",
                    "Content-Length": str(len(payload.encode())),
                    "Content-Type": "application/json",
                },
                body=payload,
            )
            result = json.loads(body)
            self.assertEqual(status, 200)
            self.assertEqual(result["trackIds"], [101])
            self.assertEqual(recommend.call_args.kwargs["api_key"], "server-only-test-key")

        status, _, body = self.request(
            "POST",
            "/api/ai/playlist",
            {
                "Cookie": cookie,
                "Origin": "https://evil.example",
                "Content-Length": str(len(payload.encode())),
                "Content-Type": "application/json",
            },
            body=payload,
        )
        self.assertEqual(status, 403)
        self.assertIn("WeatherMood", json.loads(body)["error"])


if __name__ == "__main__":
    unittest.main()
