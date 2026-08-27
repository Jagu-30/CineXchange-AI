"""The one definition of a production's total cost.

The orchestrator summed winning offers; the recovery agent summed confirmed
bookings. The two agree only while every winner has exactly one confirmed
booking at an identical price, so after a recovery the producer's approved
number could be silently rewritten by a different rule than the one it was
approved against.

Winning offers is the definition that survives, for one structural reason: the
happy path has to know the total at step 7, which is *before* any booking row
exists (nothing may be booked while an approval is pending). A bookings-based
rule cannot answer that question at all. Recovery flips ``is_winner`` on the
superseded offer as part of the swap, so the winning-offer set stays correct
across a recovery too.
"""
import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cinex.db.models import Offer, Requirement


async def total_cost(session: AsyncSession, production_id: uuid.UUID) -> Decimal:
    """Sum the price of every winning offer across the production's requirements."""
    requirement_ids = (await session.execute(
        select(Requirement.id).where(Requirement.production_id == production_id)
    )).scalars().all()
    if not requirement_ids:
        return Decimal("0")
    winners = (await session.execute(
        select(Offer.price).where(
            Offer.requirement_id.in_(requirement_ids), Offer.is_winner.is_(True)
        )
    )).scalars().all()
    return sum(winners, Decimal("0"))
