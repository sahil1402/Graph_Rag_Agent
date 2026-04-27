from __future__ import annotations

import unittest

from graphrag_agent.agent import GraphRAGAgent
from graphrag_agent.environment import build_demo_environment
from graphrag_agent.models import Task


class GraphRAGAgentTests(unittest.TestCase):
    def test_agent_learns_a_faster_route_on_second_attempt(self) -> None:
        task = Task(
            goal="Reach the final booking confirmation page for a flight search.",
            required_inputs={"from_city": "San Francisco", "to_city": "New York"},
            success_screen_id="confirmation_page",
        )
        agent = GraphRAGAgent()

        first_report = agent.run(task, build_demo_environment())
        second_report = agent.run(task, build_demo_environment())

        self.assertTrue(first_report.success)
        self.assertTrue(second_report.success)
        self.assertGreater(len(first_report.steps), len(second_report.steps))

    def test_agent_records_discovered_navigation_edges(self) -> None:
        task = Task(
            goal="Reach the final booking confirmation page for a flight search.",
            required_inputs={"from_city": "San Francisco", "to_city": "New York"},
            success_screen_id="confirmation_page",
        )
        agent = GraphRAGAgent()
        agent.run(task, build_demo_environment())

        leads_to_edges = agent.memory.outgoing("plan_trip", "leads_to")
        targets = {edge.target_id for edge in leads_to_edges}
        self.assertIn("planner_page", targets)


if __name__ == "__main__":
    unittest.main()
