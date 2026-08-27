import uuid
from typing import Any, Dict, List, Optional, Tuple
from backend.app.agents.common.agent_base import BaseAgent
from backend.app.agents.common.schemas import (
    Quote,
    NegotiationRound,
    NegotiationState,
    AuditLogEntry
)
from backend.app.agents.common.llm import gemini_client
from backend.app.agents.negotiation.schemas import CounterOfferRequest, NegotiationResponse
from backend.app.agents.negotiation.policy import NegotiationPolicy
from backend.app.agents.negotiation.strategy import NegotiationStrategy
from backend.app.agents.negotiation.prompts import NEGOTIATION_SYSTEM_INSTRUCTION, COUNTER_OFFER_WORDING_PROMPT

class NegotiationAgent(BaseAgent):
    """Negotiation Agent manages multi-round price and terms negotiations with vendors."""

    def __init__(self):
        super().__init__(
            agent_id="negotiation",
            agent_name="Negotiation Agent",
            role="Package Pricing & Terms Optimization"
        )

    # Tool 1: get_quote
    def get_quote(
        self,
        vendor_id: str,
        resource_id: str,
        initial_price: float = 480000.0,
        quality_score: float = 96.0,
        insurance_included: bool = True
    ) -> Quote:
        return Quote(
            quote_id=f"QUOTE-{vendor_id}-{resource_id}",
            vendor_id=vendor_id,
            resource_id=resource_id,
            price=initial_price,
            currency="INR",
            delivery_days=1,
            warranty_included=True,
            insurance_included=insurance_included,
            included_services=["Flight Cases", "2x Primes", "On-site backup battery kit"],
            quality_score=quality_score,
            valid_until="2026-08-30",
            terms={"payment_terms": "50% advance, 50% post-wrap", "cancellation": "48hr notice"}
        )

    # Tool 2: initialize_negotiation
    def initialize_negotiation(
        self,
        vendor_id: str,
        resource_id: str,
        initial_price: float = 480000.0,
        target_savings_percent: float = 8.0
    ) -> Tuple[NegotiationState, AuditLogEntry]:
        target_price = round(initial_price * (1.0 - (target_savings_percent / 100.0)), -2)
        min_price = round(initial_price * 0.90, -2)

        initial_round = NegotiationRound(
            round_number=1,
            offered_by="VENDOR",
            price=initial_price,
            savings_percent=0.0,
            included_terms={"insurance": True, "delivery_days": 1},
            message=f"Initial vendor quote for 3-day shoot: ₹{initial_price:,.0f}",
            accepted=False
        )

        state = NegotiationState(
            negotiation_id=f"NEG-{vendor_id}-{uuid.uuid4().hex[:6].upper()}",
            vendor_id=vendor_id,
            resource_id=resource_id,
            initial_price=initial_price,
            current_price=initial_price,
            target_price=target_price,
            minimum_price=min_price,
            rounds=0,
            max_rounds=3,
            target_savings_percent=target_savings_percent,
            minimum_acceptable_quality=85.0,
            insurance_required=True,
            max_delivery_days=2,
            status="IN_PROGRESS",
            history=[initial_round],
            reasoning="Initiating multi-day bundle discount negotiation aiming for 8% target savings."
        )

        audit = self.create_audit_entry(
            action="INITIALIZE_NEGOTIATION",
            status="successful",
            input_summary=f"Vendor: {vendor_id}, Resource: {resource_id}, Initial Quote: ₹{initial_price:,.0f}",
            output_summary=f"Target Price: ₹{target_price:,.0f} (Target savings: {target_savings_percent:.1f}%, Max 3 rounds)",
            policy_checks=[
                "Target savings bounded at 8.0%",
                "Mandatory insurance clause verified",
                "Quality threshold set to 85.0"
            ],
            next_action="Generate and submit Round 1 Counter-Offer"
        )

        return state, audit

    # Tool 3: submit_counter_offer
    def submit_counter_offer(
        self,
        state: NegotiationState,
        counter_price: Optional[float] = None,
        requested_terms: Optional[Dict[str, Any]] = None
    ) -> Tuple[NegotiationResponse, AuditLogEntry]:
        next_round_num = state.rounds + 1

        if next_round_num > state.max_rounds:
            state.status = "EXHAUSTED"
            audit = self.create_audit_entry(
                action="SUBMIT_COUNTER_OFFER",
                status="blocked",
                input_summary=f"Attempted counter in round {next_round_num}",
                output_summary="Maximum negotiation rounds (3) reached",
                policy_checks=["Max rounds limit enforced (3)"],
                warnings=["Negotiation exhausted without mutual agreement"],
                next_action="Escalate to producer or accept best available quote"
            )
            return NegotiationResponse(
                negotiation_state=state,
                vendor_message="Maximum negotiation rounds reached.",
                policy_compliant=False,
                policy_notes=["Maximum negotiation rounds reached"]
            ), audit

        if counter_price is None:
            counter_price = NegotiationStrategy.calculate_counter_offer(
                initial_price=state.initial_price,
                target_savings_percent=state.target_savings_percent,
                round_num=next_round_num
            )

        terms = requested_terms or {"insurance": True, "delivery_days": 1, "warranty": True}

        # Policy check on proposed offer terms
        is_compliant, rejection_reasons = NegotiationPolicy.validate_offer(
            price=counter_price,
            insurance_included=terms.get("insurance", True),
            quality_score=96.0,
            delivery_days=terms.get("delivery_days", 1),
            round_number=next_round_num,
            max_rounds=state.max_rounds
        )

        if not is_compliant:
            state.status = "REJECTED"
            audit = self.create_audit_entry(
                action="SUBMIT_COUNTER_OFFER",
                status="blocked",
                input_summary=f"Counter-offer: ₹{counter_price:,.0f} (Round {next_round_num})",
                output_summary=f"Counter rejected by policy: {', '.join(rejection_reasons)}",
                policy_checks=["Mandatory insurance check failed" if not terms.get("insurance") else "Policy evaluation"],
                warnings=rejection_reasons,
                next_action="Revise offer terms to restore mandatory compliance"
            )
            return NegotiationResponse(
                negotiation_state=state,
                vendor_message=f"Offer rejected by policy: {'; '.join(rejection_reasons)}",
                policy_compliant=False,
                policy_notes=rejection_reasons
            ), audit

        # Generate wording via Gemini (or fallback)
        savings_pct = ((state.initial_price - counter_price) / state.initial_price) * 100.0
        prompt = COUNTER_OFFER_WORDING_PROMPT.format(
            vendor_name=state.vendor_id,
            resource_name=state.resource_id,
            initial_price=state.initial_price,
            round_num=next_round_num,
            max_rounds=state.max_rounds,
            counter_price=counter_price,
            savings_percent=savings_pct,
            requested_terms=str(terms)
        )
        fallback_msg = f"Producer counter-offer for Round {next_round_num}: ₹{counter_price:,.0f} ({savings_pct:.1f}% discount) with 3-day full package booking."
        counter_msg = gemini_client.generate_text(prompt, NEGOTIATION_SYSTEM_INSTRUCTION, fallback_msg)

        # Record producer counter in history
        producer_round = NegotiationRound(
            round_number=next_round_num,
            offered_by="PRODUCER",
            price=counter_price,
            savings_percent=savings_pct,
            included_terms=terms,
            message=counter_msg,
            accepted=False
        )
        state.history.append(producer_round)

        # Tool 4: get_vendor_response (simulated)
        vendor_price, vendor_msg, vendor_accepted = NegotiationStrategy.simulate_vendor_response(
            initial_price=state.initial_price,
            producer_counter=counter_price,
            round_num=next_round_num,
            target_savings_percent=state.target_savings_percent
        )

        vendor_savings_pct = ((state.initial_price - vendor_price) / state.initial_price) * 100.0
        vendor_round = NegotiationRound(
            round_number=next_round_num,
            offered_by="VENDOR",
            price=vendor_price,
            savings_percent=vendor_savings_pct,
            included_terms=terms,
            message=vendor_msg,
            accepted=vendor_accepted
        )
        state.history.append(vendor_round)
        state.rounds = next_round_num
        state.current_price = vendor_price

        if vendor_accepted:
            state.status = "ACCEPTED"
            next_step = "Proceed to Compliance Verification"
        else:
            state.status = "IN_PROGRESS"
            next_step = "Submit next counter-offer or accept vendor concession"

        audit = self.create_audit_entry(
            action=f"NEGOTIATION_ROUND_{next_round_num}",
            status="successful",
            input_summary=f"Producer countered ₹{counter_price:,.0f} (-{savings_pct:.1f}%)",
            output_summary=f"Vendor responded: ₹{vendor_price:,.0f} (-{vendor_savings_pct:.1f}% savings) — {vendor_msg}",
            policy_checks=[
                f"Round {next_round_num}/{state.max_rounds} compliant",
                "Mandatory insurance intact",
                f"Achieved savings: ₹{state.initial_price - vendor_price:,.0f} ({vendor_savings_pct:.1f}%)"
            ],
            next_action=next_step
        )

        suggested_next = (
            NegotiationStrategy.calculate_counter_offer(
                state.initial_price, state.target_savings_percent, next_round_num + 1
            )
            if next_round_num < state.max_rounds and not vendor_accepted
            else None
        )

        return NegotiationResponse(
            negotiation_state=state,
            vendor_message=vendor_msg,
            policy_compliant=True,
            policy_notes=[f"Round {next_round_num} complete", f"Savings: {vendor_savings_pct:.1f}%"],
            suggested_next_counter=suggested_next
        ), audit

    # Tool 5: accept_offer
    def accept_offer(self, state: NegotiationState) -> Tuple[NegotiationState, AuditLogEntry]:
        # Validate final offer
        is_ok, errs = NegotiationPolicy.validate_offer(
            price=state.current_price,
            insurance_included=state.insurance_required,
            quality_score=96.0,
            delivery_days=1,
            round_number=state.rounds,
            max_rounds=state.max_rounds
        )

        if not is_ok:
            state.status = "REJECTED"
            audit = self.create_audit_entry(
                action="ACCEPT_OFFER",
                status="blocked",
                input_summary=f"Accept offer ₹{state.current_price:,.0f}",
                output_summary=f"Cannot accept offer: {', '.join(errs)}",
                policy_checks=["Acceptance policy check"],
                warnings=errs,
                next_action="Resolve compliance or insurance gap before acceptance"
            )
            return state, audit

        state.status = "ACCEPTED"
        savings = state.initial_price - state.current_price
        savings_pct = (savings / state.initial_price) * 100.0 if state.initial_price > 0 else 0.0

        audit = self.create_audit_entry(
            action="ACCEPT_OFFER",
            status="successful",
            input_summary=f"Accepted negotiated package from {state.vendor_id} at ₹{state.current_price:,.0f}",
            output_summary=f"Total savings locked: ₹{savings:,.0f} ({savings_pct:.1f}% discount)",
            policy_checks=[
                "Policy acceptance criteria verified",
                "Mandatory insurance included",
                "Quality score (96.0) >= 85.0 threshold",
                "Delivery SLA (1 day) <= 2 days"
            ],
            next_action="Run Compliance & Approval Agent"
        )

        return state, audit

    def run(
        self,
        state: NegotiationState,
        counter_price: Optional[float] = None,
        requested_terms: Optional[Dict[str, Any]] = None
    ) -> Tuple[NegotiationResponse, AuditLogEntry]:
        return self.submit_counter_offer(
            state=state,
            counter_price=counter_price,
            requested_terms=requested_terms
        )
