from __future__ import annotations

import shutil
import unittest
from pathlib import Path

from graphrag_agent.webapp import GraphRAGBrowserApp


class GraphRAGBrowserAppTests(unittest.TestCase):
    def test_run_command_returns_graph_and_report(self) -> None:
        memory_path = Path(__file__).resolve().parent / "_webapp_memory.json"
        project_root = Path(__file__).resolve().parents[1]
        target_url = (project_root / "static" / "demo" / "index.html").resolve().as_uri()
        runtime_dir = project_root / "runtime"
        try:
            app = GraphRAGBrowserApp(memory_path=memory_path)
            payload = app.run_command(
                "Book a flight from San Francisco to New York",
                target_url=target_url,
            )
        finally:
            memory_path.unlink(missing_ok=True)
            shutil.rmtree(runtime_dir, ignore_errors=True)

        self.assertEqual(payload["parsed_intent"], "book_flight")
        self.assertTrue(payload["report"]["success"])
        self.assertGreater(len(payload["graph"]["nodes"]), 0)
        self.assertGreater(len(payload["highlighted_edge_ids"]), 0)


if __name__ == "__main__":
    unittest.main()
