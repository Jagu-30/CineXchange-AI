import json
import os
from typing import Any, Dict, List, Optional
from backend.app.config import DATA_DIR
from backend.app.agents.common.schemas import CandidateVendor, ComplianceDocument

class MockBackendDatabase:
    """Simulated production marketplace database with dummy Indian cinema vendors and resources."""

    def __init__(self):
        self.data_dir = DATA_DIR
        self.vendors: List[Dict[str, Any]] = []
        self.resources: List[CandidateVendor] = []
        self.documents: List[ComplianceDocument] = []
        self.load_all()

    def load_all(self):
        vendors_file = os.path.join(self.data_dir, "vendors.json")
        resources_file = os.path.join(self.data_dir, "resources.json")
        documents_file = os.path.join(self.data_dir, "documents.json")

        if os.path.exists(vendors_file):
            with open(vendors_file, "r", encoding="utf-8") as f:
                self.vendors = json.load(f)

        if os.path.exists(resources_file):
            with open(resources_file, "r", encoding="utf-8") as f:
                raw_res = json.load(f)
                self.resources = [CandidateVendor(**r) for r in raw_res]

        if os.path.exists(documents_file):
            with open(documents_file, "r", encoding="utf-8") as f:
                raw_docs = json.load(f)
                self.documents = [ComplianceDocument(**d) for d in raw_docs]

    def get_resource(self, resource_id: str) -> Optional[CandidateVendor]:
        for r in self.resources:
            if r.resource_id == resource_id:
                return r
        return None

    def set_resource_availability(self, resource_id: str, available: bool) -> bool:
        for r in self.resources:
            if r.resource_id == resource_id:
                r.available = available
                return True
        return False

    def get_vendor(self, vendor_id: str) -> Optional[Dict[str, Any]]:
        for v in self.vendors:
            if v.get("vendor_id") == vendor_id:
                return v
        return None

mock_db = MockBackendDatabase()
