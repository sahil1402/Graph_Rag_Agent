from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

from .agent import GraphRAGAgent
from .commands import CommandParser
from .environment import build_demo_environment
from .graph import GraphMemory


class GraphRAGBrowserApp:
    def __init__(self, *, project_root: Path | None = None, memory_path: Path | None = None) -> None:
        self.project_root = project_root or Path(__file__).resolve().parent.parent
        self.memory_path = memory_path or (self.project_root / "graph_memory_snapshot.json")
        self.parser = CommandParser()
        self.agent = GraphRAGAgent(self._load_memory())
        self.last_run_payload: dict[str, object] | None = None

    def _load_memory(self) -> GraphMemory:
        if self.memory_path.exists():
            try:
                return GraphMemory.load(self.memory_path)
            except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError):
                return GraphMemory()
        return GraphMemory()

    def get_state(self) -> dict[str, object]:
        return {
            "examples": self.parser.examples(),
            "graph": self.agent.memory.export_for_visualization(),
            "memory_stats": self.agent.memory.stats(),
            "last_run": self.last_run_payload,
            "memory_path": str(self.memory_path),
        }

    def run_command(self, command: str) -> dict[str, object]:
        parsed = self.parser.parse(command)
        environment = build_demo_environment()
        report = self.agent.run(parsed.task, environment)
        report_payload = asdict(report)
        self.agent.memory.save(self.memory_path)

        payload = {
            "command": command,
            "parsed_intent": parsed.intent,
            "parser_explanation": parsed.explanation,
            "task": asdict(parsed.task),
            "report": report_payload,
            "graph": self.agent.memory.export_for_visualization(),
            "memory_stats": self.agent.memory.stats(),
            "highlighted_edge_ids": self._collect_highlighted_edge_ids(report_payload["steps"]),
            "highlighted_node_ids": self._collect_highlighted_node_ids(
                report_payload["steps"],
                report.final_screen_id,
            ),
            "examples": self.parser.examples(),
        }
        self.last_run_payload = payload
        return payload

    def reset_memory(self) -> dict[str, object]:
        self.agent = GraphRAGAgent(GraphMemory())
        self.last_run_payload = None
        if self.memory_path.exists():
            self.memory_path.unlink()
        return self.get_state()

    def _collect_highlighted_edge_ids(self, steps: list[dict[str, object]]) -> list[str]:
        edge_ids: list[str] = []
        for step in steps:
            action = step.get("action", {})
            if not isinstance(action, dict):
                continue
            target_id = action.get("target_id")
            screen_id = step.get("screen_id")
            next_screen_id = step.get("next_screen_id")
            action_kind = action.get("kind")
            if not isinstance(target_id, str) or not isinstance(screen_id, str):
                continue
            if action_kind == "click":
                edge_ids.append(GraphMemory.edge_id(screen_id, "clicked", target_id))
                if isinstance(next_screen_id, str) and next_screen_id != screen_id:
                    edge_ids.append(GraphMemory.edge_id(target_id, "leads_to", next_screen_id))
            elif action_kind == "type":
                edge_ids.append(GraphMemory.edge_id(screen_id, "filled", target_id))
        return edge_ids

    def _collect_highlighted_node_ids(
        self,
        steps: list[dict[str, object]],
        final_screen_id: str,
    ) -> list[str]:
        node_ids: list[str] = []
        for step in steps:
            screen_id = step.get("screen_id")
            if isinstance(screen_id, str):
                node_ids.append(screen_id)
            action = step.get("action", {})
            if isinstance(action, dict):
                target_id = action.get("target_id")
                if isinstance(target_id, str):
                    node_ids.append(target_id)
        node_ids.append(final_screen_id)
        return list(dict.fromkeys(node_ids))
