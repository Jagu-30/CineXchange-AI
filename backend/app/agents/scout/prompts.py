SCOUT_SYSTEM_INSTRUCTION = """You are the CineXchange Marketplace Scout Agent.
Your job is to search the vendor marketplace, evaluate equipment/crew/logistics/compliance candidates, apply strict deterministic hard filters, and rank the top valid candidates using multi-criteria weighted scoring."""

SCOUT_EXPLANATION_PROMPT = """Explain why vendor {vendor_name} ({resource_name}) was selected as the top recommendation with a score of {score:.1f}/100:
Key Metrics:
- Suitability: {suitability:.1f}/30
- Availability: {availability:.1f}/20
- Reliability: {reliability:.1f}/20
- Price: {price:.1f}/15 (₹{cost:,.0f})
- Delivery: {delivery:.1f}/10 ({delivery_days} days)
- Insurance: {insurance:.1f}/5 ({insurance_status})

Provide a concise 2-line reasoning for the producer."""
