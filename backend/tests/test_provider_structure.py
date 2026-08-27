import os
import re
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent.parent

def test_root_layout_uses_providers():
    """Verify app/layout.tsx imports and wraps children in Providers."""
    layout_path = ROOT_DIR / "app" / "layout.tsx"
    assert layout_path.exists(), "app/layout.tsx must exist"
    content = layout_path.read_text(encoding="utf-8")
    
    assert "import Providers from './providers'" in content or 'import Providers from "./providers"' in content
    assert "<Providers>{children}</Providers>" in content or "<Providers>\n          {children}\n        </Providers>" in content

def test_app_providers_structure():
    """Verify app/providers.tsx is a client component wrapping children in MissionProvider."""
    providers_path = ROOT_DIR / "app" / "providers.tsx"
    assert providers_path.exists(), "app/providers.tsx must exist"
    content = providers_path.read_text(encoding="utf-8")
    
    assert "'use client'" in content or '"use client"' in content
    assert "MissionProvider" in content
    assert "<MissionProvider>{children}</MissionProvider>" in content or "<MissionProvider>\n      {children}\n    </MissionProvider>" in content

def test_mission_context_exports_and_guard():
    """Verify lib/mission-context.tsx exports named MissionProvider and useMission with strict guard."""
    context_path = ROOT_DIR / "lib" / "mission-context.tsx"
    assert context_path.exists(), "lib/mission-context.tsx must exist"
    content = context_path.read_text(encoding="utf-8")
    
    assert "export function MissionProvider" in content
    assert "export function useMission" in content
    assert "useMission must be used within MissionProvider" in content

def test_no_redundant_page_mission_providers():
    """Verify no route pages inside app/ have duplicate MissionProvider wrappers."""
    app_dir = ROOT_DIR / "app"
    page_files = list(app_dir.glob("**/page.tsx"))
    assert len(page_files) > 0, "Page files should be present in app directory"
    
    for page_path in page_files:
        content = page_path.read_text(encoding="utf-8")
        assert "<MissionProvider>" not in content, f"Redundant <MissionProvider> found in {page_path.relative_to(ROOT_DIR)}"
        assert "import { MissionProvider" not in content and "import {MissionProvider" not in content, f"Redundant MissionProvider import found in {page_path.relative_to(ROOT_DIR)}"

def test_all_use_mission_imports_are_consistent():
    """Verify all files importing useMission use the canonical @/lib/mission-context path."""
    for tsx_file in ROOT_DIR.glob("**/*.tsx"):
        if "node_modules" in str(tsx_file) or ".next" in str(tsx_file):
            continue
        content = tsx_file.read_text(encoding="utf-8")
        if "useMission" in content and tsx_file.name != "mission-context.tsx":
            assert "@/lib/mission-context" in content, f"Non-canonical useMission import in {tsx_file.relative_to(ROOT_DIR)}"
