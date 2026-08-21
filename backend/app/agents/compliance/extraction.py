import json
import os
from typing import Dict, List, Optional
from backend.app.config import DATA_DIR
from backend.app.agents.common.schemas import ComplianceDocument

class DocumentExtractor:
    """Extracts metadata and policy clauses from compliance documents."""

    def __init__(self):
        self._doc_cache: List[ComplianceDocument] = []
        self._load_documents()

    def _load_documents(self):
        docs_path = os.path.join(DATA_DIR, "documents.json")
        if os.path.exists(docs_path):
            with open(docs_path, "r", encoding="utf-8") as f:
                raw_docs = json.load(f)
                self._doc_cache = [ComplianceDocument(**d) for d in raw_docs]

    def get_document_by_id(self, document_id: str) -> Optional[ComplianceDocument]:
        for doc in self._doc_cache:
            if doc.document_id == document_id:
                return doc
        return None

    def get_documents_for_vendor(self, vendor_id: str) -> List[ComplianceDocument]:
        docs = [d for d in self._doc_cache if d.vendor_id == vendor_id]
        if not docs:
            # Return standard default verified set
            docs = [d for d in self._doc_cache if d.status == "VALID"]
        return docs

    def get_all_documents(self) -> List[ComplianceDocument]:
        return self._doc_cache
