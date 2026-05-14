import base64
import io
import logging
import re

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

PARSER_VERSION = "v1-deterministic-2026-05"


class ParseRequest(BaseModel):
    document_id: str
    filename: str
    mime_type: str
    content_base64: str = Field(min_length=1)


class ParsedClause(BaseModel):
    ordinal: int
    heading_path: str | None = None
    clause_text: str = Field(min_length=1)
    char_start: int
    char_end: int
    page_number: int | None = None


class ParseResult(BaseModel):
    document_id: str
    parser_version: str = PARSER_VERSION
    clauses: list[ParsedClause]
    page_count: int | None = None
    char_count: int


# Heading detection: matches '1.', '1.1', '1.1.1', 'Section 5', 'ARTICLE V',
# 'Section 5.1' at the start of a paragraph. Used to split running text into
# clause boundaries when the document doesn't carry style metadata (PDFs)
# or when .docx Heading styles aren't applied.
HEADING_PATTERNS = [
    re.compile(r"^\s*(\d+(?:\.\d+){0,3})\.?\s+([A-Z][^\n]{0,200})"),
    re.compile(r"^\s*(Section|SECTION|Article|ARTICLE)\s+([A-Z0-9]+(?:\.\d+)?)\.?\s+([^\n]{0,200})"),
]


def _detect_heading(text: str) -> tuple[str, str] | None:
    """Returns (heading_label, remaining_first_line) if the line opens a clause."""
    for pat in HEADING_PATTERNS:
        m = pat.match(text)
        if m:
            label = " ".join(g for g in m.groups()[:-1] if g)
            return (label.strip(), m.group(0).strip())
    return None


def _segment_into_clauses(paragraphs: list[tuple[str, int | None]]) -> list[ParsedClause]:
    """Walk paragraphs (text, page_number) and group into clauses by heading boundary."""
    clauses: list[ParsedClause] = []
    current_text: list[str] = []
    current_heading: str | None = None
    current_start = 0
    cursor = 0
    last_page = 1
    parent_heading: str | None = None

    def flush(end_cursor: int):
        nonlocal current_text, current_start, current_heading, parent_heading
        if not current_text:
            return
        body = "\n".join(current_text).strip()
        if not body:
            current_text = []
            return
        heading_path = (
            f"{parent_heading} > {current_heading}"
            if parent_heading and current_heading and parent_heading != current_heading
            else current_heading
        )
        clauses.append(
            ParsedClause(
                ordinal=len(clauses),
                heading_path=heading_path,
                clause_text=body,
                char_start=current_start,
                char_end=end_cursor,
                page_number=last_page,
            )
        )
        current_text = []

    for para, page in paragraphs:
        text = para.rstrip()
        if not text:
            cursor += 1  # blank line
            continue
        heading_match = _detect_heading(text)
        if heading_match:
            label, _full = heading_match
            # Flush previous clause
            flush(cursor)
            # Determine if this is a sub-heading of the current parent
            if current_heading and label.split(".")[0] == current_heading.split(".")[0]:
                # nested under same top-level number → keep parent
                pass
            elif "." not in label:
                parent_heading = label
            current_heading = label
            current_start = cursor
        current_text.append(text)
        if page is not None:
            last_page = page
        cursor += len(para) + 1

    flush(cursor)
    return clauses


def parse_docx(content: bytes, document_id: str) -> ParseResult:
    import docx  # python-docx

    bio = io.BytesIO(content)
    doc = docx.Document(bio)

    paragraphs: list[tuple[str, int | None]] = []
    for p in doc.paragraphs:
        style = p.style.name if p.style else ""
        text = p.text or ""
        # If the paragraph has a Heading style, prefix with a synthesized
        # numeric label so _detect_heading catches it.
        if style and style.lower().startswith("heading"):
            level = "".join(c for c in style if c.isdigit()) or "1"
            if text and not _detect_heading(text):
                text = f"{level}. {text}"
        paragraphs.append((text, None))

    clauses = _segment_into_clauses(paragraphs)
    char_count = sum(len(c.clause_text) for c in clauses)

    return ParseResult(
        document_id=document_id,
        clauses=clauses,
        page_count=None,  # not meaningful for .docx
        char_count=char_count,
    )


def parse_pdf(content: bytes, document_id: str) -> ParseResult:
    from pypdf import PdfReader

    bio = io.BytesIO(content)
    reader = PdfReader(bio)

    paragraphs: list[tuple[str, int | None]] = []
    for page_idx, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        # PDF text extraction loses paragraph boundaries; split on double
        # newlines as a coarse heuristic.
        for chunk in text.split("\n\n"):
            chunk = chunk.strip()
            if chunk:
                paragraphs.append((chunk, page_idx + 1))

    clauses = _segment_into_clauses(paragraphs)
    char_count = sum(len(c.clause_text) for c in clauses)

    return ParseResult(
        document_id=document_id,
        clauses=clauses,
        page_count=len(reader.pages),
        char_count=char_count,
    )


def parse_document(request: ParseRequest) -> ParseResult:
    content = base64.b64decode(request.content_base64)
    mime = request.mime_type.lower()
    filename_lower = request.filename.lower()

    if mime == "application/pdf" or filename_lower.endswith(".pdf"):
        return parse_pdf(content, request.document_id)
    if (
        mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        or filename_lower.endswith(".docx")
    ):
        return parse_docx(content, request.document_id)

    raise ValueError(f"unsupported mime_type/filename: {request.mime_type} / {request.filename}")
