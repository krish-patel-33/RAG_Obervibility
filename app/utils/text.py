import re


WHITESPACE_RE = re.compile(r"[ \t]+")
LINEBREAK_RE = re.compile(r"\n{3,}")
TOKEN_RE = re.compile(r"[A-Za-z0-9_]+")

# Function words carry no topical signal; matching on them makes every chunk
# look relevant to every question.
STOPWORDS = frozenset(
    """
    a about above after again all also am an and any are as at be because been before being below between both but by
    can could did do does doing down during each few for from further had has have having he her here hers him his how
    i if in into is it its itself just me more most my no nor not of off on once only or other our ours out over own
    same she should so some such than that the their theirs them then there these they this those through to too under
    until up very was we were what when where which while who whom why will with would you your yours
    explain describe tell give list define please
    """.split()
)


def normalize_text(text: str) -> str:
    text = text.replace("\x00", " ")
    text = WHITESPACE_RE.sub(" ", text)
    text = LINEBREAK_RE.sub("\n\n", text)
    return text.strip()


def content_tokens(text: str) -> set[str]:
    """Lower-cased word tokens with stopwords removed."""
    return {token for token in (match.lower() for match in TOKEN_RE.findall(text)) if token not in STOPWORDS}


def count_tokens_approx(text: str) -> int:
    # A conservative approximation good enough for chunk boundaries without tiktoken.
    return max(1, len(text.split()))


def compact_snippet(text: str, max_chars: int = 360) -> str:
    cleaned = " ".join(text.split())
    if len(cleaned) <= max_chars:
        return cleaned
    return cleaned[: max_chars - 3].rstrip() + "..."

