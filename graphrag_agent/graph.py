from __future__ import annotations

import json
import re
from collections import defaultdict, deque
from pathlib import Path

from .models import GraphEdge, GraphNode, MetadataValue, Observation, RetrievalResult, ToolAction


TOKEN_PATTERN = re.compile(r"[a-z0-9]+")


def normalize_tokens(text: str) -> set[str]:
    return set(TOKEN_PATTERN.findall(text.lower()))


class GraphMemory:
    def __init__(self) -> None:
        self.nodes: dict[str, GraphNode] = {}
        self.edges: list[GraphEdge] = []
        self._adjacency: dict[str, list[GraphEdge]] = defaultdict(list)

    def upsert_node(
        self,
        node_id: str,
        label: str,
        node_type: str,
        attributes: dict[str, MetadataValue] | None = None,
    ) -> None:
        if node_id in self.nodes:
            node = self.nodes[node_id]
            node.label = label
            node.node_type = node_type
            if attributes:
                node.attributes.update(attributes)
            return

        self.nodes[node_id] = GraphNode(
            node_id=node_id,
            label=label,
            node_type=node_type,
            attributes=attributes or {},
        )

    def add_edge(
        self,
        source_id: str,
        relation: str,
        target_id: str,
        *,
        weight: float = 1.0,
        attributes: dict[str, MetadataValue] | None = None,
    ) -> None:
        existing = self.find_edge(source_id, relation, target_id)
        if existing is not None:
            if attributes:
                existing.attributes.update(attributes)
            existing.weight = max(existing.weight, weight)
            return

        edge = GraphEdge(
            source_id=source_id,
            relation=relation,
            target_id=target_id,
            weight=weight,
            attributes=attributes or {},
        )
        self.edges.append(edge)
        self._adjacency[source_id].append(edge)

    def outgoing(self, node_id: str, relation: str | None = None) -> list[GraphEdge]:
        edges = self._adjacency.get(node_id, [])
        if relation is None:
            return list(edges)
        return [edge for edge in edges if edge.relation == relation]

    def find_edge(self, source_id: str, relation: str, target_id: str) -> GraphEdge | None:
        for edge in self._adjacency.get(source_id, []):
            if edge.relation == relation and edge.target_id == target_id:
                return edge
        return None

    def get_node(self, node_id: str) -> GraphNode | None:
        return self.nodes.get(node_id)

    @staticmethod
    def edge_id(source_id: str, relation: str, target_id: str) -> str:
        return f"{source_id}|{relation}|{target_id}"

    def edge_metric(
        self,
        source_id: str,
        relation: str,
        target_id: str,
        key: str,
        *,
        default: float = 0.0,
    ) -> float:
        edge = self.find_edge(source_id, relation, target_id)
        if edge is None:
            return default

        value = edge.attributes.get(key, default)
        if isinstance(value, bool):
            return float(value)
        if isinstance(value, (int, float)):
            return float(value)
        try:
            return float(str(value))
        except ValueError:
            return default

    def increment_edge_metric(
        self,
        source_id: str,
        relation: str,
        target_id: str,
        key: str,
        increment: float = 1.0,
    ) -> None:
        edge = self.find_edge(source_id, relation, target_id)
        if edge is None:
            self.add_edge(source_id, relation, target_id, attributes={key: increment})
            return

        current = self.edge_metric(source_id, relation, target_id, key)
        edge.attributes[key] = current + increment
        edge.weight = max(edge.weight, 1.0 + current + increment)

    def remember_observation(self, observation: Observation) -> None:
        self.upsert_node(
            observation.screen_id,
            observation.screen_label,
            "screen",
            {
                "text_summary": observation.text_summary,
                "visual_summary": observation.visual_summary,
            },
        )

        for element in observation.elements:
            self.upsert_node(
                element.element_id,
                element.label,
                "element",
                {
                    "role": element.role,
                    "description": element.description,
                    "input_key": element.input_key or "",
                    "value": element.value,
                },
            )
            self.add_edge(observation.screen_id, "contains", element.element_id)

    def record_transition(
        self,
        screen_id: str,
        action: ToolAction,
        next_screen_id: str,
        *,
        message: str,
    ) -> None:
        if action.target_id is None:
            return

        if action.kind == "click":
            self.add_edge(screen_id, "clicked", action.target_id, attributes={"message": message})
            self.increment_edge_metric(screen_id, "clicked", action.target_id, "click_count")
            if next_screen_id != screen_id:
                self.add_edge(action.target_id, "leads_to", next_screen_id, attributes={"message": message})
                self.increment_edge_metric(action.target_id, "leads_to", next_screen_id, "traversal_count")
        elif action.kind == "type":
            self.add_edge(screen_id, "filled", action.target_id, attributes={"value": action.value or ""})
            self.increment_edge_metric(screen_id, "filled", action.target_id, "fill_count")
            node = self.nodes.get(action.target_id)
            if node is not None:
                node.attributes["value"] = action.value or ""

    def retrieve(
        self,
        query: str,
        *,
        current_screen_id: str | None = None,
        max_hops: int = 2,
        limit: int = 8,
    ) -> RetrievalResult:
        query_tokens = normalize_tokens(query)
        scored_nodes: list[tuple[float, str]] = []

        for node_id, node in self.nodes.items():
            text = " ".join([node.label, *(str(value) for value in node.attributes.values())])
            node_tokens = normalize_tokens(text)
            overlap = len(query_tokens & node_tokens)
            score = float(overlap)

            if current_screen_id and node_id == current_screen_id:
                score += 1.5

            if current_screen_id:
                for edge in self.outgoing(current_screen_id):
                    if edge.target_id == node_id:
                        score += 0.5

            if score > 0:
                scored_nodes.append((score, node_id))

        scored_nodes.sort(key=lambda item: (-item[0], item[1]))
        seed_node_ids = [node_id for _, node_id in scored_nodes[: max(1, limit // 2)]]

        if current_screen_id and current_screen_id not in seed_node_ids:
            seed_node_ids.insert(0, current_screen_id)

        visited: set[str] = set()
        queue: deque[tuple[str, int]] = deque((seed_id, 0) for seed_id in seed_node_ids)
        collected_edges: list[GraphEdge] = []

        while queue and len(visited) < limit:
            node_id, depth = queue.popleft()
            if node_id in visited:
                continue
            visited.add(node_id)
            if depth >= max_hops:
                continue

            for edge in self.outgoing(node_id):
                collected_edges.append(edge)
                if edge.target_id not in visited:
                    queue.append((edge.target_id, depth + 1))

        summary_lines: list[str] = []
        for edge in collected_edges[:limit]:
            source = self.nodes.get(edge.source_id)
            target = self.nodes.get(edge.target_id)
            if source and target:
                summary_lines.append(f"{source.label} --{edge.relation}--> {target.label}")

        return RetrievalResult(
            seed_node_ids=seed_node_ids[:limit],
            node_ids=list(visited)[:limit],
            edges=collected_edges[:limit],
            summary_lines=summary_lines[:limit],
        )

    def shortest_path_length(
        self,
        start_id: str,
        goal_id: str,
        *,
        relations: set[str] | None = None,
        max_depth: int = 6,
    ) -> int | None:
        if start_id == goal_id:
            return 0

        queue: deque[tuple[str, int]] = deque([(start_id, 0)])
        visited: set[str] = {start_id}

        while queue:
            node_id, depth = queue.popleft()
            if depth >= max_depth:
                continue

            for edge in self.outgoing(node_id):
                if relations and edge.relation not in relations:
                    continue
                if edge.target_id == goal_id:
                    return depth + 1
                if edge.target_id not in visited:
                    visited.add(edge.target_id)
                    queue.append((edge.target_id, depth + 1))

        return None

    def reinforce_successful_path(
        self,
        transitions: list[tuple[str, ToolAction, str]],
        *,
        goal_screen_id: str,
    ) -> None:
        goal_node = self.nodes.get(goal_screen_id)
        self.upsert_node(
            goal_screen_id,
            goal_node.label if goal_node else goal_screen_id,
            "screen",
        )
        for screen_id, action, next_screen_id in transitions:
            if action.target_id is None:
                continue
            if action.kind == "click":
                self.increment_edge_metric(screen_id, "clicked", action.target_id, "success_count")
                if next_screen_id != screen_id:
                    self.increment_edge_metric(action.target_id, "leads_to", next_screen_id, "success_count")
            elif action.kind == "type":
                self.increment_edge_metric(screen_id, "filled", action.target_id, "success_count")

    def export_for_visualization(self) -> dict[str, list[dict[str, object]]]:
        incoming_counts: dict[str, int] = defaultdict(int)
        for edge in self.edges:
            incoming_counts[edge.target_id] += 1

        nodes = [
            {
                "id": node.node_id,
                "label": node.label,
                "type": node.node_type,
                "attributes": node.attributes,
                "degree": incoming_counts.get(node.node_id, 0) + len(self._adjacency.get(node.node_id, [])),
            }
            for node in self.nodes.values()
        ]
        edges = [
            {
                "id": self.edge_id(edge.source_id, edge.relation, edge.target_id),
                "source": edge.source_id,
                "target": edge.target_id,
                "relation": edge.relation,
                "weight": edge.weight,
                "attributes": edge.attributes,
            }
            for edge in self.edges
        ]
        return {"nodes": nodes, "edges": edges}

    def stats(self) -> dict[str, int]:
        return {
            "node_count": len(self.nodes),
            "edge_count": len(self.edges),
        }

    def save(self, path: str | Path) -> None:
        payload = {
            "nodes": [
                {
                    "node_id": node.node_id,
                    "label": node.label,
                    "node_type": node.node_type,
                    "attributes": node.attributes,
                }
                for node in self.nodes.values()
            ],
            "edges": [
                {
                    "source_id": edge.source_id,
                    "relation": edge.relation,
                    "target_id": edge.target_id,
                    "weight": edge.weight,
                    "attributes": edge.attributes,
                }
                for edge in self.edges
            ],
        }
        Path(path).write_text(json.dumps(payload, indent=2), encoding="utf-8")

    @classmethod
    def load(cls, path: str | Path) -> "GraphMemory":
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        graph = cls()
        for node in payload.get("nodes", []):
            graph.upsert_node(
                node["node_id"],
                node["label"],
                node["node_type"],
                node.get("attributes", {}),
            )
        for edge in payload.get("edges", []):
            graph.add_edge(
                edge["source_id"],
                edge["relation"],
                edge["target_id"],
                weight=edge.get("weight", 1.0),
                attributes=edge.get("attributes", {}),
            )
        return graph
