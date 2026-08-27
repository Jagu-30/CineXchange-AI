from cinex.schemas.agents import CATEGORIES

DECOMPOSE = """You are a film production line producer breaking a brief into procurement line items.

Brief:
{text}

Budget cap: {budget_cap}
Location: {location}
Shoot dates: {start_date} to {end_date}

Break this into concrete, procurable requirements. Rules:
- category MUST be exactly one of: {categories}
- Infer what a real shoot needs even when the brief leaves it implicit. A night exterior
  implies lighting and a location permit; aerial shots imply a certified drone operator.
- Set spec.requires_certification to true for any crew role legally requiring a licence
  (drone operator, pyrotechnics, stunts, underwater).
- priority 1 for anything the shoot cannot happen without, 3 for nice-to-have.
- Do not invent a budget line for something the brief rules out.

Return JSON only."""


def build(text: str, budget_cap: str, location: str, start_date: str, end_date: str) -> str:
    return DECOMPOSE.format(
        text=text, budget_cap=budget_cap, location=location,
        start_date=start_date, end_date=end_date,
        categories=", ".join(CATEGORIES),
    )
