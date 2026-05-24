from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

from .browser_runtime import PlaywrightBrowserRunner
from .commands import CommandParser
from .graph import GraphMemory
from .models import Observation, ToolAction, VisualElement


class GraphRAGBrowserApp:
    def __init__(
        self,
        *,
        project_root: Path | None = None,
        memory_path: Path | None = None,
        base_url: str | None = None,
    ) -> None:
        self.project_root = project_root or Path(__file__).resolve().parent.parent
        self.memory_path = memory_path or (self.project_root / "graph_memory_snapshot.json")
        self.parser = CommandParser()
        self.runner = PlaywrightBrowserRunner(self.project_root, base_url=base_url)
        self.memory = self._load_memory()
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
            "graph": self.memory.export_for_visualization(),
            "memory_stats": self.memory.stats(),
            "last_run": self.last_run_payload,
            "memory_path": str(self.memory_path),
            "default_target_url": self.runner.default_target_url,
        }

    def run_command(self, command: str, *, target_url: str | None = None) -> dict[str, object]:
        parsed = self.parser.parse(command)
        resolved_target_url = (target_url or "").strip() or self.runner.default_target_url

        runner_payload = self.runner.run(
            command=command,
            target_url=resolved_target_url,
            parsed_intent=parsed.intent,
            task=asdict(parsed.task),
            graph=self.memory.export_for_visualization(),
        )
        if "error" in runner_payload:
            raise ValueError(str(runner_payload["error"]))

        report_payload = dict(runner_payload["report"])
        self._merge_run_into_memory(report_payload)
        self.memory.save(self.memory_path)

        payload = {
            "command": command,
            "target_url": resolved_target_url,
            "parsed_intent": parsed.intent,
            "parser_explanation": parsed.explanation,
            "task": asdict(parsed.task),
            "report": report_payload,
            "browser": runner_payload.get("browser", {}),
            "graph": self.memory.export_for_visualization(),
            "memory_stats": self.memory.stats(),
            "highlighted_edge_ids": self._collect_highlighted_edge_ids(report_payload.get("steps", [])),
            "highlighted_node_ids": self._collect_highlighted_node_ids(
                report_payload.get("steps", []),
                str(report_payload.get("final_screen_id", "")),
            ),
            "examples": self.parser.examples(),
            "default_target_url": self.runner.default_target_url,
        }
        self.last_run_payload = payload
        return payload

    def reset_memory(self) -> dict[str, object]:
        self.memory = GraphMemory()
        self.last_run_payload = None
        if self.memory_path.exists():
            self.memory_path.unlink()
        self.runner.clear_runtime()
        return self.get_state()

    def _merge_run_into_memory(self, report: dict[str, object]) -> None:
        transitions: list[tuple[str, ToolAction, str]] = []

        for step in report.get("steps", []):
            if not isinstance(step, dict):
                continue

            observation = self._build_observation(
                screen_id=str(step.get("screen_id", "")),
                label=str(step.get("observation_label", "")),
                summary=str(step.get("observation_summary", "")),
                elements=step.get("elements", []),
            )
            self.memory.remember_observation(observation)

            action_payload = step.get("action", {})
            if not isinstance(action_payload, dict):
                continue
            action = ToolAction(
                kind=str(action_payload.get("kind", "stop")),
                target_id=action_payload.get("target_id"),
                value=action_payload.get("value"),
                reason=str(action_payload.get("reason", "")),
            )
            next_screen_id = str(step.get("next_screen_id", step.get("screen_id", "")))
            self.memory.record_transition(
                observation.screen_id,
                action,
                next_screen_id,
                message=str(step.get("result_message", "")),
            )
            transitions.append((observation.screen_id, action, next_screen_id))

        final_observation_payload = report.get("final_observation")
        if isinstance(final_observation_payload, dict):
            final_observation = self._build_observation(
                screen_id=str(final_observation_payload.get("screen_id", "")),
                label=str(final_observation_payload.get("screen_label", "")),
                summary=str(final_observation_payload.get("text_summary", "")),
                elements=final_observation_payload.get("elements", []),
            )
            self.memory.remember_observation(final_observation)

        if bool(report.get("success")):
            self.memory.reinforce_successful_path(
                transitions,
                goal_screen_id=str(report.get("final_screen_id", "")),
            )

    def _build_observation(
        self,
        *,
        screen_id: str,
        label: str,
        summary: str,
        elements: object,
    ) -> Observation:
        visual_elements: list[VisualElement] = []
        if isinstance(elements, list):
            for item in elements:
                if not isinstance(item, dict):
                    continue
                visual_elements.append(
                    VisualElement(
                        element_id=str(item.get("element_id", "")),
                        label=str(item.get("label", "")),
                        role=str(item.get("role", "button")),
                        description=str(item.get("description", "")),
                        input_key=(str(item.get("input_key")) if item.get("input_key") else None),
                        value=str(item.get("value", "")),
                    )
                )

        labels = ", ".join(element.label for element in visual_elements[:8]) or "No visible actions"
        return Observation(
            screen_id=screen_id or "page",
            screen_label=label or screen_id or "Page",
            text_summary=summary,
            visual_summary=f"Visible actions: {labels}",
            elements=visual_elements,
        )

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
        if final_screen_id:
            node_ids.append(final_screen_id)
        return list(dict.fromkeys(node_ids))
