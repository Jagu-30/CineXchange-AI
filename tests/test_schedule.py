# tests/test_schedule.py
from datetime import date

from services.recovery_agent.schedule import find_collisions


def test_no_collision_when_calendar_is_clear():
    assert find_collisions([], date(2026, 9, 1), date(2026, 9, 3)) == []


def test_reports_each_blocked_day_inside_the_window():
    collisions = find_collisions(
        ["2026-09-02", "2026-09-09"], date(2026, 9, 1), date(2026, 9, 3)
    )
    assert collisions == ["2026-09-02"]


def test_window_is_inclusive_of_both_ends():
    collisions = find_collisions(
        ["2026-09-01", "2026-09-03"], date(2026, 9, 1), date(2026, 9, 3)
    )
    assert collisions == ["2026-09-01", "2026-09-03"]


def test_malformed_dates_are_ignored_rather_than_crashing_a_recovery():
    assert find_collisions(["not-a-date"], date(2026, 9, 1), date(2026, 9, 3)) == []
