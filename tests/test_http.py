import httpx
import pytest

from cinex.http import VendorUnavailable, request_with_retry


async def test_returns_json_on_success():
    calls = []

    async def handler(request):
        calls.append(request)
        return httpx.Response(200, json={"price": "10.00"})

    result = await request_with_retry(
        "GET", "http://v/quote", transport=httpx.MockTransport(handler)
    )
    assert result == {"price": "10.00"}
    assert len(calls) == 1


async def test_retries_once_then_succeeds():
    calls = []

    async def handler(request):
        calls.append(request)
        if len(calls) == 1:
            raise httpx.ConnectError("boom", request=request)
        return httpx.Response(200, json={"ok": True})

    result = await request_with_retry(
        "GET", "http://v/quote", transport=httpx.MockTransport(handler)
    )
    assert result == {"ok": True}
    assert len(calls) == 2, "exactly one retry, not more"


async def test_raises_vendor_unavailable_after_the_single_retry():
    calls = []

    async def handler(request):
        calls.append(request)
        raise httpx.ConnectError("down", request=request)

    with pytest.raises(VendorUnavailable):
        await request_with_retry("GET", "http://v/quote", transport=httpx.MockTransport(handler))
    assert len(calls) == 2


async def test_503_is_treated_as_unavailable():
    async def handler(request):
        return httpx.Response(503, json={"detail": "vendor unavailable"})

    with pytest.raises(VendorUnavailable):
        await request_with_retry("GET", "http://v/quote", transport=httpx.MockTransport(handler))
