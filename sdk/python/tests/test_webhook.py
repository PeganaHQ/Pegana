"""Golden-vector and rejection tests for webhook signature verification."""

from pegana_sdk import verify_webhook

BODY = b'{"alert_id":"00000000-0000-4000-8000-000000000001","asset":"jitoSOL","to_state":"DEPEG"}'
EVENT_ID = "00000000-0000-4000-8000-000000000001"
PUBKEY = "A6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg="
V1 = "Gpu1U4olo6STeYr27K6qYvWl90VawFLzkF8vUNZzWCIuKmFwtHS3lNNWNbbHmQY3wM6Rupj1M1GFFaqSMpEiDw=="
V2 = "EAiQCh9Cbfqho1Z8TV6s2TyyY9gMslfn756wqO5bVwOJl62yztsBBmMNJiVONK5PfUwkw+36XaYkPd7o+IsNBw=="
HEADERS = {
    "x-pegana-timestamp": "1700000000",
    "x-pegana-event-id": EVENT_ID,
    "x-pegana-signature": f"ed25519:{V1}",
    "x-pegana-signature-v2": f"ed25519:{V2}",
}


def test_golden_v2_and_legacy_v1() -> None:
    assert verify_webhook(HEADERS, BODY, [PUBKEY], now_sec=1700000000)
    legacy = {k: v for k, v in HEADERS.items() if k != "x-pegana-signature-v2"}
    assert verify_webhook(legacy, BODY, [PUBKEY], now_sec=1700000000)


def test_v2_precedence_event_binding_and_window() -> None:
    assert not verify_webhook(
        {**HEADERS, "x-pegana-signature-v2": "bad"}, BODY, [PUBKEY], now_sec=1700000000
    )
    assert not verify_webhook(
        {**HEADERS, "x-pegana-event-id": "00000000-0000-4000-8000-000000000002"},
        BODY, [PUBKEY], now_sec=1700000000,
    )
    assert not verify_webhook(HEADERS, BODY + b" ", [PUBKEY], now_sec=1700000000)
    assert not verify_webhook(HEADERS, BODY, [PUBKEY], now_sec=1700000301)
    assert not verify_webhook({**HEADERS, "x-pegana-signature-v2": V2}, BODY, [PUBKEY], now_sec=1700000000)
    assert not verify_webhook({**HEADERS, "x-pegana-signature-v2": f"ed25519:{V2[:-2]}-_"}, BODY, [PUBKEY], now_sec=1700000000)
