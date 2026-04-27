from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


ElementRole = Literal["link", "button", "input", "text"]
ActionKind = Literal["click", "type", "stop"]
MetadataValue = str | int | float | bool


@dataclass(slots=True)
class VisualElement:
    element_id: str
    label: str
    role: ElementRole
    description: str = ""
    input_key: str | None = None
    value: str = ""


@dataclass(slots=True)
class Observation:
    screen_id: str
    screen_label: str
    text_summary: str
    visual_summary: str
    elements: list[VisualElement] = field(default_factory=list)


@dataclass(slots=True)
class GraphNode:
    node_id: str
    label: str
    node_type: str
    attributes: dict[str, MetadataValue] = field(default_factory=dict)


@dataclass(slots=True)
class GraphEdge:
    source_id: str
    relation: str
    target_id: str
    weight: float = 1.0
    attributes: dict[str, MetadataValue] = field(default_factory=dict)


@dataclass(slots=True)
class RetrievalResult:
    seed_node_ids: list[str]
    node_ids: list[str]
    edges: list[GraphEdge]
    summary_lines: list[str]


@dataclass(slots=True)
class ToolAction:
    kind: ActionKind
    target_id: str | None = None
    value: str | None = None
    reason: str = ""


@dataclass(slots=True)
class ActionResult:
    success: bool
    message: str
    next_screen_id: str
    done: bool = False


@dataclass(slots=True)
class Task:
    goal: str
    required_inputs: dict[str, str]
    success_screen_id: str


@dataclass(slots=True)
class AgentStep:
    step_number: int
    screen_id: str
    observation_label: str
    observation_summary: str
    visible_elements: list[str]
    context_summary: str
    retrieval_lines: list[str]
    action: ToolAction
    action_reason: str
    result_message: str
    next_screen_id: str


@dataclass(slots=True)
class AgentRunReport:
    goal: str
    success: bool
    steps: list[AgentStep]
    final_screen_id: str
    final_observation: Observation | None = None
