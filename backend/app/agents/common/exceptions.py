class CineXchangeError(Exception):
    """Base exception for CineXchange AI platform."""
    pass

class ValidationError(CineXchangeError):
    """Validation failure in input or constraints."""
    pass

class InvalidStateTransitionError(CineXchangeError):
    """Invalid workflow state transition."""
    pass

class BudgetExceededError(CineXchangeError):
    """Budget limit exceeded."""
    pass

class ComplianceBlockedError(CineXchangeError):
    """Operation blocked by compliance policies."""
    pass

class NegotiationExhaustedError(CineXchangeError):
    """Maximum negotiation rounds reached without agreement."""
    pass
