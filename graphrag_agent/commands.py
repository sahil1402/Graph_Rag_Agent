from __future__ import annotations

import re
from dataclasses import dataclass

from .models import Task


FLIGHT_PATTERN = re.compile(
    r"(?:book|find|search|plan|get)?\s*(?:me\s+)?(?:a\s+)?flight\s+from\s+(?P<origin>.+?)\s+to\s+(?P<destination>.+?)(?:[.!?]|$)",
    re.IGNORECASE,
)
SEARCH_PATTERN = re.compile(r"(?:search|look)\s+for\s+(?P<query>.+?)(?:[.!?]|$)", re.IGNORECASE)
EMAIL_PATTERN = re.compile(r"email(?:\s+is|\s*[:=])\s*(?P<value>\S+@\S+)", re.IGNORECASE)
PASSWORD_PATTERN = re.compile(r"password(?:\s+is|\s*[:=])\s*(?P<value>\S+)", re.IGNORECASE)
NAME_PATTERN = re.compile(r"name(?:\s+is|\s*[:=])\s*(?P<value>[A-Za-z][A-Za-z\s'-]+)", re.IGNORECASE)
PHONE_PATTERN = re.compile(r"phone(?:\s+is|\s*[:=])\s*(?P<value>[\d\-\+\(\)\s]{7,})", re.IGNORECASE)


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

        lowered = cleaned.lower()

        if "deal" in lowered:
            return ParsedIntent(
                intent="open_deals",
                task=Task(
                    goal="Open the travel deals page.",
                    required_inputs={},
                    success_screen_id="deals_page",
                ),
                explanation="Matched a travel deals browsing command.",
            )

        if "booking" in lowered or "reservation" in lowered:
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

        field_hints = self._extract_field_hints(cleaned)
        return ParsedIntent(
            intent="general_browser_task",
            task=Task(
                goal=cleaned,
                required_inputs=field_hints,
                success_screen_id="",
            ),
            explanation="Using generic browser-command parsing with heuristic field extraction.",
        )

    def examples(self) -> list[str]:
        return [
            "Book a flight from San Francisco to New York",
            "Open travel deals",
            "Search for graph rag tutorials",
            "Fill email is sahil@example.com and password is secret123",
        ]

    def _extract_field_hints(self, command: str) -> dict[str, str]:
        hints: dict[str, str] = {}

        search_match = SEARCH_PATTERN.search(command)
        if search_match:
            hints["search"] = search_match.group("query").strip()

        email_match = EMAIL_PATTERN.search(command)
        if email_match:
            hints["email"] = email_match.group("value").strip()

        password_match = PASSWORD_PATTERN.search(command)
        if password_match:
            hints["password"] = password_match.group("value").strip()

        name_match = NAME_PATTERN.search(command)
        if name_match:
            hints["name"] = self._title_case(name_match.group("value"))

        phone_match = PHONE_PATTERN.search(command)
        if phone_match:
            hints["phone"] = re.sub(r"\s+", " ", phone_match.group("value").strip())

        return hints

    def _title_case(self, value: str) -> str:
        words = [word for word in value.strip().split() if word]
        return " ".join(word[:1].upper() + word[1:] for word in words)
