from __future__ import annotations

import re
from dataclasses import dataclass

from .models import Task


FLIGHT_PATTERN = re.compile(
    r"(?:book|find|search|plan|get)?\s*(?:me\s+)?(?:a\s+)?flight\s+from\s+(?P<origin>.+?)\s+to\s+(?P<destination>.+?)(?:[.!?]|$)",
    re.IGNORECASE,
)


@dataclass(slots=True)
class ParsedIntent:
    intent: str
    task: Task
    explanation: str


class CommandParser:
    def parse(self, command: str) -> ParsedIntent:
        cleaned = " ".join(command.strip().split())
        if not cleaned:
            raise ValueError("Please enter a command for the browser agent.")

        if "deal" in cleaned.lower():
            return ParsedIntent(
                intent="open_deals",
                task=Task(
                    goal="Open the travel deals page.",
                    required_inputs={},
                    success_screen_id="deals_page",
                ),
                explanation="Matched a travel deals browsing command.",
            )

        if "booking" in cleaned.lower():
            return ParsedIntent(
                intent="open_bookings",
                task=Task(
                    goal="Open the bookings dashboard.",
                    required_inputs={},
                    success_screen_id="bookings_page",
                ),
                explanation="Matched a bookings dashboard command.",
            )

        match = FLIGHT_PATTERN.search(cleaned)
        if match:
            origin = self._title_case(match.group("origin"))
            destination = self._title_case(match.group("destination"))
            return ParsedIntent(
                intent="book_flight",
                task=Task(
                    goal="Reach the final booking confirmation page for a flight search.",
                    required_inputs={
                        "from_city": origin,
                        "to_city": destination,
                    },
                    success_screen_id="confirmation_page",
                ),
                explanation="Matched a flight-booking command with origin and destination fields.",
            )

        raise ValueError(
            "I could not parse that command yet. Try something like 'book a flight from San Francisco to New York'."
        )

    def examples(self) -> list[str]:
        return [
            "Book a flight from San Francisco to New York",
            "Open travel deals",
            "Open my bookings",
        ]

    def _title_case(self, value: str) -> str:
        words = [word for word in value.strip().split() if word]
        return " ".join(word[:1].upper() + word[1:] for word in words)
