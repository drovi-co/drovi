from src.orchestrator.nodes.persist_raw import _extract_message_recipients


def test_extract_message_recipients_from_unified_metadata():
    recipients = _extract_message_recipients(
        metadata={
            "unified": {
                "recipient_emails": ["alpha@example.com", "beta@example.com"],
                "recipient_names": ["Alpha", "Beta"],
                "cc_emails": ["gamma@example.com"],
            }
        },
        sender_email="sender@example.com",
        fallback_user_email=None,
        fallback_user_name=None,
    )

    assert recipients == [
        {"email": "alpha@example.com", "name": "Alpha"},
        {"email": "beta@example.com", "name": "Beta"},
        {"email": "gamma@example.com", "name": None},
    ]


def test_extract_message_recipients_from_raw_and_excludes_sender():
    recipients = _extract_message_recipients(
        metadata={
            "raw": {
                "to_recipients": [
                    {"email": "sender@example.com", "name": "Sender"},
                    {"email": "owner@example.com", "name": "Owner"},
                ],
                "cc_recipients": [{"address": "team@example.com", "display_name": "Team"}],
            }
        },
        sender_email="sender@example.com",
        fallback_user_email=None,
        fallback_user_name=None,
    )

    assert recipients == [
        {"email": "owner@example.com", "name": "Owner"},
        {"email": "team@example.com", "name": "Team"},
    ]


def test_extract_message_recipients_fallback_to_user():
    recipients = _extract_message_recipients(
        metadata={},
        sender_email="external@example.com",
        fallback_user_email="user@example.com",
        fallback_user_name="Drovi User",
    )

    assert recipients == [{"email": "user@example.com", "name": "Drovi User"}]
