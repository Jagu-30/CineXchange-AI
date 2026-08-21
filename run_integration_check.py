#!/usr/bin/env python
"""
CineXchange AI — Full Integration Verification Runner
Runs all backend unit, policy, workflow, and e2e integration tests.
"""
import subprocess
import sys

def main():
    print("=" * 70)
    print("  CineXchange AI — Running Full Integration Verification Suite")
    print("=" * 70)
    cmd = [sys.executable, "-m", "pytest", "backend/tests", "-v"]
    result = subprocess.run(cmd)
    if result.returncode == 0:
        print("\n" + "=" * 70)
        print("  [SUCCESS] All 15 CineXchange AI Integration Tests Passed!")
        print("=" * 70)
    else:
        print("\n" + "=" * 70)
        print("  [FAILED] One or more integration tests failed.")
        print("=" * 70)
    sys.exit(result.returncode)

if __name__ == "__main__":
    main()
