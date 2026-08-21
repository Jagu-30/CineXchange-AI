from abc import ABC, abstractmethod
from datetime import datetime, timezone
import uuid
from typing import Any, Dict, List, Optional
from backend.app.agents.common.schemas import AuditLogEntry

class BaseAgent(ABC):
    """Abstract Base Class for all CineXchange AI Agents."""

    def __init__(self, agent_id: str, agent_name: str, role: str):
        self.agent_id = agent_id
        self.agent_name = agent_name
        self.role = role

    def create_audit_entry(
        self,
        action: str,
        status: str,
        input_summary: str,
        output_summary: str,
        policy_checks: Optional[List[str]] = None,
        warnings: Optional[List[str]] = None,
        next_action: str = ""
    ) -> AuditLogEntry:
        return AuditLogEntry(
            entry_id=f"AUDIT-{uuid.uuid4().hex[:8].upper()}",
            timestamp=datetime.now(timezone.utc).isoformat(),
            agent=self.agent_id,
            agent_name=self.agent_name,
            action=action,
            status=status,
            input_summary=input_summary,
            output_summary=output_summary,
            policy_checks=policy_checks or [],
            warnings=warnings or [],
            next_action=next_action
        )

    @abstractmethod
    def run(self, *args, **kwargs) -> Any:
        """Execute agent workflow."""
        pass
