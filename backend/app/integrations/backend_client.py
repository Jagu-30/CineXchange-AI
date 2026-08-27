from typing import Any, Dict, List, Optional
from backend.app.config import settings
from backend.app.agents.common.schemas import CandidateVendor, ComplianceDocument
from backend.app.integrations.mock_backend import mock_db

class BackendClient:
    """Unified client providing access to marketplace vendors, resources, and compliance documents."""

    def __init__(self):
        self.use_mock = settings.USE_MOCK_BACKEND

    def get_resource(self, resource_id: str) -> Optional[CandidateVendor]:
        if self.use_mock:
            return mock_db.get_resource(resource_id)
        # Real HTTP / Microservice invocation placeholder
        return mock_db.get_resource(resource_id)

    def search_resources(self, category: Optional[str] = None) -> List[CandidateVendor]:
        if self.use_mock:
            if category:
                return [r for r in mock_db.resources if r.category.upper() == category.upper()]
            return mock_db.resources
        return mock_db.resources

    def get_vendor(self, vendor_id: str) -> Optional[Dict[str, Any]]:
        if self.use_mock:
            return mock_db.get_vendor(vendor_id)
        return mock_db.get_vendor(vendor_id)

    def get_documents(self, vendor_id: Optional[str] = None) -> List[ComplianceDocument]:
        if self.use_mock:
            if vendor_id:
                return [d for d in mock_db.documents if d.vendor_id == vendor_id]
            return mock_db.documents
        return mock_db.documents

    def mark_unavailable(self, resource_id: str) -> bool:
        return mock_db.set_resource_availability(resource_id, False)

backend_client = BackendClient()
