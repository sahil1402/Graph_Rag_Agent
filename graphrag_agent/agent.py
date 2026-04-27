from __future__ import annotations

from dataclasses import dataclass

from .environment import DemoWebEnvironment
from .graph import GraphMemory, normalize_tokens
from .models import AgentRunReport, AgentStep, Observation, RetrievalResult, Task, ToolAction


@dataclass(slots=True)
class PlannerState:
    tried_actions: set[tuple[str, str]]


class GraphRAGAgent:
    def __init__(self, memory: GraphMemory | None = None, *, max_steps: int = 12) -> None:
        self.memory = memory or GraphMemory()
        self.max_steps = max_steps

    def run(self, task: Task, environment: DemoWebEnvironment) -> AgentRunReport:
        steps: list[AgentStep] = []
        planner_state = PlannerState(tried_actions=set())
        transitions: list[tuple[str, ToolAction, str]] = []

        for step_number in range(1, self.max_steps + 1):
            observation = environment.observe()
            self.memory.remember_observation(observation)

            if observation.screen_id == task.success_screen_id:
                break

            retrieval = self.memory.retrieve(
                self._task_query(task),
                current_screen_id=observation.screen_id,
            )
            action = self._choose_action(task, observation, retrieval, planner_state)
            result = environment.execute(action, success_screen_id=task.success_screen_id)
            self.memory.record_transition(
                observation.screen_id,
                action,
                result.next_screen_id,
                message=result.message,
            )
            transitions.append((observation.screen_id, action, result.next_screen_id))
            if action.target_id:
                planner_state.tried_actions.add((observation.screen_id, action.target_id))

            context_summary = "; ".join(retrieval.summary_lines[:3]) or "No graph context yet."
            steps.append(
                AgentStep(
                    step_number=step_number,
                    screen_id=observation.screen_id,
                    observation_label=observation.screen_label,
                    observation_summary=observation.text_summary,
                    visible_elements=[element.label for element in observation.elements],
                    context_summary=context_summary,
                    retrieval_lines=retrieval.summary_lines[:4],
                    action=action,
                    action_reason=action.reason,
                    result_message=result.message,
                    next_screen_id=result.next_screen_id,
                )
            )

            if result.done:
                break

        final_observation = environment.observe()
        self.memory.remember_observation(final_observation)
        final_screen_id = final_observation.screen_id
        success = final_screen_id == task.success_screen_id
        if success:
            self.memory.reinforce_successful_path(transitions, goal_screen_id=task.success_screen_id)

        return AgentRunReport(
            goal=task.goal,
            success=success,
            steps=steps,
            final_screen_id=final_screen_id,
            final_observation=final_observation,
        )

    def _task_query(self, task: Task) -> str:
        joined_inputs = " ".join(task.required_inputs.values())
        return f"{task.goal} {joined_inputs}".strip()

    def _choose_action(
        self,
        task: Task,
        observation: Observation,
        retrieval: RetrievalResult,
        planner_state: PlannerState,
    ) -> ToolAction:
        for element in observation.elements:
            if element.role == "input" and element.input_key:
                required_value = task.required_inputs.get(element.input_key)
                if required_value and element.value != required_value:
                    return ToolAction(
                        kind="type",
                        target_id=element.element_id,
                        value=required_value,
                        reason=f"Need to fill {element.label} before progressing.",
                    )

        clickable = [element for element in observation.elements if element.role in {"link", "button"}]
        if not clickable:
            return ToolAction(kind="stop", reason="No visible tool actions remain.")

        scored: list[tuple[float, str]] = []
        goal_tokens = normalize_tokens(self._task_query(task))

        for element in clickable:
            score = float(len(goal_tokens & normalize_tokens(element.label)))

            if element.element_id in retrieval.seed_node_ids or element.element_id in retrieval.node_ids:
                score += 0.75

            for edge in self.memory.outgoing(element.element_id, "leads_to"):
                destination = self.memory.get_node(edge.target_id)
                if destination is None:
                    continue
                destination_tokens = normalize_tokens(
                    " ".join([destination.label, *(str(value) for value in destination.attributes.values())])
                )
                score += 3.0 * len(goal_tokens & destination_tokens)

                distance_to_goal = self.memory.shortest_path_length(
                    destination.node_id,
                    task.success_screen_id,
                    relations={"contains", "leads_to"},
                )
                if distance_to_goal is not None:
                    score += max(0.0, 5.5 - distance_to_goal)

                score += 2.5 * self.memory.edge_metric(
                    element.element_id,
                    "leads_to",
                    destination.node_id,
                    "success_count",
                )

            score += 1.5 * self.memory.edge_metric(
                observation.screen_id,
                "clicked",
                element.element_id,
                "success_count",
            )

            if (observation.screen_id, element.element_id) in planner_state.tried_actions:
                score -= 2.0

            scored.append((score, element.element_id))

        scored.sort(key=lambda item: (-item[0], item[1]))
        best_score, best_element_id = scored[0]

        if best_score <= 0:
            untried = [
                element
                for element in clickable
                if (observation.screen_id, element.element_id) not in planner_state.tried_actions
            ]
            if untried:
                best_element_id = untried[0].element_id

        return ToolAction(
            kind="click",
            target_id=best_element_id,
            reason="Selected using graph-aware action ranking with memory reinforcement.",
        )
