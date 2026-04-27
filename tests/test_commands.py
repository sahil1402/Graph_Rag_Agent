from __future__ import annotations

import unittest

from graphrag_agent.commands import CommandParser


class CommandParserTests(unittest.TestCase):
    def test_parses_flight_command(self) -> None:
        parser = CommandParser()
        parsed = parser.parse("Book a flight from San Francisco to New York")

        self.assertEqual(parsed.intent, "book_flight")
        self.assertEqual(parsed.task.required_inputs["from_city"], "San Francisco")
        self.assertEqual(parsed.task.required_inputs["to_city"], "New York")
        self.assertEqual(parsed.task.success_screen_id, "confirmation_page")

    def test_parses_deals_command(self) -> None:
        parser = CommandParser()
        parsed = parser.parse("Open travel deals")

        self.assertEqual(parsed.intent, "open_deals")
        self.assertEqual(parsed.task.success_screen_id, "deals_page")


if __name__ == "__main__":
    unittest.main()
