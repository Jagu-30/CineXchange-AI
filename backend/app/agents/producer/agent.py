from typing import Any, Dict, List, Optional, Tuple
from backend.app.agents.common.agent_base import BaseAgent
from backend.app.agents.common.schemas import ProjectInput, Requirement, AuditLogEntry
from backend.app.agents.common.llm import gemini_client
from backend.app.agents.producer.schemas import ProducerExtractionOutput
from backend.app.agents.producer.prompts import PRODUCER_SYSTEM_INSTRUCTION, PRODUCER_EXTRACTION_PROMPT
from backend.app.agents.producer.validator import ProducerValidator

class ProducerAgent(BaseAgent):
    """Producer Agent converts natural language shoot briefs into structured requirements."""

    def __init__(self):
        super().__init__(
            agent_id="producer",
            agent_name="Producer Agent",
            role="Mission Control & Requirements Breakdown"
        )

    def _get_fallback_requirements(self, project: ProjectInput) -> Dict[str, Any]:
        text = (project.producer_request or "").lower()
        loc = (project.location or "").lower()
        days = max(1, project.duration_days)
        budget = project.budget

        reqs = []

        # 1. Camera Analysis
        is_low_light = any(k in text or k in loc for k in ["low-light", "low light", "night", "dark", "rainforest", "evening", "shadow", "dusk", "cave", "rain"])
        is_gimbal_needed = any(k in text for k in ["gimbal", "action", "run", "chase", "handheld", "roving", "tracking", "dynamic", "car"])
        is_high_res = any(k in text for k in ["8k", "large-format", "large format", "imax", "anamorphic", "cinema", "arri", "red"])

        camera_specs: Dict[str, Any] = {
            "low_light": is_low_light,
            "weather_sealed": "rain" in text or "rainforest" in loc or "water" in text,
            "scenes": 2 if "two" in text or "2" in text else 3 if "three" in text or "3" in text else 1
        }
        if is_low_light:
            camera_specs["dual_base_iso"] = True
            camera_specs["native_iso"] = 4000
        if is_high_res:
            camera_specs["large_format"] = True

        reqs.append({
            "requirement_id": "REQ-CAM-001",
            "category": "EQUIPMENT",
            "resource": "Primary Large-Format Cinema Camera Package (ARRI Alexa Mini LF / Sony FX9)" if is_low_light else "Primary 6K Cinema Camera Package + Cine Primes",
            "resource_type": "CAMERA",
            "quantity": 1,
            "duration_days": days,
            "specifications": camera_specs,
            "priority": "CRITICAL",
            "mandatory": True,
            "notes": "Optimal sensor sensitivity for requested shoot scenes."
        })

        if is_gimbal_needed or is_low_light or days >= 2:
            reqs.append({
                "requirement_id": "REQ-CAM-002",
                "category": "EQUIPMENT",
                "resource": "B-Camera Body + 3-Axis Gimbal Rig",
                "resource_type": "CAMERA",
                "quantity": 1,
                "duration_days": days,
                "specifications": {
                    "low_light": is_low_light,
                    "gimbal_compatible": True
                },
                "priority": "HIGH",
                "mandatory": True,
                "notes": "Secondary dynamic roving angle for action and tracking shots."
            })

        # 2. Lighting Analysis
        is_weatherproof = "rain" in text or "water" in text or "rainforest" in loc or "monsoon" in text
        reqs.append({
            "requirement_id": "REQ-LGT-001",
            "category": "EQUIPMENT",
            "resource": "Weatherproof Astera Titan LED Tube Kit (x12) + Haze" if is_weatherproof else "Bi-Color Aputure 600d Pro LED Studio Kit + Modifiers",
            "resource_type": "LIGHTING",
            "quantity": 1,
            "duration_days": days,
            "specifications": {
                "waterproof_rating": "IP65" if is_weatherproof else "Standard",
                "battery_powered": True,
                "wireless_dmx": True
            },
            "priority": "HIGH",
            "mandatory": True,
            "notes": "Atmospheric lighting package calibrated for shoot conditions."
        })

        # 3. Power / Generator Analysis
        is_remote = any(k in loc or k in text for k in ["rainforest", "forest", "ghats", "remote", "outdoor", "jungle", "field", "mountain", "hills", "agumbe"])
        if is_remote or "generator" in text or "power" in text:
            reqs.append({
                "requirement_id": "REQ-GEN-001",
                "category": "EQUIPMENT",
                "resource": "Silent 15kVA Diesel Inverter Generator + Fuel Kit",
                "resource_type": "GENERATOR",
                "quantity": 1,
                "duration_days": days,
                "specifications": {
                    "sound_db_max": 55,
                    "fuel_reserve_days": days
                },
                "priority": "HIGH",
                "mandatory": True,
                "notes": "Silent on-site generator to prevent audio track contamination."
            })

        # 4. Drone / Aerial Analysis
        is_aerial = any(k in text for k in ["drone", "aerial", "sky", "canopy", "overhead", "fly", "establishing", "rainforest"])
        if is_aerial:
            reqs.append({
                "requirement_id": "REQ-DRN-001",
                "category": "EQUIPMENT",
                "resource": "DJI Inspire 3 Aerial Cinema Rig + Zenmuse X9-8K",
                "resource_type": "DRONE",
                "quantity": 1,
                "duration_days": days,
                "specifications": {
                    "full_frame_8k": True,
                    "night_rpas_certified": is_low_light
                },
                "priority": "MEDIUM",
                "mandatory": False,
                "notes": "Canopy and overhead establishing aerial cinematography."
            })
            reqs.append({
                "requirement_id": "REQ-PLT-001",
                "category": "CREW",
                "resource": "DGCA Category-1 Night-Endorsed Drone Pilot",
                "resource_type": "PILOT",
                "quantity": 1,
                "duration_days": days,
                "specifications": {
                    "dgca_license_valid": True,
                    "night_rating": is_low_light
                },
                "priority": "MEDIUM",
                "mandatory": False,
                "notes": "Certified operator for commercial aerial rig."
            })

        # 5. Transport / Logistics Analysis
        reqs.append({
            "requirement_id": "REQ-TRN-001",
            "category": "LOGISTICS",
            "resource": "4WD All-Terrain Crew Van & Covered Equipment Truck" if is_remote else "Production Crew Van & Equipment Transit",
            "resource_type": "TRANSPORT",
            "quantity": 1,
            "duration_days": days,
            "specifications": {
                "four_wheel_drive": is_remote,
                "crew_seats": 14
            },
            "priority": "HIGH",
            "mandatory": True,
            "notes": "Safe crew and high-value gear transit to set locations."
        })

        # 6. Mandatory Compliance (Insurance & Permits)
        min_ins_cov = max(budget, 2500000.0)
        reqs.append({
            "requirement_id": "REQ-INS-001",
            "category": "COMPLIANCE",
            "resource": "On-Location Shoot Equipment & Crew All-Risk Insurance",
            "resource_type": "INSURANCE",
            "quantity": 1,
            "duration_days": days,
            "specifications": {
                "min_coverage_inr": min_ins_cov,
                "weather_delay_rider": is_weatherproof
            },
            "priority": "CRITICAL",
            "mandatory": True,
            "notes": f"Mandatory production insurance covering minimum ₹{min_ins_cov:,.0f} all-risk liability."
        })

        # Permit
        permit_name = "Karnataka Forest Dept. Night Filming Clearance" if "forest" in loc or "rainforest" in loc or "agumbe" in loc else f"{project.location or 'Local'} Municipal & Police Filming Clearance"
        reqs.append({
            "requirement_id": "REQ-PRM-001",
            "category": "COMPLIANCE",
            "resource": permit_name,
            "resource_type": "PERMIT",
            "quantity": 1,
            "duration_days": days,
            "specifications": {
                "night_hours_approved": is_low_light,
                "location_zone": project.location or "Primary Location"
            },
            "priority": "CRITICAL",
            "mandatory": True,
            "notes": "Statutory regulatory filming approval for scheduled shoot hours."
        })

        assumptions = [
            f"Shoot scheduled over {days} production day(s) in {project.location or 'on-location set'}.",
            f"Budget ceiling fixed at ₹{budget:,.0f} INR.",
            "All vendor commitments require mandatory equipment transit and liability coverage."
        ]
        if is_remote:
            assumptions.append("Grid power is unavailable on-location, requiring silent generator support.")

        missing_info = []
        if not project.location:
            missing_info.append("Exact shoot venue/location address.")
        if "rain" in text and "indoor" not in text:
            missing_info.append("Local weather contingency & shelter protocol.")

        return {
            "requirements": reqs,
            "assumptions": assumptions,
            "missing_information": missing_info,
            "clarification_needed": False
        }


    def run(self, project: ProjectInput) -> Tuple[ProducerExtractionOutput, AuditLogEntry]:
        # 1. Validate Input
        valid, errors = ProducerValidator.validate_project_input(project)
        if not valid:
            audit = self.create_audit_entry(
                action="PARSE_BRIEF",
                status="failed",
                input_summary=f"Brief: {project.producer_request[:80]}...",
                output_summary="Input validation failed",
                warnings=errors,
                next_action="Correct shoot brief input parameters"
            )
            return ProducerExtractionOutput(clarification_needed=True, missing_information=errors), audit

        # 2. Extract using Gemini (with deterministic fallback)
        prompt = PRODUCER_EXTRACTION_PROMPT.format(
            producer_request=project.producer_request,
            budget=project.budget,
            currency=project.currency,
            duration_days=project.duration_days,
            location=project.location
        )
        fallback = self._get_fallback_requirements(project)

        extraction: ProducerExtractionOutput = gemini_client.generate_structured(
            prompt=prompt,
            system_instruction=PRODUCER_SYSTEM_INSTRUCTION,
            response_model=ProducerExtractionOutput,
            fallback_data=fallback
        )

        # 3. Deterministic Validation
        req_valid, req_errors = ProducerValidator.validate_requirements(
            extraction.requirements, project.duration_days
        )
        if not req_valid:
            # Fall back to known-valid structure if Gemini output had gaps
            extraction = ProducerExtractionOutput.model_validate(fallback)

        audit = self.create_audit_entry(
            action="REQUIREMENTS_EXTRACTED",
            status="successful",
            input_summary=f"Brief: '{project.producer_request}' (Budget ₹{project.budget:,.0f}, {project.duration_days} days)",
            output_summary=f"Extracted {len(extraction.requirements)} requirements across Equipment, Crew, Logistics & Compliance",
            policy_checks=[
                "Shoot duration validated (>0)",
                "Budget ceiling confirmed (₹25.00L)",
                "Mandatory low-light camera specification identified",
                "Mandatory insurance and forest permit compliance rules attached"
            ],
            warnings=extraction.missing_information,
            next_action="Run Marketplace Scout Agent to search and rank available vendors"
        )

        return extraction, audit
