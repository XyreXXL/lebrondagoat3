import http.client
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
    WeatherMoodServer,
    AIError,
    request_ai_playlist,
    _spotify_api,
    make_session_cookie,
    read_session_cookie,
)


class OAuthSessionTests(unittest.TestCase):
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
        self.assertIn("Europe/Moscow", prompt)
        self.assertIn("Miles Davis", prompt)
        self.assertIn("Night", prompt)
        self.assertEqual(captured["request"].get_header("Authorization"), "Bearer server-secret")

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
        status, headers, body = self.request("GET", "/api/spotify/status")
        payload = json.loads(body)
        cookie = next(value for name, value in headers if name == "Set-Cookie")
        self.assertEqual(status, 200)
        self.assertTrue(payload["configured"])
        self.assertFalse(payload["connected"])
        self.assertIn(f"{COOKIE_NAME}=", cookie)
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Lax", cookie)

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
        ) as exchange:
            status, headers, _ = self.request("GET", callback, {"Cookie": cookie})
        location = next(value for name, value in headers if name == "Location")
        self.assertEqual(status, 303)
        self.assertEqual(location, "/?spotify=connected")
        session_id = read_session_cookie(cookie.split("=", 1)[1], self.server.cookie_secret)
        session = SESSIONS.get(session_id)
        self.assertEqual(session["tokens"]["access_token"], "access-token-test")
        self.assertEqual(session["tokens"]["refresh_token"], "refresh-token-test")
        exchange.assert_called_once()

    def test_static_frontend_and_unauthenticated_profile(self):
        status, _, body = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(b"city-local-time", body)
        status, _, body = self.request("GET", "/api/spotify/profile")
        self.assertEqual(status, 401)
        self.assertIn("Подключите", json.loads(body)["error"])

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
