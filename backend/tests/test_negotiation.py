import pytest
from backend.app.agents.negotiation.agent import NegotiationAgent
from backend.app.agents.negotiation.policy import NegotiationPolicy

def test_negotiation_multi_round_flow():
    agent = NegotiationAgent()
    init_state, audit = agent.initialize_negotiation(
        vendor_id="V003",
        resource_id="CAM-002",
        initial_price=480000.0,
        target_savings_percent=8.0
    )
    assert init_state.current_price == 480000.0
    assert init_state.target_price == 441600.0
    assert init_state.rounds == 0
    assert audit.status == "successful"

    # Round 1 Counter
    resp1, audit1 = agent.submit_counter_offer(init_state, counter_price=422400.0)
    assert resp1.policy_compliant is True
    assert resp1.negotiation_state.rounds == 1
    assert resp1.negotiation_state.current_price < 480000.0

    # Round 2 Counter
    resp2, audit2 = agent.submit_counter_offer(resp1.negotiation_state, counter_price=436800.0)
    assert resp2.negotiation_state.rounds == 2

    # Accept Offer
    accepted_state, accept_audit = agent.accept_offer(resp2.negotiation_state)
    assert accepted_state.status == "ACCEPTED"
    assert accept_audit.status == "successful"

def test_negotiation_reject_missing_insurance():
    agent = NegotiationAgent()
    init_state, _ = agent.initialize_negotiation("V003", "CAM-002", initial_price=480000.0)

    # Offer with insurance=False must be rejected by policy
    resp, audit = agent.submit_counter_offer(
        init_state,
        counter_price=400000.0,
        requested_terms={"insurance": False, "delivery_days": 1}
    )
    assert resp.policy_compliant is False
    assert any("insurance" in note.lower() for note in resp.policy_notes)

def test_negotiation_max_rounds_exhaustion():
    agent = NegotiationAgent()
    init_state, _ = agent.initialize_negotiation("V003", "CAM-002", initial_price=480000.0)
    init_state.rounds = 3  # already maxed

    resp, audit = agent.submit_counter_offer(init_state, counter_price=400000.0)
    assert resp.policy_compliant is False
    assert resp.negotiation_state.status == "EXHAUSTED"
