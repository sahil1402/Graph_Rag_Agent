from __future__ import annotations

from dataclasses import dataclass, field

from .models import ActionResult, Observation, ToolAction, VisualElement


@dataclass(slots=True)
class PageElement:
    element_id: str
    label: str
    role: str
    description: str = ""
    target_page_id: str | None = None
    input_key: str | None = None


@dataclass(slots=True)
class DemoPage:
    page_id: str
    title: str
    description: str
    elements: list[PageElement] = field(default_factory=list)


class DemoWebEnvironment:
    def __init__(self, pages: dict[str, DemoPage], *, start_page_id: str) -> None:
        self.pages = pages
        self.start_page_id = start_page_id
        self.current_page_id = start_page_id
        self.field_values: dict[str, str] = {}

    def reset(self) -> None:
        self.current_page_id = self.start_page_id
        self.field_values.clear()

    def current_page(self) -> DemoPage:
        return self.pages[self.current_page_id]

    def observe(self) -> Observation:
        page = self.current_page()
        elements = [
            VisualElement(
                element_id=element.element_id,
                label=element.label,
                role=element.role,
                description=element.description,
                input_key=element.input_key,
                value=self.field_values.get(element.input_key or "", ""),
            )
            for element in page.elements
        ]

        filled_fields = ", ".join(
            f"{key}={value}" for key, value in sorted(self.field_values.items()) if value
        ) or "none"
        text_summary = f"{page.title}. {page.description}. Filled fields: {filled_fields}."
        visual_summary = f"Visible elements: {', '.join(element.label for element in page.elements)}"

        return Observation(
            screen_id=page.page_id,
            screen_label=page.title,
            text_summary=text_summary,
            visual_summary=visual_summary,
            elements=elements,
        )

    def execute(self, action: ToolAction, *, success_screen_id: str) -> ActionResult:
        page = self.current_page()
        element = next((item for item in page.elements if item.element_id == action.target_id), None)

        if action.kind == "stop":
            return ActionResult(
                success=self.current_page_id == success_screen_id,
                message="Agent stopped.",
                next_screen_id=self.current_page_id,
                done=self.current_page_id == success_screen_id,
            )

        if element is None:
            return ActionResult(
                success=False,
                message=f"Element {action.target_id!r} is not visible on this page.",
                next_screen_id=self.current_page_id,
            )

        if action.kind == "type":
            if element.role != "input" or not element.input_key:
                return ActionResult(
                    success=False,
                    message=f"{element.label} is not a text input.",
                    next_screen_id=self.current_page_id,
                )
            self.field_values[element.input_key] = action.value or ""
            return ActionResult(
                success=True,
                message=f"Filled {element.label} with {action.value!r}.",
                next_screen_id=self.current_page_id,
            )

        if action.kind == "click":
            if element.element_id == "search_flights":
                from_city = self.field_values.get("from_city", "").strip()
                to_city = self.field_values.get("to_city", "").strip()
                if not from_city or not to_city:
                    return ActionResult(
                        success=False,
                        message="The search form is incomplete.",
                        next_screen_id=self.current_page_id,
                    )
                self.current_page_id = "results_page"
                return ActionResult(
                    success=True,
                    message="Opened the flight results page.",
                    next_screen_id=self.current_page_id,
                )

            if element.target_page_id is None:
                return ActionResult(
                    success=False,
                    message=f"{element.label} does not navigate anywhere.",
                    next_screen_id=self.current_page_id,
                )

            self.current_page_id = element.target_page_id
            return ActionResult(
                success=True,
                message=f"Navigated to {self.pages[self.current_page_id].title}.",
                next_screen_id=self.current_page_id,
                done=self.current_page_id == success_screen_id,
            )

        return ActionResult(
            success=False,
            message=f"Unknown action kind: {action.kind}.",
            next_screen_id=self.current_page_id,
        )


def build_demo_environment() -> DemoWebEnvironment:
    pages = {
        "home_page": DemoPage(
            page_id="home_page",
            title="Travel Portal Home",
            description="A landing page with shortcuts into different travel flows.",
            elements=[
                PageElement(
                    element_id="weekly_deals",
                    label="Travel Deals",
                    role="link",
                    description="Browse discounted packages and seasonal offers.",
                    target_page_id="deals_page",
                ),
                PageElement(
                    element_id="plan_trip",
                    label="Plan Trip",
                    role="link",
                    description="Open the full travel planner for flights, hotels, and cars.",
                    target_page_id="planner_page",
                ),
                PageElement(
                    element_id="my_bookings",
                    label="My Bookings",
                    role="link",
                    description="Review existing reservations and receipts.",
                    target_page_id="bookings_page",
                ),
            ],
        ),
        "deals_page": DemoPage(
            page_id="deals_page",
            title="Weekly Travel Deals",
            description="Promotional offers, banners, and limited-time discounts.",
            elements=[
                PageElement(
                    element_id="back_home_from_deals",
                    label="Home",
                    role="link",
                    description="Return to the main portal.",
                    target_page_id="home_page",
                )
            ],
        ),
        "bookings_page": DemoPage(
            page_id="bookings_page",
            title="Bookings Dashboard",
            description="Past trips and invoices appear here.",
            elements=[
                PageElement(
                    element_id="back_home_from_bookings",
                    label="Home",
                    role="link",
                    description="Return to the main portal.",
                    target_page_id="home_page",
                )
            ],
        ),
        "planner_page": DemoPage(
            page_id="planner_page",
            title="Flight Planner",
            description="A search form for building a new flight itinerary.",
            elements=[
                PageElement(
                    element_id="from_city_input",
                    label="From City",
                    role="input",
                    description="Origin airport or city.",
                    input_key="from_city",
                ),
                PageElement(
                    element_id="to_city_input",
                    label="To City",
                    role="input",
                    description="Destination airport or city.",
                    input_key="to_city",
                ),
                PageElement(
                    element_id="search_flights",
                    label="Search Flights",
                    role="button",
                    description="Run the itinerary search.",
                ),
            ],
        ),
        "results_page": DemoPage(
            page_id="results_page",
            title="Flight Results",
            description="Search results for the requested itinerary.",
            elements=[
                PageElement(
                    element_id="open_confirmation",
                    label="Continue to Confirmation",
                    role="button",
                    description="Open the final booking confirmation page.",
                    target_page_id="confirmation_page",
                )
            ],
        ),
        "confirmation_page": DemoPage(
            page_id="confirmation_page",
            title="Booking Confirmation",
            description="The final confirmation screen with itinerary details.",
            elements=[],
        ),
    }

    return DemoWebEnvironment(pages, start_page_id="home_page")
