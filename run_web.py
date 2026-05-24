from __future__ import annotations

import json
import mimetypes
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from graphrag_agent.webapp import GraphRAGBrowserApp


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
RUNTIME_DIR = ROOT / "runtime"
HOST = os.environ.get("GRAPH_RAG_HOST", "127.0.0.1")
PORT = int(os.environ.get("GRAPH_RAG_PORT", "8010"))
APP = GraphRAGBrowserApp(project_root=ROOT, base_url=f"http://{HOST}:{PORT}")


class GraphRAGRequestHandler(BaseHTTPRequestHandler):
    server_version = "GraphRAGBrowser/0.2"

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/state":
            self._write_json(APP.get_state())
            return

        if parsed.path.startswith("/runtime/"):
            relative = parsed.path.removeprefix("/runtime/").lstrip("/")
            self._serve_file(RUNTIME_DIR / relative, root=RUNTIME_DIR)
            return

        if parsed.path in {"/demo", "/demo/"}:
            self._serve_file(STATIC_DIR / "demo" / "index.html", root=STATIC_DIR)
            return

        target = STATIC_DIR / "index.html" if parsed.path in {"/", "/index.html"} else STATIC_DIR / parsed.path.lstrip("/")
        self._serve_file(target, root=STATIC_DIR)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/run":
            payload = self._read_json()
            command = str(payload.get("command", "")).strip()
            target_url = str(payload.get("target_url", "")).strip()
            if not command:
                self._write_json({"error": "A command is required."}, status=HTTPStatus.BAD_REQUEST)
                return
            try:
                response = APP.run_command(command, target_url=target_url)
            except ValueError as exc:
                self._write_json({"error": str(exc), **APP.get_state()}, status=HTTPStatus.BAD_REQUEST)
                return
            self._write_json(response)
            return

        if parsed.path == "/api/reset-memory":
            self._write_json(APP.reset_memory())
            return

        self._write_json({"error": "Not found."}, status=HTTPStatus.NOT_FOUND)

    def _serve_file(self, path: Path, *, root: Path) -> None:
        try:
            resolved = path.resolve(strict=True)
        except FileNotFoundError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        if not str(resolved).startswith(str(root.resolve())):
            self.send_error(HTTPStatus.FORBIDDEN)
            return

        content_type = mimetypes.guess_type(resolved.name)[0] or "application/octet-stream"
        payload = resolved.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _read_json(self) -> dict[str, object]:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def _write_json(self, payload: dict[str, object], *, status: HTTPStatus = HTTPStatus.OK) -> None:
        encoded = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format: str, *args) -> None:
        return


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), GraphRAGRequestHandler)
    print(f"GraphRAG browser app running at http://{HOST}:{PORT}")
    print("Press Ctrl+C to stop the server.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
