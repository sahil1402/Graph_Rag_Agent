from __future__ import annotations

import json
import os
import shutil
import subprocess
import uuid
from pathlib import Path


class PlaywrightBrowserRunner:
    def __init__(self, project_root: Path, *, base_url: str | None = None) -> None:
        self.project_root = project_root
        self.base_url = (base_url or "http://127.0.0.1:8010").rstrip("/")
        self.runtime_dir = project_root / "runtime"
        self.runtime_dir.mkdir(parents=True, exist_ok=True)
        self.script_path = project_root / "graphrag_agent" / "browser_agent_runner.cjs"
        self.node_executable = self._resolve_node_executable()
        self.node_modules_dir = self._resolve_node_modules_dir()
        self.playwright_core_entry = self._resolve_playwright_core_entry()

    @property
    def default_target_url(self) -> str:
        return f"{self.base_url}/demo/index.html"

    def run(
        self,
        *,
        command: str,
        target_url: str,
        parsed_intent: str,
        task: dict[str, object],
        graph: dict[str, object],
        run_id: str | None = None,
    ) -> dict[str, object]:
        run_id = run_id or uuid.uuid4().hex[:10]
        run_dir = self.runtime_dir / run_id
        screens_dir = run_dir / "screens"
        screens_dir.mkdir(parents=True, exist_ok=True)

        request_payload = {
            "command": command,
            "targetUrl": target_url,
            "parsedIntent": parsed_intent,
            "task": task,
            "graph": graph,
            "runId": run_id,
            "artifactsBaseUrl": f"/runtime/{run_id}",
            "screensDir": str(screens_dir),
            "maxSteps": 10,
        }

        request_path = run_dir / "request.json"
        response_path = run_dir / "response.json"
        request_path.write_text(json.dumps(request_payload, indent=2), encoding="utf-8")

        env = os.environ.copy()
        env["NODE_PATH"] = str(self.node_modules_dir)
        env["PLAYWRIGHT_CORE_PATH"] = str(self.playwright_core_entry)

        completed = subprocess.run(
            [str(self.node_executable), str(self.script_path), str(request_path), str(response_path)],
            cwd=self.project_root,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )

        if completed.returncode != 0:
            message = completed.stderr.strip() or completed.stdout.strip() or "Unknown Playwright runner failure."
            raise ValueError(f"Browser runner failed: {message}")

        if not response_path.exists():
            raise ValueError("Browser runner did not produce a response payload.")

        return json.loads(response_path.read_text(encoding="utf-8"))

    def clear_runtime(self) -> None:
        if self.runtime_dir.exists():
            shutil.rmtree(self.runtime_dir)
        self.runtime_dir.mkdir(parents=True, exist_ok=True)

    def _resolve_node_executable(self) -> Path:
        home = Path.home()
        bundled = home / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies" / "node" / "bin" / "node.exe"
        if bundled.exists():
            return bundled
        return Path("node")

    def _resolve_node_modules_dir(self) -> Path:
        home = Path.home()
        bundled = home / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies" / "node" / "node_modules"
        if bundled.exists():
            return bundled
        raise FileNotFoundError("Bundled Node.js modules directory was not found.")

    def _resolve_playwright_core_entry(self) -> Path:
        matches = sorted(
            self.node_modules_dir.glob(".pnpm/playwright-core@*/node_modules/playwright-core/index.js")
        )
        if matches:
            return matches[-1]
        raise FileNotFoundError("Bundled playwright-core entrypoint was not found.")
