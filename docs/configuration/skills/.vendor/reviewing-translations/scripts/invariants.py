from __future__ import annotations

import csv
import io
import json
import math
import re
from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser
from xml.etree import ElementTree


@dataclass(frozen=True)
class ValidationFinding:
    check: str
    severity: str
    message: str
    span: tuple[int, int] | None = None


@dataclass(frozen=True)
class _InvariantEvidence:
    check: str
    severity: str
    expected: object
    observed: object
    span: tuple[int, int] | None
    message: str


class _CandidateStructureError(ValueError):
    pass


Check = Callable[
    [Mapping[str, object], str, Mapping[str, object]],
    tuple[_InvariantEvidence, ...],
]


_SEVERITIES = {"critical", "major", "minor", "neutral"}
_PLACEHOLDER_NAME = r"(?:[A-Za-z_][\w.-]*|\d+)"
_PLACEHOLDER = re.compile(
    rf"\{{\{{\s*{_PLACEHOLDER_NAME}\s*\}}\}}|\{{\s*{_PLACEHOLDER_NAME}\s*\}}"
)
_FORMAT_SPECIFIER = re.compile(
    r"%%|%(?:\d+\$)?[-+0 #']*(?:\d+|\*)?(?:\.(?:\d+|\*))?"
    r"(?:hh|h|ll|l|L|z|j|t|q)?[diuoxXfFeEgGaAcsp@]"
)
_URL = re.compile(r"https?://[^\s<>\"'`]+", re.IGNORECASE)
_EMAIL = re.compile(r"(?<![\w.+-])[\w.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![\w.-])")
_NUMBER = re.compile(
    r"(?<![\w])[-+]?(?:\d{1,3}(?:[.,\s]\d{3})+|\d+)(?:[.,]\d+)?(?:\s?%)?(?![\w])"
)
_IDENTIFIER = re.compile(
    r"(?<![\w])(?:[A-Za-z]+(?:[A-Z][A-Za-z0-9]*)+|[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+|"
    r"[A-Z][A-Z0-9_]{1,}|[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+)(?![\w])"
)


def _severity(check: Mapping[str, object]) -> str:
    value = check.get("severity")
    if not isinstance(value, str) or value not in _SEVERITIES:
        raise ValueError(f"invalid check severity: {value!r}")
    return value


def _source(case: Mapping[str, object]) -> str:
    value = case.get("source")
    if not isinstance(value, str):
        raise ValueError("case source must be text")
    return value


def _counter_payload(counter: Counter[str]) -> dict[str, int]:
    return {key: counter[key] for key in sorted(counter)}


def _first_unexpected_span(output: str, expected: Counter[str], observed: Counter[str]) -> tuple[int, int] | None:
    for value in sorted(observed):
        if observed[value] > expected[value]:
            start = output.find(value)
            if start >= 0:
                return start, start + len(value)
    return None


def _multiset_finding(
    invariant: str,
    severity: str,
    source_values: Sequence[str],
    output_values: Sequence[str],
    output: str,
) -> tuple[_InvariantEvidence, ...]:
    expected = Counter(source_values)
    observed = Counter(output_values)
    if expected == observed:
        return ()
    return (_InvariantEvidence(
        invariant,
        severity,
        _counter_payload(expected),
        _counter_payload(observed),
        _first_unexpected_span(output, expected, observed),
        f"{invariant} differs from the declared source invariant",
    ),)


def _trim_url(value: str) -> str:
    while value and value[-1] in ".,;:!?":
        value = value[:-1]
    while value.endswith(")") and value.count("(") < value.count(")"):
        value = value[:-1]
    while value.endswith("]") and value.count("[") < value.count("]"):
        value = value[:-1]
    return value


def _configured_values(
    check: Mapping[str, object],
    *,
    keys: Sequence[str],
) -> tuple[str, ...] | None:
    value: object = None
    for key in keys:
        if key in check:
            value = check[key]
            break
    if value is None:
        return None
    if isinstance(value, str) or not isinstance(value, Sequence):
        raise ValueError(f"{check.get('type')} values must be a list of non-empty strings")
    if not all(isinstance(item, str) and item for item in value):
        raise ValueError(f"{check.get('type')} values must be a list of non-empty strings")
    return tuple(value)


def _literal_occurrences(text: str, values: Sequence[str]) -> list[str]:
    matches: list[tuple[int, str]] = []
    for value in values:
        matches.extend((match.start(), value) for match in re.finditer(re.escape(value), text))
    return [value for _, value in sorted(matches)]


def _exact_literal_occurrences(text: str, values: Sequence[str]) -> list[str]:
    matches: list[tuple[int, str]] = []
    for value in values:
        prefix = rf"(?<![\w{re.escape(value[0])}])" if value[0].isalnum() else rf"(?<!{re.escape(value[0])})"
        suffix = rf"(?![\w{re.escape(value[-1])}])" if value[-1].isalnum() else rf"(?!{re.escape(value[-1])})"
        pattern = re.compile(prefix + re.escape(value) + suffix)
        matches.extend((match.start(), value) for match in pattern.finditer(text))
    return [value for _, value in sorted(matches)]


_CHECK_FIELDS: dict[str, frozenset[str]] = {
    name: frozenset({"type", "severity"})
    for name in (
        "placeholder_multiset", "format_specifier_multiset", "url_multiset",
        "email_multiset", "code_span_multiset",
        "json_structure", "xml_structure", "html_structure",
        "markdown_structure", "fenced_block_exact", "icu_topology",
    )
}
_CHECK_FIELDS.update({
    "command_multiset": frozenset({"type", "severity", "values", "commands"}),
    "identifier_multiset": frozenset({"type", "severity", "values", "identifiers"}),
    "protected_term_multiset": frozenset({"type", "severity", "values", "terms"}),
    "number_multiset": frozenset({
        "type", "severity",
        "source_decimal_separator", "source_grouping_separator",
        "target_decimal_separator", "target_grouping_separator",
    }),
    "character_limit": frozenset({"type", "severity", "max"}),
    "line_count": frozenset({"type", "severity", "count", "lines"}),
    "csv_shape": frozenset({"type", "severity", "delimiter"}),
    "forbidden_locale_form": frozenset({
        "type", "severity", "forms", "forbidden", "case_sensitive",
    }),
    "literal_multiset": frozenset({"type", "severity", "values"}),
    "literal_mapping_multiset": frozenset({
        "type", "severity", "mappings", "require_source_absence",
    }),
    "line_character_limits": frozenset({"type", "severity", "maxima"}),
    "delimited_fields": frozenset({
        "type", "severity", "delimiter", "count", "allow_whitespace", "unique",
    }),
    "json_line_contract": frozenset({
        "type", "severity", "line", "translatable_keys",
    }),
})


def _string_list(value: object, label: str, *, allow_empty: bool = False) -> tuple[str, ...]:
    if isinstance(value, (str, bytes)) or not isinstance(value, Sequence):
        raise ValueError(f"{label} must be a list of non-empty strings")
    result = tuple(value)
    if (not allow_empty and not result) or not all(
        isinstance(item, str) and item for item in result
    ):
        raise ValueError(f"{label} must be a list of non-empty strings")
    if len(result) != len(set(result)):
        raise ValueError(f"{label} must not contain duplicates")
    return result


_NUMBER_SEPARATOR_FIELDS = (
    "source_decimal_separator",
    "source_grouping_separator",
    "target_decimal_separator",
    "target_grouping_separator",
)


def _declared_number_format(
    check: Mapping[str, object],
    role: str,
) -> tuple[str, str | None] | None:
    declared = [field for field in _NUMBER_SEPARATOR_FIELDS if field in check]
    if not declared:
        return None
    missing = [field for field in _NUMBER_SEPARATOR_FIELDS if field not in check]
    if missing:
        raise ValueError(
            "number_multiset explicit format requires all source and target separators"
        )
    decimal = check[f"{role}_decimal_separator"]
    grouping = check[f"{role}_grouping_separator"]
    if (
        type(decimal) is not str
        or len(decimal) != 1
        or decimal.isspace()
        or decimal.isdigit()
        or decimal in "+-%"
    ):
        raise ValueError(
            f"number_multiset {role}_decimal_separator must be one non-whitespace symbol"
        )
    if grouping is not None and (
        type(grouping) is not str
        or len(grouping) != 1
        or grouping.isdigit()
        or grouping in "+-%"
    ):
        raise ValueError(
            f"number_multiset {role}_grouping_separator must be null or one symbol"
        )
    if grouping == decimal:
        raise ValueError(
            f"number_multiset {role} decimal and grouping separators must differ"
        )
    return decimal, grouping


def validate_check_declaration(check: Mapping[str, object]) -> None:
    check_type = check.get("type")
    if not isinstance(check_type, str) or check_type not in _CHECK_FIELDS:
        raise ValueError(f"unknown automatic check: {check_type!r}")
    unknown = sorted(set(check) - _CHECK_FIELDS[check_type])
    if unknown:
        raise ValueError(f"{check_type} has unknown fields: {', '.join(unknown)}")
    _severity(check)

    alias_pairs = {
        "command_multiset": ("values", "commands"),
        "identifier_multiset": ("values", "identifiers"),
        "protected_term_multiset": ("values", "terms"),
        "line_count": ("count", "lines"),
        "forbidden_locale_form": ("forms", "forbidden"),
    }
    aliases = alias_pairs.get(check_type)
    if aliases and all(alias in check for alias in aliases):
        raise ValueError(f"{check_type} cannot declare both {aliases[0]} and {aliases[1]}")

    if check_type in {"command_multiset", "identifier_multiset", "protected_term_multiset"}:
        values = _configured_values(
            check,
            keys={
                "command_multiset": ("values", "commands"),
                "identifier_multiset": ("values", "identifiers"),
                "protected_term_multiset": ("values", "terms"),
            }[check_type],
        )
        if values is not None and len(values) != len(set(values)):
            raise ValueError(f"{check_type} values must not contain duplicates")
    elif check_type == "character_limit" and "max" in check:
        if type(check["max"]) is not int or check["max"] < 0:
            raise ValueError("character_limit requires a non-negative integer max")
    elif check_type == "number_multiset":
        source_format = _declared_number_format(check, "source")
        target_format = _declared_number_format(check, "target")
        if (source_format is None) != (target_format is None):
            raise ValueError(
                "number_multiset explicit format requires all source and target separators"
            )
    elif check_type == "line_count":
        value = check.get("count", check.get("lines"))
        if value is not None and (type(value) is not int or value < 0):
            raise ValueError("line_count requires a non-negative integer count")
    elif check_type == "csv_shape" and "delimiter" in check:
        _csv_dialect("", check["delimiter"])
    elif check_type == "forbidden_locale_form":
        configured = check.get("forms", check.get("forbidden"))
        _string_list(configured, "forbidden locale forms")
        if "case_sensitive" in check and type(check["case_sensitive"]) is not bool:
            raise ValueError("forbidden_locale_form case_sensitive must be boolean")
    elif check_type == "literal_multiset":
        _string_list(check.get("values"), "literal_multiset values")
    elif check_type == "literal_mapping_multiset":
        if (
            "require_source_absence" in check
            and type(check["require_source_absence"]) is not bool
        ):
            raise ValueError("literal_mapping_multiset require_source_absence must be boolean")
        mappings = check.get("mappings")
        if isinstance(mappings, (str, bytes)) or not isinstance(mappings, Sequence) or not mappings:
            raise ValueError("literal_mapping_multiset mappings must be a non-empty list")
        sources: list[str] = []
        for mapping in mappings:
            if not isinstance(mapping, Mapping) or set(mapping) != {"source", "targets"}:
                raise ValueError("each literal mapping must contain exactly source and targets")
            source = mapping["source"]
            if not isinstance(source, str) or not source:
                raise ValueError("literal mapping source must be non-empty text")
            _string_list(mapping["targets"], "literal mapping targets")
            sources.append(source)
        if len(sources) != len(set(sources)):
            raise ValueError("literal mapping sources must not contain duplicates")
    elif check_type == "line_character_limits":
        maxima = check.get("maxima")
        if isinstance(maxima, (str, bytes)) or not isinstance(maxima, Sequence) or not maxima:
            raise ValueError("line_character_limits maxima must be a non-empty list")
        if not all(type(maximum) is int and maximum >= 0 for maximum in maxima):
            raise ValueError("line_character_limits maxima must be non-negative integers")
    elif check_type == "delimited_fields":
        delimiter = check.get("delimiter")
        if not isinstance(delimiter, str) or not delimiter:
            raise ValueError("delimited_fields delimiter must be non-empty text")
        if type(check.get("count")) is not int or check["count"] <= 0:
            raise ValueError("delimited_fields count must be a positive integer")
        if type(check.get("allow_whitespace")) is not bool:
            raise ValueError("delimited_fields allow_whitespace must be boolean")
        if "unique" in check and type(check["unique"]) is not bool:
            raise ValueError("delimited_fields unique must be boolean")
    elif check_type == "json_line_contract":
        if type(check.get("line")) is not int or check["line"] <= 0:
            raise ValueError("json_line_contract line must be a positive integer")
        _string_list(check.get("translatable_keys"), "json_line_contract translatable_keys")


def check_placeholders(case: Mapping[str, object], output: str, check: Mapping[str, object]) -> tuple[_InvariantEvidence, ...]:
    return _multiset_finding(
        "placeholder_multiset", _severity(check),
        _PLACEHOLDER.findall(_source(case)), _PLACEHOLDER.findall(output), output,
    )


def check_format_specifiers(case: Mapping[str, object], output: str, check: Mapping[str, object]) -> tuple[_InvariantEvidence, ...]:
    return _multiset_finding(
        "format_specifier_multiset", _severity(check),
        _FORMAT_SPECIFIER.findall(_source(case)), _FORMAT_SPECIFIER.findall(output), output,
    )


def check_urls(case: Mapping[str, object], output: str, check: Mapping[str, object]) -> tuple[_InvariantEvidence, ...]:
    extract = lambda text: [_trim_url(match.group(0)) for match in _URL.finditer(text)]
    return _multiset_finding("url_multiset", _severity(check), extract(_source(case)), extract(output), output)


def check_emails(case: Mapping[str, object], output: str, check: Mapping[str, object]) -> tuple[_InvariantEvidence, ...]:
    extract = lambda text: [match.group(0) for match in _EMAIL.finditer(text)]
    return _multiset_finding("email_multiset", _severity(check), extract(_source(case)), extract(output), output)


def check_code_spans(case: Mapping[str, object], output: str, check: Mapping[str, object]) -> tuple[_InvariantEvidence, ...]:
    return _multiset_finding(
        "code_span_multiset", _severity(check),
        _extract_code_spans(_source(case)), _extract_code_spans(output), output,
    )


def _extract_code_spans(text: str) -> list[str]:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    spans: list[str] = []
    position = 0
    while position < len(text):
        if text[position] != "`":
            position += 1
            continue
        opening = position
        while position < len(text) and text[position] == "`":
            position += 1
        width = position - opening
        closing = position
        while closing < len(text):
            closing = text.find("`" * width, closing)
            if closing < 0:
                break
            if (
                (closing == 0 or text[closing - 1] != "`")
                and (closing + width == len(text) or text[closing + width] != "`")
            ):
                content = text[position:closing].replace("\n", " ")
                if (
                    len(content) >= 2
                    and content.startswith(" ")
                    and content.endswith(" ")
                    and content.strip(" ")
                ):
                    content = content[1:-1]
                spans.append(content)
                position = closing + width
                break
            closing += width
        else:
            continue
        if closing < 0:
            position = opening + width
    return spans


def check_commands(case: Mapping[str, object], output: str, check: Mapping[str, object]) -> tuple[_InvariantEvidence, ...]:
    values = _configured_values(check, keys=("values", "commands"))
    if values is None:
        expected_values = _extract_code_spans(_source(case))
        observed_values = _extract_code_spans(output)
    else:
        expected_values = _literal_occurrences(_source(case), values)
        observed_values = _literal_occurrences(output, values)
    return _multiset_finding(
        "command_multiset", _severity(check), expected_values, observed_values, output,
    )


def check_identifiers(case: Mapping[str, object], output: str, check: Mapping[str, object]) -> tuple[_InvariantEvidence, ...]:
    values = _configured_values(check, keys=("values", "identifiers"))
    if values is None:
        extract = lambda text: [match.group(0) for match in _IDENTIFIER.finditer(text)]
        expected_values = extract(_source(case))
        observed_values = extract(output)
    else:
        expected_values = _literal_occurrences(_source(case), values)
        observed_values = _literal_occurrences(output, values)
    return _multiset_finding(
        "identifier_multiset", _severity(check), expected_values, observed_values, output,
    )


def check_protected_terms(case: Mapping[str, object], output: str, check: Mapping[str, object]) -> tuple[_InvariantEvidence, ...]:
    values = _configured_values(check, keys=("values", "terms"))
    if values is None:
        protected = case.get("protected_terms", ())
        if isinstance(protected, str) or not isinstance(protected, Sequence):
            raise ValueError("case protected_terms must be a list of non-empty strings")
        if not all(isinstance(item, str) and item for item in protected):
            raise ValueError("case protected_terms must be a list of non-empty strings")
        values = tuple(protected)
    return _multiset_finding(
        "protected_term_multiset",
        _severity(check),
        _literal_occurrences(_source(case), values),
        _literal_occurrences(output, values),
        output,
    )


def check_numbers(case: Mapping[str, object], output: str, check: Mapping[str, object]) -> tuple[_InvariantEvidence, ...]:
    source_format = _declared_number_format(check, "source")
    target_format = _declared_number_format(check, "target")
    source_pattern = _number_pattern(source_format)
    target_pattern = _number_pattern(target_format)
    source_values = [
        _normalize_number(match.group(0), source_format)
        for match in source_pattern.finditer(_source(case))
    ]
    output_values = [
        _normalize_number(match.group(0), target_format)
        for match in target_pattern.finditer(output)
    ]
    return _multiset_finding(
        "number_multiset", _severity(check), source_values, output_values, output,
    )


def _number_pattern(number_format: tuple[str, str | None] | None) -> re.Pattern[str]:
    if number_format is None:
        return _NUMBER
    decimal, grouping = number_format
    separators = decimal + ("" if grouping is None else grouping)
    return re.compile(
        rf"(?<![\w])[-+]?\d+(?:[{re.escape(separators)}]\d+)*(?:\s?%)?(?![\w])"
    )


def _number_parts(value: str) -> tuple[str, str, str]:
    compact = value.strip()
    suffix = "%" if compact.endswith("%") else ""
    if suffix:
        compact = compact[:-1].rstrip()
    sign = ""
    if compact[:1] in {"+", "-"}:
        sign, compact = compact[0], compact[1:]
    return sign, compact, suffix


def _invalid_number(
    value: str,
    decimal_separator: str | None,
    grouping_separator: str | None,
) -> str:
    return f"invalid:{decimal_separator!r}:{grouping_separator!r}:{value}"


def _normalize_with_separators(
    value: str,
    decimal_separator: str | None,
    grouping_separator: str | None,
) -> str:
    sign, compact, suffix = _number_parts(value)
    if grouping_separator is not None and decimal_separator == grouping_separator:
        return _invalid_number(value, decimal_separator, grouping_separator)
    if decimal_separator is None:
        integer, separator, fraction = compact, "", ""
    else:
        if compact.count(decimal_separator) > 1:
            return _invalid_number(value, decimal_separator, grouping_separator)
        integer, separator, fraction = compact.partition(decimal_separator)
    if grouping_separator is None:
        groups = [integer]
    else:
        groups = integer.split(grouping_separator)
        if len(groups) > 1 and not (
            1 <= len(groups[0]) <= 3
            and all(len(group) == 3 and group.isdigit() for group in groups[1:])
        ):
            return _invalid_number(value, decimal_separator, grouping_separator)
    if not groups or not all(group.isdigit() for group in groups):
        return _invalid_number(value, decimal_separator, grouping_separator)
    if separator and (not fraction or not fraction.isdigit()):
        return _invalid_number(value, decimal_separator, grouping_separator)
    normalized_input = "".join(groups) + (("." + fraction) if separator else "")
    try:
        normalized = format(Decimal(f"{sign}{normalized_input}").normalize(), "f")
    except InvalidOperation:
        return _invalid_number(value, decimal_separator, grouping_separator)
    if normalized == "-0":
        normalized = "0"
    return normalized + suffix


def _infer_number_separators(value: str) -> tuple[str | None, str | None]:
    _, compact, _ = _number_parts(value)
    whitespace = [character for character in compact if character.isspace()]
    punctuation = [
        character for character in compact
        if not character.isdigit() and not character.isspace()
    ]
    punctuation_kinds = set(punctuation)
    if whitespace:
        whitespace_kinds = set(whitespace)
        if len(whitespace_kinds) != 1:
            raise ValueError(
                f"number_multiset requires explicit separators for ambiguous number {value!r}"
            )
        grouping = whitespace[0]
        if len(punctuation_kinds) > 1:
            raise ValueError(
                f"number_multiset requires explicit separators for ambiguous number {value!r}"
            )
        decimal = next(iter(punctuation_kinds), None)
        return decimal, grouping
    if not punctuation:
        return None, None
    if len(punctuation_kinds) == 2:
        last_positions = {
            separator: compact.rfind(separator) for separator in punctuation_kinds
        }
        decimal = max(last_positions, key=last_positions.get)
        grouping = next(separator for separator in punctuation_kinds if separator != decimal)
        return decimal, grouping
    if len(punctuation_kinds) > 2:
        raise ValueError(
            f"number_multiset requires explicit separators for ambiguous number {value!r}"
        )
    separator = punctuation[0]
    if len(punctuation) > 1:
        groups = compact.split(separator)
        if (
            1 <= len(groups[0]) <= 3
            and all(len(group) == 3 and group.isdigit() for group in groups[1:])
        ):
            return None, separator
        raise ValueError(
            f"number_multiset requires explicit separators for ambiguous number {value!r}"
        )
    integer, fraction = compact.split(separator)
    if 1 <= len(integer) <= 3 and len(fraction) == 3:
        raise ValueError(
            f"number_multiset requires explicit separators for ambiguous number {value!r}"
        )
    return separator, None


def _normalize_number(
    value: str,
    number_format: tuple[str, str | None] | None,
) -> str:
    if number_format is None:
        decimal_separator, grouping_separator = _infer_number_separators(value)
    else:
        decimal_separator, grouping_separator = number_format
    return _normalize_with_separators(
        value,
        decimal_separator,
        grouping_separator,
    )


def check_character_limit(case: Mapping[str, object], output: str, check: Mapping[str, object]) -> tuple[_InvariantEvidence, ...]:
    maximum = check.get("max")
    if maximum is None:
        constraints = case.get("constraints", {})
        if isinstance(constraints, Mapping):
            maximum = constraints.get("character_limit")
    if type(maximum) is not int or maximum < 0:
        raise ValueError("character_limit requires a non-negative integer max")
    if len(output) <= maximum:
        return ()
    return (_InvariantEvidence(
        "character_limit", _severity(check), {"max": maximum}, {"length": len(output)},
        (maximum, len(output)), f"output exceeds the {maximum}-character limit",
    ),)


def check_line_count(case: Mapping[str, object], output: str, check: Mapping[str, object]) -> tuple[_InvariantEvidence, ...]:
    expected = check.get("count", check.get("lines"))
    if expected is None:
        expected = len(_source(case).splitlines())
    if type(expected) is not int or expected < 0:
        raise ValueError("line_count requires a non-negative integer count")
    observed = len(output.splitlines())
    if observed == expected:
        return ()
    return (_InvariantEvidence(
        "line_count", _severity(check), expected, observed, None,
        f"expected {expected} lines but observed {observed}",
    ),)


def check_literal_multiset(
    case: Mapping[str, object], output: str, check: Mapping[str, object],
) -> tuple[_InvariantEvidence, ...]:
    values = _string_list(check.get("values"), "literal_multiset values")
    return _multiset_finding(
        "literal_multiset", _severity(check),
        _exact_literal_occurrences(_source(case), values),
        _exact_literal_occurrences(output, values), output,
    )


def check_literal_mapping_multiset(
    case: Mapping[str, object], output: str, check: Mapping[str, object],
) -> tuple[_InvariantEvidence, ...]:
    source = _source(case)
    expected: dict[str, int] = {}
    observed: dict[str, int] = {}
    for mapping in check["mappings"]:
        source_literal = mapping["source"]
        targets = tuple(mapping["targets"])
        label = f"{source_literal} -> {' | '.join(targets)}"
        expected[label] = len(_exact_literal_occurrences(source, (source_literal,)))
        observed[label] = len(_exact_literal_occurrences(output, targets))
        if check.get("require_source_absence", False) and source_literal not in targets:
            absence_label = f"source absent: {source_literal}"
            expected[absence_label] = 0
            observed[absence_label] = len(
                _exact_literal_occurrences(output, (source_literal,))
            )
    if expected == observed:
        return ()
    return (_InvariantEvidence(
        "literal_mapping_multiset", _severity(check), expected, observed, None,
        "candidate changes a declared source-to-target literal mapping",
    ),)


def check_line_character_limits(
    case: Mapping[str, object], output: str, check: Mapping[str, object],
) -> tuple[_InvariantEvidence, ...]:
    maxima = tuple(check["maxima"])
    lines = output.splitlines()
    lengths = tuple(len(line) for line in lines)
    if len(lines) == len(maxima) and all(
        length <= maximum for length, maximum in zip(lengths, maxima)
    ):
        return ()
    return (_InvariantEvidence(
        "line_character_limits", _severity(check), {"maxima": maxima},
        {"line_lengths": lengths}, None,
        "candidate changes the declared line count or exceeds a per-line character limit",
    ),)


def check_delimited_fields(
    case: Mapping[str, object], output: str, check: Mapping[str, object],
) -> tuple[_InvariantEvidence, ...]:
    delimiter = check["delimiter"]
    expected_count = check["count"]
    allow_whitespace = check["allow_whitespace"]
    fields = output.split(delimiter)
    valid = "\n" not in output and len(fields) == expected_count and all(fields)
    if valid and not allow_whitespace:
        valid = all(field == field.strip() for field in fields)
    if valid and check.get("unique", False):
        valid = len(fields) == len(set(fields))
    if valid:
        return ()
    return (_InvariantEvidence(
        "delimited_fields", _severity(check),
        {
            "delimiter": delimiter, "count": expected_count,
            "allow_whitespace": allow_whitespace,
            "unique": check.get("unique", False),
        },
        {"count": len(fields), "fields": fields}, None,
        "candidate violates the declared delimited-field grammar",
    ),)


def _json_line_value(text: str, line: int) -> object:
    lines = text.splitlines()
    if line > len(lines):
        raise _CandidateStructureError(f"JSON line {line} is missing")
    try:
        return json.loads(lines[line - 1])
    except json.JSONDecodeError as error:
        raise _CandidateStructureError(str(error)) from error


def check_json_line_contract(
    case: Mapping[str, object], output: str, check: Mapping[str, object],
) -> tuple[_InvariantEvidence, ...]:
    line = check["line"]
    translatable = set(check["translatable_keys"])
    try:
        expected = _json_line_value(_source(case), line)
    except _CandidateStructureError as error:
        raise ValueError(f"invalid source json_line_contract: {error}") from error
    if not isinstance(expected, dict):
        raise ValueError("source json_line_contract line must contain a JSON object")
    missing = sorted(translatable - set(expected))
    if missing:
        raise ValueError(f"json_line_contract translatable keys are absent: {', '.join(missing)}")
    try:
        observed = _json_line_value(output, line)
    except _CandidateStructureError as error:
        return (_InvariantEvidence(
            "json_line_contract", _severity(check), expected,
            {"parse_error": str(error)}, None,
            "candidate does not contain the declared embedded JSON object",
        ),)
    valid = isinstance(observed, dict) and set(observed) == set(expected)
    if valid:
        valid = all(
            _json_topology(observed[key]) == _json_topology(expected[key])
            if key in translatable else observed[key] == expected[key]
            for key in expected
        )
    if valid:
        return ()
    return (_InvariantEvidence(
        "json_line_contract", _severity(check), expected, observed, None,
        "candidate changes protected keys, values, identifiers, or JSON topology",
    ),)


def _json_topology(value: object) -> object:
    if isinstance(value, dict):
        return {key: _json_topology(item) for key, item in sorted(value.items())}
    if isinstance(value, list):
        return [_json_topology(item) for item in value]
    if value is None:
        return "null"
    if type(value) is bool:
        return "boolean"
    if type(value) in (int, float):
        return "number"
    if isinstance(value, str):
        return "string"
    raise ValueError(f"unsupported JSON value: {type(value).__name__}")


def _parse_json_topology(text: str) -> object:
    try:
        return _json_topology(json.loads(text))
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise _CandidateStructureError(str(error)) from error


def _xml_element_topology(element: ElementTree.Element) -> object:
    return (
        element.tag,
        tuple(sorted(element.attrib)),
        tuple(_xml_element_topology(child) for child in element),
    )


def _parse_xml_topology(text: str) -> object:
    try:
        return _xml_element_topology(ElementTree.fromstring(text))
    except ElementTree.ParseError as error:
        raise _CandidateStructureError(str(error)) from error


_VOID_HTML_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr",
}
_OPTIONAL_HTML_END_TAGS = {
    "colgroup", "dd", "dt", "li", "optgroup", "option", "p", "rb", "rp",
    "rt", "rtc", "tbody", "td", "tfoot", "th", "thead", "tr",
}
_P_CLOSING_START_TAGS = {
    "address", "article", "aside", "blockquote", "details", "dialog", "div",
    "dl", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2",
    "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "main", "menu",
    "nav", "ol", "p", "pre", "search", "section", "table", "ul",
}
_IMPLIED_SIBLING_ENDS = {
    "li": {"li"},
    "dt": {"dt", "dd"},
    "dd": {"dt", "dd"},
    "rt": {"rt", "rp"},
    "rp": {"rt", "rp"},
    "option": {"option"},
    "optgroup": {"option", "optgroup"},
    "colgroup": {"colgroup"},
    "thead": {"colgroup", "tbody", "tfoot"},
    "tbody": {"colgroup", "tbody", "tfoot", "thead"},
    "tfoot": {"colgroup", "tbody", "tfoot", "thead"},
    "tr": {"colgroup", "tr"},
    "td": {"td", "th"},
    "th": {"td", "th"},
}
_IMPLIED_SCOPE_BLOCKERS = {
    "li": {"ol", "ul", "menu"},
    "dt": {"dl"},
    "dd": {"dl"},
    "rt": {"ruby"},
    "rp": {"ruby"},
    "option": {"datalist", "optgroup", "select"},
    "optgroup": {"select"},
    "colgroup": {"table"},
    "thead": {"table"},
    "tbody": {"table"},
    "tfoot": {"table"},
    "tr": {"table", "tbody", "tfoot", "thead"},
    "td": {"table", "tr"},
    "th": {"table", "tr"},
}


class _TopologyHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root: list[object] = []
        self.stack: list[tuple[str, list[object]]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        closable = set(_IMPLIED_SIBLING_ENDS.get(tag, ()))
        if tag in _P_CLOSING_START_TAGS:
            closable.add("p")
        blockers = _IMPLIED_SCOPE_BLOCKERS.get(tag, set())
        for index in range(len(self.stack) - 1, -1, -1):
            open_tag = self.stack[index][0]
            if open_tag in closable:
                del self.stack[index:]
                break
            if open_tag in blockers:
                break
        children: list[object] = []
        node = (tag, tuple(sorted(name for name, _ in attrs)), children)
        (self.stack[-1][1] if self.stack else self.root).append(node)
        if tag not in _VOID_HTML_TAGS:
            self.stack.append((tag, children))

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        node = (tag, tuple(sorted(name for name, _ in attrs)), [])
        (self.stack[-1][1] if self.stack else self.root).append(node)

    def handle_endtag(self, tag: str) -> None:
        matching = next(
            (index for index in range(len(self.stack) - 1, -1, -1) if self.stack[index][0] == tag),
            None,
        )
        if matching is None or any(
            open_tag not in _OPTIONAL_HTML_END_TAGS
            for open_tag, _ in self.stack[matching + 1:]
        ):
            raise _CandidateStructureError(f"unexpected closing HTML tag: {tag}")
        del self.stack[matching:]

    def topology(self) -> object:
        if any(tag not in _OPTIONAL_HTML_END_TAGS for tag, _ in self.stack):
            raise _CandidateStructureError(f"unclosed HTML tag: {self.stack[-1][0]}")
        self.stack.clear()
        return _freeze_lists(self.root)


def _freeze_lists(value: object) -> object:
    if isinstance(value, list):
        return tuple(_freeze_lists(item) for item in value)
    if isinstance(value, tuple):
        return tuple(_freeze_lists(item) for item in value)
    return value


def _parse_html_topology(text: str) -> object:
    parser = _TopologyHTMLParser()
    try:
        parser.feed(text)
        parser.close()
        return parser.topology()
    except _CandidateStructureError:
        raise
    except Exception as error:
        raise _CandidateStructureError(str(error)) from error


_MARKDOWN_LINK = re.compile(r"(!?)\[[^\]\n]*\]\(([^\s)]+)(?:\s+[^)]*)?\)")
_MARKDOWN_REFERENCE_DEFINITION = re.compile(
    r"^ {0,3}\[((?:\\[^\n]|[^\\\]\n])+)\]:[ \t]*(?:<([^>\n]+)>|(\S+))",
    re.MULTILINE,
)
_MARKDOWN_REFERENCE_TITLE = re.compile(
    r'''^ {0,3}(?:"(?:\\[^\n]|[^\\"\n])*"|'''
    r"'(?:\\[^\n]|[^\\'\n])*'|"
    r"\((?:\\[^\n]|[^\\)\n])*\))[ \t]*$"
)
_MARKDOWN_HEADING = re.compile(r"^(#{1,6})\s+")
_MARKDOWN_LIST = re.compile(r"^(\s*)([-+*]|\d+[.)])\s+")
_MARKDOWN_QUOTE = re.compile(r"^(\s*(?:>\s*)+)")
_MARKDOWN_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")
_MARKDOWN_CONTAINER_LIST = re.compile(
    r"^ {0,3}(?:[-+*]|\d{1,9}[.)])([ \t]+)"
)
_MARKDOWN_CONTAINER_QUOTE = re.compile(r"^ {0,3}>[ \t]?")


def _parse_markdown_topology(text: str) -> object:
    headings: list[int] = []
    lists: list[tuple[int, str]] = []
    quotes: list[int] = []
    fences: list[str] = []
    active_lines: list[str] = []
    open_fence: tuple[str, int, tuple[tuple[str, int], ...]] | None = None
    for line in text.splitlines():
        if open_fence is not None:
            fence_line = _markdown_fence_content(line, open_fence[2])
            fence = (
                None if fence_line is None else _MARKDOWN_FENCE.match(fence_line)
            )
            if fence:
                marker = fence.group(1)
                remainder = fence.group(2)
                if (
                    marker[0] == open_fence[0]
                    and len(marker) >= open_fence[1]
                    and not remainder.strip(" \t")
                ):
                    open_fence = None
            active_lines.append("")
            continue
        fence_line, containers = _markdown_container_content(line)
        fence = _MARKDOWN_FENCE.match(fence_line)
        if fence:
            marker = fence.group(1)
            info = fence.group(2)
            if marker[0] != "`" or "`" not in info:
                open_fence = (marker[0], len(marker), containers)
                fences.append(info.strip())
                item = _MARKDOWN_LIST.match(line)
                if item:
                    lists.append((
                        len(item.group(1).expandtabs(4)),
                        "ordered" if item.group(2)[0].isdigit() else "unordered",
                    ))
                quote = _MARKDOWN_QUOTE.match(line)
                if quote:
                    quotes.append(quote.group(1).count(">"))
                active_lines.append("")
                continue
        if fence_line.startswith("\t") or fence_line.startswith("    "):
            active_lines.append("")
            item = _MARKDOWN_LIST.match(line)
            if item:
                lists.append((
                    len(item.group(1).expandtabs(4)),
                    "ordered" if item.group(2)[0].isdigit() else "unordered",
                ))
            quote = _MARKDOWN_QUOTE.match(line)
            if quote:
                quotes.append(quote.group(1).count(">"))
            continue
        active_lines.append(line)
        heading = _MARKDOWN_HEADING.match(line)
        if heading:
            headings.append(len(heading.group(1)))
        item = _MARKDOWN_LIST.match(line)
        if item:
            lists.append((len(item.group(1).expandtabs(4)), "ordered" if item.group(2)[0].isdigit() else "unordered"))
        quote = _MARKDOWN_QUOTE.match(line)
        if quote:
            quotes.append(quote.group(1).count(">"))
    if open_fence is not None:
        raise _CandidateStructureError("unclosed Markdown code fence")
    active_text = "\n".join(active_lines)
    definitions, definition_spans = _markdown_reference_definitions(active_text)
    use_text = _blank_spans(active_text, definition_spans)
    use_text = _blank_spans(use_text, _markdown_code_span_spans(use_text))
    links: list[tuple[str, str]] = []
    occupied_spans: list[tuple[int, int]] = []
    for match in _MARKDOWN_LINK.finditer(use_text):
        bracket = match.start() + (1 if match.group(1) else 0)
        if _markdown_is_escaped(use_text, bracket):
            continue
        occupied_spans.append(match.span())
        is_image = bool(match.group(1)) and not _markdown_is_escaped(
            use_text, match.start()
        )
        links.append(("image" if is_image else "link", match.group(2)))
    reference_uses: list[tuple[str, str]] = []
    reference_uses.extend(
        _markdown_full_reference_uses(use_text, definitions, occupied_spans)
    )
    reference_uses.extend(
        _markdown_shortcut_uses(use_text, definitions, occupied_spans)
    )
    return {
        "headings": tuple(headings),
        "lists": tuple(lists),
        "quotes": tuple(quotes),
        "fences": tuple(fences),
        "links": tuple(links),
        "reference_uses": tuple(reference_uses),
        "reference_definitions": tuple(sorted(definitions.values())),
    }


def _markdown_container_content(
    line: str,
) -> tuple[str, tuple[tuple[str, int], ...]]:
    content = line
    containers: list[tuple[str, int]] = []
    while True:
        quote = _MARKDOWN_CONTAINER_QUOTE.match(content)
        if quote:
            containers.append(("quote", 0))
            content = content[quote.end():]
            continue
        item = _MARKDOWN_CONTAINER_LIST.match(content)
        if item:
            marker_column = len(content[:item.start(1)].expandtabs(4))
            prefix_column = len(content[:item.end()].expandtabs(4))
            indentation = prefix_column - marker_column
            if indentation > 4:
                return (
                    " " * (indentation - 1) + content[item.end():],
                    tuple(containers),
                )
            containers.append((
                "list",
                prefix_column,
            ))
            content = content[item.end():]
            continue
        return content, tuple(containers)


def _markdown_fence_content(
    line: str,
    containers: Sequence[tuple[str, int]],
) -> str | None:
    content = line
    for kind, width in containers:
        if kind == "quote":
            quote = _MARKDOWN_CONTAINER_QUOTE.match(content)
            if quote is None:
                return None
            content = content[quote.end():]
            continue
        position = 0
        column = 0
        while position < len(content) and column < width:
            if content[position] == " ":
                column += 1
            elif content[position] == "\t":
                column += 4 - (column % 4)
            else:
                return None
            position += 1
        if column < width:
            return None
        content = content[position:]
    return content


def _split_line_ending(line: str) -> tuple[str, str]:
    content = line.rstrip("\r\n")
    return content, line[len(content):]


def _parse_fenced_blocks_exact(text: str) -> object:
    blocks: list[object] = []
    active: dict[str, object] | None = None
    for raw_line in text.splitlines(keepends=True):
        line, ending = _split_line_ending(raw_line)
        if active is not None:
            body_line = _markdown_fence_content(line, active["containers"])
            fence = None if body_line is None else _MARKDOWN_FENCE.match(body_line)
            if fence:
                marker = fence.group(1)
                remainder = fence.group(2)
                if (
                    marker[0] == active["marker"]
                    and len(marker) >= active["width"]
                    and not remainder.strip(" \t")
                ):
                    blocks.append((
                        active["marker"], active["width"], active["info"],
                        active["containers"], len(marker), "".join(active["body"]),
                    ))
                    active = None
                    continue
            active["body"].append((line if body_line is None else body_line) + ending)
            continue

        fence_line, containers = _markdown_container_content(line)
        fence = _MARKDOWN_FENCE.match(fence_line)
        if fence:
            marker = fence.group(1)
            info = fence.group(2)
            if marker[0] != "`" or "`" not in info:
                active = {
                    "marker": marker[0], "width": len(marker), "info": info,
                    "containers": containers, "body": [],
                }
    if active is not None:
        raise _CandidateStructureError("unclosed Markdown code fence")
    if not blocks:
        raise _CandidateStructureError("no Markdown fenced blocks")
    return tuple(blocks)


def _markdown_reference_definitions(
    text: str,
) -> tuple[dict[str, str], list[tuple[int, int]]]:
    definitions: dict[str, str] = {}
    spans: list[tuple[int, int]] = []
    for match in _MARKDOWN_REFERENCE_DEFINITION.finditer(text):
        definitions.setdefault(
            _markdown_label(match.group(1)),
            match.group(2) or match.group(3),
        )
        line_end = text.find("\n", match.end())
        span_end = len(text) if line_end < 0 else line_end
        if line_end >= 0 and not text[match.end():line_end].strip(" \t"):
            next_line_start = line_end + 1
            next_line_end = text.find("\n", next_line_start)
            if next_line_end < 0:
                next_line_end = len(text)
            if _MARKDOWN_REFERENCE_TITLE.fullmatch(
                text[next_line_start:next_line_end]
            ):
                span_end = next_line_end
        spans.append((match.start(), span_end))
    return definitions, spans


def _markdown_label(value: str) -> str:
    return " ".join(value.split()).casefold()


def _blank_spans(text: str, spans: Sequence[tuple[int, int]]) -> str:
    characters = list(text)
    for start, end in spans:
        characters[start:end] = " " * (end - start)
    return "".join(characters)


def _spans_overlap(left: tuple[int, int], right: tuple[int, int]) -> bool:
    return left[0] < right[1] and right[0] < left[1]


def _markdown_is_escaped(text: str, position: int) -> bool:
    backslashes = 0
    position -= 1
    while position >= 0 and text[position] == "\\":
        backslashes += 1
        position -= 1
    return backslashes % 2 == 1


def _markdown_code_span_spans(text: str) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    position = 0
    while position < len(text):
        if text[position] != "`" or _markdown_is_escaped(text, position):
            position += 1
            continue
        opening = position
        while position < len(text) and text[position] == "`":
            position += 1
        width = position - opening
        closing = position
        while closing < len(text):
            closing = text.find("`" * width, closing)
            if closing < 0:
                break
            if (
                (closing == 0 or text[closing - 1] != "`")
                and (closing + width == len(text) or text[closing + width] != "`")
            ):
                spans.append((opening, closing + width))
                position = closing + width
                break
            closing += width
        if closing < 0:
            position = opening + width
    return spans


def _markdown_closing_bracket(text: str, opening: int) -> int | None:
    position = opening + 1
    while position < len(text) and text[position] != "\n":
        if text[position] == "]" and not _markdown_is_escaped(text, position):
            return position
        position += 1
    return None


def _markdown_full_reference_uses(
    text: str,
    definitions: Mapping[str, str],
    occupied_spans: list[tuple[int, int]],
) -> list[tuple[str, str]]:
    uses: list[tuple[str, str]] = []
    position = 0
    while position < len(text):
        opening = text.find("[", position)
        if opening < 0:
            break
        if _markdown_is_escaped(text, opening):
            position = opening + 1
            continue
        closing = _markdown_closing_bracket(text, opening)
        if closing is None or closing + 1 >= len(text) or text[closing + 1] != "[":
            position = opening + 1
            continue
        label_opening = closing + 1
        label_closing = _markdown_closing_bracket(text, label_opening)
        if label_closing is None:
            position = label_opening + 1
            continue
        image_marker = opening - 1
        is_image = (
            image_marker >= 0
            and text[image_marker] == "!"
            and not _markdown_is_escaped(text, image_marker)
        )
        span = (image_marker if is_image else opening, label_closing + 1)
        if not any(_spans_overlap(span, occupied) for occupied in occupied_spans):
            occupied_spans.append(span)
            label_text = text[label_opening + 1:label_closing]
            label = _markdown_label(
                label_text or text[opening + 1:closing]
            )
            if label in definitions:
                uses.append((
                    "image" if is_image else "link",
                    definitions[label],
                ))
        position = label_closing + 1
    return uses


def _markdown_shortcut_uses(
    text: str,
    definitions: Mapping[str, str],
    occupied_spans: Sequence[tuple[int, int]],
) -> list[tuple[str, str]]:
    uses: list[tuple[str, str]] = []
    position = 0
    while position < len(text):
        opening = text.find("[", position)
        if opening < 0:
            break
        if _markdown_is_escaped(text, opening):
            position = opening + 1
            continue
        closing = _markdown_closing_bracket(text, opening)
        if closing is None:
            position = opening + 1
            continue
        span = (opening, closing + 1)
        if (
            (closing + 1 < len(text) and text[closing + 1] in "[(")
            or any(_spans_overlap(span, occupied) for occupied in occupied_spans)
        ):
            position = closing + 1
            continue
        label = _markdown_label(text[opening + 1:closing])
        if label in definitions:
            image_marker = opening - 1
            is_image = (
                image_marker >= 0
                and text[image_marker] == "!"
                and not _markdown_is_escaped(text, image_marker)
            )
            uses.append(("image" if is_image else "link", definitions[label]))
        position = closing + 1
    return uses


def _csv_dialect(text: str, configured: object = None) -> str:
    if configured is not None:
        if not isinstance(configured, str) or len(configured) != 1:
            raise ValueError("csv_shape delimiter must be one character")
        return configured
    try:
        return csv.Sniffer().sniff(text, delimiters=",;\t|").delimiter
    except csv.Error:
        return ","


def _parse_csv_topology(text: str, delimiter: str) -> object:
    try:
        rows = list(csv.reader(io.StringIO(text, newline=""), delimiter=delimiter, strict=True))
    except csv.Error as error:
        raise _CandidateStructureError(str(error)) from error
    if not rows:
        raise _CandidateStructureError("CSV contains no rows")
    return delimiter, tuple(len(row) for row in rows)


_ICU_PATTERN_WHITESPACE = frozenset(
    "\u0009\u000a\u000b\u000c\u000d\u0020\u0085\u200e\u200f\u2028\u2029"
)
_ICU_NUMBER = re.compile(
    r"[+-]?(?:(?:[0-9]+(?:\.[0-9]*)?)|(?:\.[0-9]+))"
    r"(?:[eE][+-]?[0-9]+)?"
)


class _ICUParser:
    def __init__(self, text: str) -> None:
        self.text = text
        self.position = 0

    def parse(self) -> object:
        topology = self._message(stop=False)
        if self.position != len(self.text):
            raise _CandidateStructureError("unexpected ICU parser remainder")
        return topology

    def _message(self, *, stop: bool) -> tuple[object, ...]:
        arguments: list[object] = []
        while self.position < len(self.text):
            character = self.text[self.position]
            if character == "'":
                self._quoted_text()
            elif character == "{":
                arguments.append(self._argument())
            elif character == "}":
                if not stop:
                    raise _CandidateStructureError("unexpected ICU closing brace")
                self.position += 1
                return tuple(sorted(arguments, key=repr))
            else:
                self.position += 1
        if stop:
            raise _CandidateStructureError("unclosed ICU argument")
        return tuple(sorted(arguments, key=repr))

    def _quoted_text(self) -> None:
        self.position += 1
        if self.position >= len(self.text):
            return
        if self.text[self.position] == "'":
            self.position += 1
            return
        if self.text[self.position] not in "{}#":
            return
        while self.position < len(self.text):
            if self.text[self.position] == "'":
                self.position += 1
                if self.position < len(self.text) and self.text[self.position] == "'":
                    self.position += 1
                    continue
                return
            self.position += 1

    def _argument(self) -> object:
        self.position += 1
        name = self._token({",", "}"})
        if not name:
            raise _CandidateStructureError("ICU argument name is empty")
        delimiter = self._current()
        if delimiter == "}":
            self.position += 1
            return name, "argument", (), ()
        self.position += 1
        formatter = self._token({",", "}"}).lower()
        if not formatter:
            raise _CandidateStructureError(f"ICU argument {name} has no formatter")
        delimiter = self._current()
        if delimiter == "}":
            if formatter in {"plural", "selectordinal", "select"}:
                raise _CandidateStructureError(
                    f"ICU {formatter} argument {name} requires selectors"
                )
            self.position += 1
            return name, formatter, (), ()
        self.position += 1
        if formatter in {"plural", "selectordinal", "select"}:
            return self._select_argument(name, formatter)
        self._consume_formatter_style()
        return name, formatter, (), ()

    def _select_argument(self, name: str, formatter: str) -> object:
        branches: dict[str, object] = {}
        offset: str | None = None
        while True:
            self._skip_space()
            if self._current() == "}":
                self.position += 1
                if not branches:
                    raise _CandidateStructureError(f"ICU {formatter} argument has no selectors")
                if "other" not in branches:
                    raise _CandidateStructureError(
                        f"ICU {formatter} argument requires an other selector"
                    )
                return name, formatter, (() if offset is None else (("offset", offset),)), tuple(sorted(branches.items()))
            selector = self._selector_token()
            if selector.startswith("offset:"):
                if formatter == "select" or offset is not None or branches:
                    raise _CandidateStructureError("invalid ICU plural offset")
                offset_text = selector.split(":", 1)[1]
                if not offset_text:
                    self._skip_space()
                    offset_text = self._selector_token()
                if _ICU_NUMBER.fullmatch(offset_text) is None:
                    raise _CandidateStructureError("invalid ICU plural offset")
                try:
                    numeric_offset = Decimal(offset_text)
                    double_offset = float(offset_text)
                except (InvalidOperation, OverflowError, ValueError):
                    raise _CandidateStructureError("invalid ICU plural offset") from None
                if numeric_offset < 0 or not math.isfinite(double_offset):
                    raise _CandidateStructureError("invalid ICU plural offset")
                offset = "0" if numeric_offset == 0 else str(numeric_offset.normalize())
                continue
            self._skip_space()
            if not selector or self._current() != "{":
                raise _CandidateStructureError(f"invalid ICU selector in {name}")
            if not self._valid_selector(formatter, selector):
                raise _CandidateStructureError(
                    f"invalid ICU {formatter} selector: {selector}"
                )
            if selector in branches:
                raise _CandidateStructureError(f"duplicate ICU selector: {selector}")
            self.position += 1
            branches[selector] = self._message(stop=True)

    @staticmethod
    def _valid_selector(formatter: str, selector: str) -> bool:
        if formatter == "select":
            return re.fullmatch(r"[A-Za-z_][\w.-]*", selector) is not None
        return (
            selector in {"zero", "one", "two", "few", "many", "other"}
            or re.fullmatch(r"=-?(?:0|[1-9]\d*)(?:\.\d+)?", selector) is not None
        )

    def _consume_formatter_style(self) -> None:
        depth = 0
        while self.position < len(self.text):
            character = self.text[self.position]
            if character == "'":
                self._quoted_text()
            elif character == "{":
                depth += 1
                self.position += 1
            elif character == "}":
                if depth == 0:
                    self.position += 1
                    return
                depth -= 1
                self.position += 1
            else:
                self.position += 1
        raise _CandidateStructureError("unclosed ICU formatter")

    def _token(self, delimiters: set[str]) -> str:
        self._skip_space()
        start = self.position
        while self.position < len(self.text) and self.text[self.position] not in delimiters:
            self.position += 1
        return self.text[start:self.position].strip("".join(_ICU_PATTERN_WHITESPACE))

    def _selector_token(self) -> str:
        self._skip_space()
        start = self.position
        while (
            self.position < len(self.text)
            and self.text[self.position] not in _ICU_PATTERN_WHITESPACE
            and self.text[self.position] not in "{}"
        ):
            self.position += 1
        return self.text[start:self.position]

    def _skip_space(self) -> None:
        while (
            self.position < len(self.text)
            and self.text[self.position] in _ICU_PATTERN_WHITESPACE
        ):
            self.position += 1

    def _current(self) -> str:
        if self.position >= len(self.text):
            raise _CandidateStructureError("unexpected end of ICU message")
        return self.text[self.position]


def _structured_check(
    invariant: str,
    case: Mapping[str, object],
    output: str,
    check: Mapping[str, object],
    parser: Callable[[str], object],
) -> tuple[_InvariantEvidence, ...]:
    try:
        expected = parser(_source(case))
    except _CandidateStructureError as error:
        raise ValueError(f"invalid source {invariant}: {error}") from error
    try:
        observed = parser(output)
    except _CandidateStructureError as error:
        return (_InvariantEvidence(
            invariant, _severity(check), expected, {"parse_error": str(error)}, None,
            f"candidate is not valid for {invariant}",
        ),)
    if expected == observed:
        return ()
    return (_InvariantEvidence(
        invariant, _severity(check), expected, observed, None,
        f"candidate changes the declared {invariant} topology",
    ),)


def check_json_structure(case: Mapping[str, object], output: str, check: Mapping[str, object]) -> tuple[_InvariantEvidence, ...]:
    return _structured_check("json_structure", case, output, check, _parse_json_topology)


def check_xml_structure(case: Mapping[str, object], output: str, check: Mapping[str, object]) -> tuple[_InvariantEvidence, ...]:
    return _structured_check("xml_structure", case, output, check, _parse_xml_topology)


def check_html_structure(case: Mapping[str, object], output: str, check: Mapping[str, object]) -> tuple[_InvariantEvidence, ...]:
    return _structured_check("html_structure", case, output, check, _parse_html_topology)


def check_markdown_structure(case: Mapping[str, object], output: str, check: Mapping[str, object]) -> tuple[_InvariantEvidence, ...]:
    return _structured_check("markdown_structure", case, output, check, _parse_markdown_topology)


def check_fenced_block_exact(
    case: Mapping[str, object], output: str, check: Mapping[str, object],
) -> tuple[_InvariantEvidence, ...]:
    return _structured_check(
        "fenced_block_exact", case, output, check, _parse_fenced_blocks_exact,
    )


def check_csv_shape(case: Mapping[str, object], output: str, check: Mapping[str, object]) -> tuple[_InvariantEvidence, ...]:
    delimiter = _csv_dialect(_source(case), check.get("delimiter"))
    parser = lambda text: _parse_csv_topology(text, delimiter)
    return _structured_check("csv_shape", case, output, check, parser)


def check_icu_topology(case: Mapping[str, object], output: str, check: Mapping[str, object]) -> tuple[_InvariantEvidence, ...]:
    return _structured_check("icu_topology", case, output, check, lambda text: _ICUParser(text).parse())


def check_forbidden_locale_form(case: Mapping[str, object], output: str, check: Mapping[str, object]) -> tuple[_InvariantEvidence, ...]:
    configured = check.get("forms", check.get("forbidden"))
    if isinstance(configured, Mapping):
        forms = tuple(configured)
    elif isinstance(configured, Sequence) and not isinstance(configured, (str, bytes)):
        forms = tuple(configured)
    else:
        raise ValueError("forbidden_locale_form requires forms")
    if not all(isinstance(form, str) and form for form in forms):
        raise ValueError("forbidden locale forms must be non-empty strings")
    flags = 0 if check.get("case_sensitive", False) else re.IGNORECASE
    observed: list[str] = []
    first_span: tuple[int, int] | None = None
    for form in forms:
        for match in re.finditer(rf"(?<!\w){re.escape(form)}(?!\w)", output, flags):
            observed.append(match.group(0))
            if first_span is None:
                first_span = match.span()
    if not observed:
        return ()
    return (_InvariantEvidence(
        "forbidden_locale_form", _severity(check), {"absent": sorted(forms)},
        {"present": observed}, first_span, "candidate contains a declared forbidden locale form",
    ),)


CHECKS: dict[str, Check] = {
    "placeholder_multiset": check_placeholders,
    "format_specifier_multiset": check_format_specifiers,
    "url_multiset": check_urls,
    "email_multiset": check_emails,
    "code_span_multiset": check_code_spans,
    "command_multiset": check_commands,
    "identifier_multiset": check_identifiers,
    "protected_term_multiset": check_protected_terms,
    "number_multiset": check_numbers,
    "character_limit": check_character_limit,
    "line_count": check_line_count,
    "literal_multiset": check_literal_multiset,
    "literal_mapping_multiset": check_literal_mapping_multiset,
    "line_character_limits": check_line_character_limits,
    "delimited_fields": check_delimited_fields,
    "json_line_contract": check_json_line_contract,
    "json_structure": check_json_structure,
    "xml_structure": check_xml_structure,
    "html_structure": check_html_structure,
    "markdown_structure": check_markdown_structure,
    "fenced_block_exact": check_fenced_block_exact,
    "csv_shape": check_csv_shape,
    "icu_topology": check_icu_topology,
    "forbidden_locale_form": check_forbidden_locale_form,
}



def _validate_invariants_with_evidence(
    *,
    source: str,
    candidate: str,
    source_locale: str,
    target_locale: str,
    protected_terms: Sequence[str],
    checks: Sequence[Mapping[str, object]],
    _context: Mapping[str, object] | None = None,
) -> tuple[_InvariantEvidence, ...]:
    context = _context if _context is not None else {
        "source": source,
        "source_locale": source_locale,
        "target_locale": target_locale,
        "protected_terms": list(protected_terms),
    }
    findings: list[_InvariantEvidence] = []
    for check in checks:
        validate_check_declaration(check)
        check_findings = CHECKS[check["type"]](context, candidate, check)
        if not isinstance(check_findings, tuple) or not all(
            isinstance(finding, _InvariantEvidence) for finding in check_findings
        ):
            raise TypeError("validator returned an invalid finding collection")
        findings.extend(check_findings)
    return tuple(findings)


def validate_invariants(
    *,
    source: str,
    candidate: str,
    source_locale: str,
    target_locale: str,
    protected_terms: Sequence[str],
    checks: Sequence[Mapping[str, object]],
) -> Sequence[ValidationFinding]:
    return tuple(
        ValidationFinding(
            check=finding.check,
            severity=finding.severity,
            message=finding.message,
            span=finding.span,
        )
        for finding in _validate_invariants_with_evidence(
            source=source,
            candidate=candidate,
            source_locale=source_locale,
            target_locale=target_locale,
            protected_terms=protected_terms,
            checks=checks,
        )
    )
