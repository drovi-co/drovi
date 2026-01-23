"""
Email Parser

Extracts structured metadata from email content including:
- From/To/CC/BCC addresses
- Subject lines
- Threading information (In-Reply-To, References)
- Date/time stamps
- Attachments
- Email signatures
- Quoted replies
"""

import re
from datetime import datetime
from email.utils import parseaddr, parsedate_to_datetime
from typing import Literal

from pydantic import Field

from .base import SourceParser, ParsedContent


class ParsedEmail(ParsedContent):
    """Structured email data."""

    source_type: str = "email"

    # Addresses
    from_email: str | None = None
    from_name: str | None = None
    to_emails: list[str] = Field(default_factory=list)
    to_names: list[str] = Field(default_factory=list)
    cc_emails: list[str] = Field(default_factory=list)
    bcc_emails: list[str] = Field(default_factory=list)

    # Subject
    subject: str | None = None
    subject_normalized: str | None = None  # Without Re:, Fwd:, etc.

    # Threading
    message_id: str | None = None
    in_reply_to: str | None = None
    references: list[str] = Field(default_factory=list)

    # Content
    has_html: bool = False
    has_attachments: bool = False
    attachment_names: list[str] = Field(default_factory=list)
    attachment_count: int = 0

    # Signature
    has_signature: bool = False
    signature_text: str | None = None

    # Quoted content
    has_quoted_reply: bool = False
    quoted_content: str | None = None
    original_body: str = ""  # Body without quoted content


class EmailParser(SourceParser[ParsedEmail]):
    """
    Parser for email content.

    Handles various email formats and extracts structured metadata
    for more accurate intelligence extraction.
    """

    @property
    def source_type(self) -> str:
        return "email"

    def parse(self, raw_content: str) -> ParsedEmail:
        """Parse raw email content."""
        # Try to extract headers if present
        headers, body = self._split_headers_body(raw_content)

        # Parse addresses
        from_email, from_name = self._parse_from(headers)
        to_emails, to_names = self._parse_recipients(headers, "to")
        cc_emails, _ = self._parse_recipients(headers, "cc")
        bcc_emails, _ = self._parse_recipients(headers, "bcc")

        # Parse subject
        subject = self._extract_subject(headers)
        subject_normalized = self._normalize_subject(subject)

        # Parse threading
        message_id = self._extract_header(headers, "message-id")
        in_reply_to = self._extract_header(headers, "in-reply-to")
        references = self._extract_references(headers)

        # Parse date
        sent_at = self._parse_date(headers)

        # Parse body
        body_text, has_quoted, quoted_content = self._parse_body(body)
        original_body, signature, has_signature = self._extract_signature(body_text)

        # Detect attachments (simple heuristic)
        has_attachments, attachment_names = self._detect_attachments(raw_content)

        # Collect all participants
        all_emails = [from_email] if from_email else []
        all_emails.extend(to_emails)
        all_emails.extend(cc_emails)

        all_participants = [from_name] if from_name else []
        all_participants.extend(to_names)

        return ParsedEmail(
            raw_content=raw_content,
            source_type="email",
            from_email=from_email,
            from_name=from_name,
            to_emails=to_emails,
            to_names=to_names,
            cc_emails=cc_emails,
            bcc_emails=bcc_emails,
            subject=subject,
            subject_normalized=subject_normalized,
            message_id=message_id,
            in_reply_to=in_reply_to,
            references=references,
            is_reply=bool(in_reply_to) or bool(references),
            thread_id=references[0] if references else message_id,
            reply_to_id=in_reply_to,
            sent_at=sent_at,
            body_text=original_body,
            has_html="<html" in raw_content.lower() or "<div" in raw_content.lower(),
            has_attachments=has_attachments,
            attachment_names=attachment_names,
            attachment_count=len(attachment_names),
            has_signature=has_signature,
            signature_text=signature,
            has_quoted_reply=has_quoted,
            quoted_content=quoted_content,
            original_body=original_body,
            participants=all_participants,
            participant_emails=all_emails,
        )

    def _split_headers_body(self, content: str) -> tuple[str, str]:
        """Split email into headers and body."""
        # Look for double newline separating headers from body
        parts = re.split(r'\n\n|\r\n\r\n', content, maxsplit=1)
        if len(parts) == 2:
            headers_section = parts[0]
            # Check if first part looks like headers
            if re.search(r'^(From|To|Subject|Date|Message-ID):', headers_section, re.MULTILINE | re.IGNORECASE):
                return parts[0], parts[1]
        return "", content

    def _extract_header(self, headers: str, name: str) -> str | None:
        """Extract a single header value."""
        pattern = rf'^{name}:\s*(.+?)(?=^[A-Za-z-]+:|$)'
        match = re.search(pattern, headers, re.MULTILINE | re.IGNORECASE | re.DOTALL)
        if match:
            return match.group(1).strip().replace('\n', ' ').replace('\r', '')
        return None

    def _parse_from(self, headers: str) -> tuple[str | None, str | None]:
        """Parse From header into email and name."""
        from_header = self._extract_header(headers, "from")
        if from_header:
            name, email = parseaddr(from_header)
            return email or None, name or None
        return None, None

    def _parse_recipients(self, headers: str, header_name: str) -> tuple[list[str], list[str]]:
        """Parse To/CC/BCC headers into lists of emails and names."""
        header_value = self._extract_header(headers, header_name)
        if not header_value:
            return [], []

        emails = []
        names = []

        # Split by comma, handling quoted names
        recipients = re.split(r',\s*(?=(?:[^"]*"[^"]*")*[^"]*$)', header_value)

        for recipient in recipients:
            name, email = parseaddr(recipient.strip())
            if email:
                emails.append(email)
            if name:
                names.append(name)

        return emails, names

    def _extract_subject(self, headers: str) -> str | None:
        """Extract subject line."""
        return self._extract_header(headers, "subject")

    def _normalize_subject(self, subject: str | None) -> str | None:
        """Remove Re:, Fwd:, etc. from subject."""
        if not subject:
            return None
        # Remove common prefixes
        normalized = re.sub(r'^(Re|Fwd|Fw|Aw|Sv|Vs|R|AW|TR|SV|VB|VS|Odp|PD|YNT|B|Rv):\s*', '', subject, flags=re.IGNORECASE)
        return normalized.strip()

    def _extract_references(self, headers: str) -> list[str]:
        """Extract References header into list of message IDs."""
        refs_header = self._extract_header(headers, "references")
        if not refs_header:
            return []
        # Message IDs are typically in angle brackets
        return re.findall(r'<[^>]+>', refs_header)

    def _parse_date(self, headers: str) -> datetime | None:
        """Parse Date header."""
        date_header = self._extract_header(headers, "date")
        if date_header:
            try:
                return parsedate_to_datetime(date_header)
            except Exception:
                pass
        return None

    def _parse_body(self, body: str) -> tuple[str, bool, str | None]:
        """
        Parse email body, extracting quoted content.

        Returns:
            Tuple of (clean_body, has_quoted, quoted_content)
        """
        # Patterns for quoted content
        quote_patterns = [
            r'^On .+wrote:$',  # "On DATE, NAME wrote:"
            r'^-----Original Message-----',
            r'^>+\s',  # Lines starting with >
            r'^From:.*\nSent:.*\nTo:',  # Outlook-style
            r'^-{3,}Forwarded message-{3,}',
        ]

        lines = body.split('\n')
        clean_lines = []
        quoted_lines = []
        in_quote = False

        for line in lines:
            is_quote_start = any(re.match(p, line, re.IGNORECASE) for p in quote_patterns)

            if is_quote_start:
                in_quote = True

            if in_quote:
                quoted_lines.append(line)
            else:
                if not line.startswith('>'):
                    clean_lines.append(line)
                else:
                    quoted_lines.append(line)
                    in_quote = True

        clean_body = '\n'.join(clean_lines).strip()
        quoted_content = '\n'.join(quoted_lines).strip() if quoted_lines else None

        return clean_body, bool(quoted_content), quoted_content

    def _extract_signature(self, body: str) -> tuple[str, str | None, bool]:
        """
        Extract email signature from body.

        Returns:
            Tuple of (body_without_sig, signature, has_signature)
        """
        # Common signature delimiters
        sig_patterns = [
            r'\n--\s*\n',  # Standard -- delimiter
            r'\nSent from my ',
            r'\nGet Outlook for ',
            r'\n_{5,}',  # Line of underscores
            r'\nBest regards,\n',
            r'\nBest,\n',
            r'\nThanks,\n',
            r'\nRegards,\n',
            r'\nCheers,\n',
        ]

        for pattern in sig_patterns:
            parts = re.split(pattern, body, maxsplit=1, flags=re.IGNORECASE)
            if len(parts) == 2:
                signature = parts[1].strip()
                # Only treat as signature if it's not too long
                if len(signature) < 500:
                    return parts[0].strip(), signature, True

        return body, None, False

    def _detect_attachments(self, content: str) -> tuple[bool, list[str]]:
        """Detect attachments from content."""
        # Look for common attachment indicators
        attachment_pattern = r'Content-Disposition:\s*attachment;\s*filename[="]*([^"\n]+)'
        matches = re.findall(attachment_pattern, content, re.IGNORECASE)

        if matches:
            return True, [m.strip('"') for m in matches]

        # Look for attachment mentions in text
        if re.search(r'attached|attachment|enclosed', content, re.IGNORECASE):
            return True, []

        return False, []

    def clean_body(self, content: str) -> str:
        """Clean email body text."""
        parsed = self.parse(content)
        return parsed.original_body
