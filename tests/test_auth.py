import uuid

import pytest
from fastapi import HTTPException

from cinex.auth import Producer, issue_demo_token, verify_token


def test_round_trip():
    token = issue_demo_token()
    producer = verify_token(token)
    assert isinstance(producer, Producer)
    assert isinstance(producer.id, uuid.UUID)


def test_tampered_token_rejected():
    token = issue_demo_token()
    with pytest.raises(HTTPException) as exc:
        verify_token(token[:-3] + "abc")
    assert exc.value.status_code == 401


def test_garbage_token_rejected():
    with pytest.raises(HTTPException):
        verify_token("not-a-jwt")
