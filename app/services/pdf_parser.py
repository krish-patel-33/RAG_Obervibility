from dataclasses import dataclass
from io import BytesIO

from pypdf import PdfReader

from app.core.errors import ValidationAppError
from app.utils.text import normalize_text

PARSER_VERSION = "pypdf-5.1.0-v1"
TEXT_PARSER_VERSION = "plain-text-v1"


@dataclass(frozen=True)
class ParsedPage:
    # None for formats without pages (plain text, Markdown).
    page_number: int | None
    text: str


class PDFParser:
    version = PARSER_VERSION

    def parse(self, content: bytes) -> list[ParsedPage]:
        if not content:
            raise ValidationAppError("Uploaded PDF is empty")
        try:
            reader = PdfReader(BytesIO(content))
        except Exception as exc:
            raise ValidationAppError("Uploaded file is not a readable PDF") from exc

        pages: list[ParsedPage] = []
        for idx, page in enumerate(reader.pages, start=1):
            text = normalize_text(page.extract_text() or "")
            if text:
                pages.append(ParsedPage(page_number=idx, text=text))

        if not pages:
            raise ValidationAppError("No extractable text found in PDF. OCR is planned for a later phase.")

        return pages


class TextParser:
    """Parser for plain-text and Markdown uploads."""

    version = TEXT_PARSER_VERSION

    def parse(self, content: bytes) -> list[ParsedPage]:
        if not content:
            raise ValidationAppError("Uploaded document is empty")
        if b"\x00" in content[:4096]:
            raise ValidationAppError("Uploaded text file looks like binary data")
        text = _decode_text(content)
        # Form feeds are the only page boundary plain text has.
        sections = [normalize_text(part) for part in text.replace("\r\n", "\n").split("\f")]
        sections = [section for section in sections if section]
        if not sections:
            raise ValidationAppError("No text found in the uploaded document")
        if len(sections) == 1:
            return [ParsedPage(page_number=None, text=sections[0])]
        return [ParsedPage(page_number=idx, text=section) for idx, section in enumerate(sections, start=1)]


def _decode_text(content: bytes) -> str:
    try:
        return content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return content.decode("cp1252", errors="replace")
