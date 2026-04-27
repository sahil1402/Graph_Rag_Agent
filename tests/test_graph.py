from __future__ import annotations

import unittest
from pathlib import Path

from graphrag_agent.graph import GraphMemory


class GraphMemoryTests(unittest.TestCase):
    def test_multi_hop_retrieval_surfaces_connected_facts(self) -> None:
        memory = GraphMemory()
        memory.upsert_node("slack", "Slack", "company")
        memory.upsert_node("salesforce", "Salesforce", "company")
        memory.upsert_node("marc_benioff", "Marc Benioff", "person")
        memory.add_edge("slack", "acquired_by", "salesforce")
        memory.add_edge("salesforce", "ceo", "marc_benioff")

        result = memory.retrieve(
            "Who is the CEO of the company that acquired Slack?",
            max_hops=2,
            limit=6,
        )

        self.assertIn("slack", result.node_ids)
        self.assertIn("salesforce", result.node_ids)
        self.assertIn("Marc Benioff", " ".join(result.summary_lines))

    def test_save_and_load_round_trip(self) -> None:
        memory = GraphMemory()
        memory.upsert_node("planner_page", "Flight Planner", "screen", {"kind": "planner"})
        memory.upsert_node("plan_trip", "Plan Trip", "element", {"role": "link"})
        memory.add_edge("plan_trip", "leads_to", "planner_page")

        path = Path(__file__).resolve().parent / "_graph_round_trip.json"
        try:
            memory.save(path)
            loaded = GraphMemory.load(path)
        finally:
            path.unlink(missing_ok=True)

        self.assertIn("planner_page", loaded.nodes)
        self.assertEqual(loaded.nodes["planner_page"].label, "Flight Planner")
        self.assertEqual(len(loaded.outgoing("plan_trip", "leads_to")), 1)


if __name__ == "__main__":
    unittest.main()
