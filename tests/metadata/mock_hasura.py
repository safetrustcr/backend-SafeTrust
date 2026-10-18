#!/usr/bin/env python3
"""Minimal Hasura metadata/GraphQL server used by the metadata deploy tests.

It deliberately implements only the endpoints and commands exercised by
metadata/deploy-tenant.sh. State is persisted to a JSON file so tests can
inspect exactly what was applied.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


class MockState:
    def __init__(self, state_path: Path, calls_path: Path) -> None:
        self.state_path = state_path
        self.calls_path = calls_path
        self.lock = threading.Lock()
        self.state = self._read()
        self.calls_path.write_text("", encoding="utf-8")

    def _read(self) -> dict[str, Any]:
        if not self.state_path.exists():
            return {"version": 3, "sources": []}
        return json.loads(self.state_path.read_text(encoding="utf-8"))

    def save(self) -> None:
        tmp = self.state_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(self.state, indent=2, sort_keys=True), encoding="utf-8")
        tmp.replace(self.state_path)

    def record(self, entry: dict[str, Any]) -> None:
        with self.calls_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, sort_keys=True) + "\n")


class Handler(BaseHTTPRequestHandler):
    server_version = "MockHasura/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003
        # Keep test output quiet; the harness inspects responses directly.
        return

    @property
    def state(self) -> MockState:
        return self.server.state  # type: ignore[attr-defined]

    def _send(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        expected = os.environ.get("MOCK_ADMIN_SECRET", "testsecret")
        return self.headers.get("X-Hasura-Admin-Secret", "") == expected

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/healthz":
            self._send(200, {"status": "ok"})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        try:
            body = self._read_json()
        except json.JSONDecodeError as exc:
            self._send(400, {"error": f"invalid JSON: {exc}"})
            return

        if not self._authorized():
            self._send(401, {"error": "invalid admin secret"})
            return

        if self.path == "/v1/metadata":
            self._handle_metadata(body)
        elif self.path == "/v1/graphql":
            self._handle_graphql(body)
        else:
            self._send(404, {"error": "not found"})

    def _handle_metadata(self, body: dict[str, Any]) -> None:
        command = body.get("type", "")
        args = body.get("args", {}) or {}
        self.state.record({"kind": "metadata", "type": command})

        if command == "export_metadata":
            with self.state.lock:
                self._send(200, {"metadata": self.state.state})
            return

        if command == "replace_metadata":
            if os.environ.get("MOCK_FAIL_REPLACE") == "1":
                self._send(400, {"error": "simulated replace_metadata failure"})
                return

            metadata = args.get("metadata")
            if not isinstance(metadata, dict):
                self._send(400, {"error": "replace_metadata requires metadata"})
                return

            with self.state.lock:
                self.state.state = metadata
                self.state.save()
            self._send(200, {"message": "success"})
            return

        if command == "get_inconsistent_metadata":
            if os.environ.get("MOCK_INCONSISTENT") == "1":
                self._send(
                    200,
                    {
                        "is_consistent": False,
                        "inconsistent_objects": [
                            {
                                "type": "table",
                                "reason": "simulated inconsistent metadata",
                            }
                        ],
                    },
                )
            else:
                self._send(200, {"is_consistent": True, "inconsistent_objects": []})
            return

        if command == "pg_add_source":
            name = args.get("name", "")
            with self.state.lock:
                sources = self.state.state.setdefault("sources", [])
                if any(source.get("name") == name for source in sources):
                    self._send(400, {"error": f"source '{name}' already exists", "code": "already-exists"})
                    return
                sources.append(args)
                self.state.save()
            self._send(200, {"message": "success"})
            return

        self._send(400, {"error": f"unsupported metadata command: {command}"})

    def _handle_graphql(self, body: dict[str, Any]) -> None:
        role = self.headers.get("X-Hasura-Role", "admin")
        query = body.get("query", "")
        self.state.record({"kind": "graphql", "role": role, "query": query})

        role_failure = os.environ.get("MOCK_ROLE_FAIL", "")
        if role_failure and role == role_failure:
            self._send(200, {"errors": [{"message": f"simulated failure for role {role}"}]})
            return

        if "__schema" in query:
            self._send(
                200,
                {"data": {"__schema": {"queryType": {"name": "query_root"}}}},
            )
            return

        match = re.search(r"query\s+\w+\s*\{\s*([A-Za-z_][A-Za-z0-9_]*)", query)
        if match:
            self._send(200, {"data": {match.group(1): []}})
        else:
            self._send(200, {"data": {}})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", required=True)
    parser.add_argument("--calls", required=True)
    parser.add_argument("--ready-file", required=True)
    parser.add_argument("--port", type=int, default=0)
    args = parser.parse_args()

    state = MockState(Path(args.state), Path(args.calls))
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.state = state  # type: ignore[attr-defined]

    Path(args.ready_file).write_text(
        json.dumps({"port": server.server_address[1]}), encoding="utf-8"
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
