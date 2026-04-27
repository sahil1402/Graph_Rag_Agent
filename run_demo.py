from __future__ import annotations

from pathlib import Path

from graphrag_agent.agent import GraphRAGAgent
from graphrag_agent.environment import build_demo_environment
from graphrag_agent.models import Task


def print_episode(title: str, report) -> None:
    print(f"\n=== {title} ===")
    print(f"success: {report.success}")
    print(f"steps: {len(report.steps)}")
    for step in report.steps:
        print(f"\nStep {step.step_number}")
        print(f"screen: {step.observation_label}")
        print(f"context: {step.context_summary}")
        print(f"action: {step.action.kind} -> {step.action.target_id or '-'} {step.action.value or ''}".strip())
        print(f"result: {step.result_message}")


def main() -> None:
    task = Task(
        goal="Reach the final booking confirmation page for a flight search.",
        required_inputs={
            "from_city": "San Francisco",
            "to_city": "New York",
        },
        success_screen_id="confirmation_page",
    )

    agent = GraphRAGAgent()

    first_env = build_demo_environment()
    first_report = agent.run(task, first_env)
    print_episode("Episode 1: exploration", first_report)

    second_env = build_demo_environment()
    second_report = agent.run(task, second_env)
    print_episode("Episode 2: memory reuse", second_report)

    graph_path = Path("graph_memory_snapshot.json")
    agent.memory.save(graph_path)
    print(f"\nSaved graph memory to {graph_path.resolve()}")


if __name__ == "__main__":
    main()
