"""Small helpers that keep model prose honest about numbers."""

from decimal import Decimal, InvalidOperation
import re

_NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?")
_IGNORED = re.compile(r"DF-\d{3}|\d{4}-\d{2}-\d{2}(?:T[\d:.+Z-]*)?")


def numbers_in(text: str) -> set[Decimal]:
    """Normalized numeric tokens, ignoring clause ids and ISO dates."""
    found = set()
    for token in _NUMBER.findall(_IGNORED.sub(" ", text)):
        try:
            found.add(Decimal(token.replace(",", "")).normalize())
        except InvalidOperation:
            continue
    return found
