from decimal import Decimal

from services.scout_agent.ranking import score


def test_cheaper_scores_higher_all_else_equal():
    cheap = score(Decimal("100"), Decimal("4.0"), True, Decimal("100"))
    dear = score(Decimal("200"), Decimal("4.0"), True, Decimal("100"))
    assert cheap > dear


def test_better_rated_scores_higher_all_else_equal():
    good = score(Decimal("100"), Decimal("5.0"), True, Decimal("100"))
    poor = score(Decimal("100"), Decimal("3.0"), True, Decimal("100"))
    assert good > poor


def test_unavailable_is_penalised_below_any_available_option():
    unavailable = score(Decimal("100"), Decimal("5.0"), False, Decimal("100"))
    available_but_worse = score(Decimal("500"), Decimal("3.0"), True, Decimal("100"))
    assert available_but_worse > unavailable
