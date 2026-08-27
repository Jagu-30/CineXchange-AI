import copy
import json
import os
from threading import Lock
from typing import Dict, List, Optional
from backend.app.config import DATA_DIR
from backend.app.agents.common.schemas import (
    ProductionState,
    ProjectInput,
    WorkflowState,
    AuditLogEntry
)

class StateManager:
    """In-memory thread-safe state manager for production workflows."""

    def __init__(self):
        self._lock = Lock()
        self._states: Dict[str, ProductionState] = {}
        self._load_sample_data()

    def _load_sample_data(self):
        sample_path = os.path.join(DATA_DIR, "sample_project.json")

        if os.path.exists(sample_path):
            try:
                with open(sample_path, "r", encoding="utf-8") as f:
                    sample_json = json.load(f)
                project = ProjectInput(**sample_json)
                self._states[project.project_id] = ProductionState(
                    project=project,
                    current_state=WorkflowState.DRAFT
                )
            except Exception as e:
                print(f"Error loading sample project: {e}")

    def get_state(self, project_id: str) -> Optional[ProductionState]:
        with self._lock:
            state = self._states.get(project_id)
            if state:
                return copy.deepcopy(state)
            return None

    def save_state(self, state: ProductionState) -> ProductionState:
        with self._lock:
            self._states[state.project.project_id] = copy.deepcopy(state)
            return state

    def create_or_update_project(self, project: ProjectInput) -> ProductionState:
        with self._lock:
            if project.project_id in self._states:
                state = self._states[project.project_id]
                state.project = project
            else:
                state = ProductionState(
                    project=project,
                    current_state=WorkflowState.DRAFT
                )
                self._states[project.project_id] = state
            return copy.deepcopy(state)

    def add_audit_entry(self, project_id: str, entry: AuditLogEntry) -> None:
        with self._lock:
            state = self._states.get(project_id)
            if state:
                state.audit_log.insert(0, entry)

state_manager = StateManager()
