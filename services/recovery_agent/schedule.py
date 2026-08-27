"""Schedule collision detection. Pure, so the number shown to the producer is arguable."""
from datetime import date, timedelta


def find_collisions(blocked: list[str], start: date, end: date) -> list[str]:
    wanted = {start + timedelta(days=offset) for offset in range((end - start).days + 1)}
    hits = []
    for raw in blocked:
        try:
            parsed = date.fromisoformat(raw)
        except (ValueError, TypeError):
            continue
        if parsed in wanted:
            hits.append(parsed.isoformat())
    return sorted(hits)
