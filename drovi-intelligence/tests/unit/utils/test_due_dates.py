from datetime import UTC, datetime

from src.utils.due_dates import infer_due_date


def test_infer_due_date_from_explicit_month_day_year() -> None:
    parsed = infer_due_date(
        due_date_text="Your trial ends on Feb 23, 2026.",
        reference_time=datetime(2026, 2, 16, 10, 0, tzinfo=UTC),
    )

    assert parsed is not None
    assert parsed.year == 2026
    assert parsed.month == 2
    assert parsed.day == 23


def test_infer_due_date_from_relative_tomorrow() -> None:
    parsed = infer_due_date(
        due_date_text="Grafana trial ends tomorrow",
        reference_time=datetime(2026, 2, 16, 9, 30, tzinfo=UTC),
    )

    assert parsed is not None
    assert parsed.date().isoformat() == "2026-02-17"
    assert parsed.hour == 9
    assert parsed.minute == 30


def test_infer_due_date_from_weekday_phrase() -> None:
    parsed = infer_due_date(
        due_date_text="The revised proposal will be delivered by Friday.",
        reference_time=datetime(2026, 2, 16, 11, 0, tzinfo=UTC),  # Monday
    )

    assert parsed is not None
    assert parsed.date().isoformat() == "2026-02-20"


def test_infer_due_date_returns_none_for_text_without_date_signal() -> None:
    parsed = infer_due_date(
        title="Send the final contract",
        reference_time=datetime(2026, 2, 16, 11, 0, tzinfo=UTC),
    )

    assert parsed is None
