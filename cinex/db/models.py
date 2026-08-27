import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger, Boolean, Date, DateTime, ForeignKey, Identity, Index, Integer, Numeric, String,
    Text, func, text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

MONEY = Numeric(12, 2)


class Base(DeclarativeBase):
    pass


class TimestampedUUID:
    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Production(TimestampedUUID, Base):
    __tablename__ = "productions"
    producer_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    brief_text: Mapped[str] = mapped_column(Text, nullable=False)
    budget_cap: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    location: Mapped[str] = mapped_column(String(200), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft")
    current_step: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_cost: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)


class Requirement(TimestampedUUID, Base):
    __tablename__ = "requirements"
    production_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("productions.id"), nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    spec: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class Vendor(TimestampedUUID, Base):
    __tablename__ = "vendors"
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    rating: Mapped[Decimal] = mapped_column(Numeric(3, 2), nullable=False, default=Decimal("4.0"))
    base_price: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    availability_calendar: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    contact_meta: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)


class Offer(TimestampedUUID, Base):
    __tablename__ = "offers"
    requirement_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("requirements.id"), nullable=False)
    vendor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vendors.id"), nullable=False)
    price: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    terms: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    round: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_winner: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    __table_args__ = (Index("ix_offers_requirement_status", "requirement_id", "status"),)


class Booking(TimestampedUUID, Base):
    __tablename__ = "bookings"
    production_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("productions.id"), nullable=False)
    offer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("offers.id"), nullable=False)
    final_price: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="confirmed")
    booked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (Index("ix_bookings_production_status", "production_id", "status"),)


class ComplianceCheck(TimestampedUUID, Base):
    __tablename__ = "compliance_checks"
    production_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("productions.id"), nullable=True)
    booking_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("bookings.id"), nullable=True)
    check_type: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    evidence: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)


class Approval(TimestampedUUID, Base):
    __tablename__ = "approvals"
    production_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("productions.id"), nullable=False)
    requested_by_agent: Mapped[str] = mapped_column(String(64), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    threshold_breached: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    delta_amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal("0"))
    producer_decision: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RecoveryEvent(TimestampedUUID, Base):
    __tablename__ = "recovery_events"
    production_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("productions.id"), nullable=False)
    trigger: Mapped[str] = mapped_column(String(64), nullable=False)
    affected_booking_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bookings.id"), nullable=False)
    resolution_booking_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("bookings.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    timeline: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    __table_args__ = (
        Index(
            "uq_recovery_active_per_production",
            "production_id",
            unique=True,
            postgresql_where=text("status IN ('pending','in_progress','awaiting_approval')"),
        ),
    )


class AuditLog(TimestampedUUID, Base):
    __tablename__ = "audit_log"
    seq: Mapped[int] = mapped_column(BigInteger, Identity(always=True), nullable=False, unique=True)
    actor: Mapped[str] = mapped_column(String(64), nullable=False)
    action: Mapped[str] = mapped_column(String(128), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True), nullable=True)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    __table_args__ = (
        Index("ix_audit_entity", "entity_type", "entity_id", "seq"),
        Index("ix_audit_seq", "seq"),
    )
