from __future__ import annotations

from src.crawlers.parse.templates import detect_template_type, parse_payload


def test_parse_payload_extracts_title_and_text_for_news_html() -> None:
    html = """
    <html>
      <head><title>Semiconductor Supply Shock</title></head>
      <body>
        <article>
          <p>Exports tightened across key suppliers.</p>
          <p>Analysts revised risk assumptions upward.</p>
        </article>
      </body>
    </html>
    """.strip()

    parsed = parse_payload(
        url="https://news.example.com/markets/chips",
        content_type="text/html; charset=utf-8",
        payload=html.encode("utf-8"),
    )

    assert parsed.template_type == "news"
    assert parsed.title == "Semiconductor Supply Shock"
    assert "Exports tightened across key suppliers." in parsed.text


def test_detect_template_type_identifies_pdf_by_path_and_content_type() -> None:
    template = detect_template_type(
        url="https://www.sec.gov/filings/report.pdf",
        content_type="application/pdf",
    )

    assert template == "pdf"
