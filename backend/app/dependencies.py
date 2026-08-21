from backend.app.orchestration.workflow import production_workflow, ProductionWorkflow
from backend.app.agents.common.state import state_manager, StateManager

def get_workflow() -> ProductionWorkflow:
    return production_workflow

def get_state_manager() -> StateManager:
    return state_manager
