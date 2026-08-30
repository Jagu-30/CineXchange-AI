from cinex.schemas.agents import CATEGORIES

# The category walk-through is load-bearing, not decoration. An earlier version
# of this prompt simply asked the model to "break this into requirements", and
# it returned a single camera line for a brief implying seven, roughly one run
# in three - finish_reason was STOP every time, so this was the model deciding
# it was done, not truncation. Forcing an explicit pass over all six categories
# took the observed minimum from 1 requirement to 7.
DECOMPOSE = """You are a film production line producer converting a brief into a complete procurement list.

Brief:
{text}

Budget cap: {budget_cap}
Location: {location}
Shoot dates: {start_date} to {end_date}

Work through ALL SIX categories below IN ORDER. For each one, decide whether this shoot
needs it, and if so emit one or more requirements for it. A multi-day shoot on location
normally needs something in nearly every category.

  1. camera     - bodies, lenses, support, lighting
  2. crew       - every role the brief implies, one requirement per distinct role
  3. location   - the site itself, and any site fees
  4. transport  - moving crew and equipment
  5. insurance  - production cover; a location shoot with equipment almost always needs it
  6. permit     - filming permits; a public location shoot needs one

Rules:
- category MUST be exactly one of: {categories}
- Infer what a real shoot needs even when the brief leaves it implicit. Aerial shots imply
  a certified drone operator. A public riverside location implies a municipal permit.
- For crew, set "role" to the specific role, and set requires_certification to true for any
  role legally requiring a licence (drone operator, pyrotechnics, stunts, underwater).
  Leave "role" empty for non-crew categories.
- Put every other specific (model, lens, capacity, dates, permit authority) into "details"
  as key/value pairs.
- priority 1 if the shoot cannot happen without it, 3 for nice-to-have.
- Do not invent a line for something the brief explicitly rules out.

Return JSON only."""


def build(text: str, budget_cap: str, location: str, start_date: str, end_date: str) -> str:
    return DECOMPOSE.format(
        text=text,
        budget_cap=budget_cap,
        location=location,
        start_date=start_date,
        end_date=end_date,
        categories=", ".join(CATEGORIES),
    )
