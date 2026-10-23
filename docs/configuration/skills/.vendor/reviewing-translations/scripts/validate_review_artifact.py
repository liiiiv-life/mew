#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import re
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path


def _load_invariants():
    path = Path(__file__).with_name("invariants.py")
    name = "_review_artifact_invariants"
    existing = sys.modules.get(name)
    if existing is not None:
        return existing
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load translation invariant validator")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


_invariants = _load_invariants()
validate_check_declaration = _invariants.validate_check_declaration
validate_invariants = _invariants.validate_invariants


def _load_draft_terminology_validator():
    path = (
        Path(__file__).resolve().parents[2]
        / "translating-products/scripts/policy.py"
    )
    name = "_draft_terminology_policy"
    existing = sys.modules.get(name)
    if existing is not None:
        return existing.validate_draft_terminology
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load draft terminology validator")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module.validate_draft_terminology


CLASSIFICATIONS = (
    "no_issue_detected",
    "change_recommended",
    "blocked_by_source",
    "unresolved",
)
REVIEW_DEPTHS = ("single", "selective_challenge", "full_challenge")
CONFIDENCES = ("low", "medium", "high")
ADJUDICATION_STATUSES = (
    "not_required",
    "accepted_primary",
    "accepted_challenge",
    "merged",
    "unresolved",
)
DISAGREEMENT_STATUSES = ADJUDICATION_STATUSES[1:]
HUMAN_STATUSES = ("not_requested", "pending", "completed")
HUMAN_DECISIONS = ("no_issue_detected", "change_required")
HUMAN_SEVERITIES = ("minor", "major", "critical")
LOCALE = re.compile(r"^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$")

REQUEST_FIELDS = ("schema_version", "review_id", "source_locale", "targets")
REQUEST_TARGET_FIELDS = (
    "target_locale", "review_depth", "selected_capabilities",
    "missing_capabilities", "runtime_ui_review", "units",
)
RUNTIME_UI_REQUEST_FIELDS = ("decision", "required", "reasons")
REQUEST_UNIT_FIELDS = (
    "unit_id", "source", "current_target", "protected_terms", "automatic_checks",
)
REQUEST_UNIT_OPTIONAL_FIELDS = ("source_invariant",)
RESULT_FIELDS = ("schema_version", "review_id", "source_locale", "locales", "summary")
RESULT_LOCALE_FIELDS = (
    "target_locale", "review_depth", "execution_mode", "selected_capabilities",
    "missing_capabilities", "runtime_ui_review", "units",
)
RESULT_LOCALE_OPTIONAL_FIELDS = ("research",)
RUNTIME_UI_RESULT_FIELDS = ("status", "reason", "evidence")
RESULT_UNIT_FIELDS = (
    "unit_id", "source", "current_target", "classification", "primary", "challenge",
    "adjudication", "recommendation", "recommendation_qa", "source_issue",
    "human_review",
)
PASS_FIELDS = ("issues", "confidence", "native_review_required", "native_review_reason")
ISSUE_FIELDS = ("dimension", "issue", "owner", "affected_segment")
ADJUDICATION_FIELDS = ("status", "rationale")
RECOMMENDATION_FIELDS = ("text", "owner")
QA_FIELDS = ("status", "issues")
SOURCE_ISSUE_FIELDS = ("issue", "blocks_decision")
HUMAN_FIELDS = ("status", "decision", "correction", "notes", "severity", "reviewer")
RESEARCH_FIELDS = ("question", "source")
SUMMARY_FIELDS = ("locales", "units", "counts")


def _object(
    value: object,
    path: str,
    required: Sequence[str],
    errors: list[str],
    *,
    nullable: bool = False,
    optional: Sequence[str] = (),
) -> Mapping[str, object] | None:
    if value is None and nullable:
        return None
    if not isinstance(value, Mapping):
        errors.append(f"{path} must be an object" + (" or null" if nullable else ""))
        return None
    for key in value:
        if type(key) is not str:
            errors.append(f"{path} field names must be strings")
    string_keys = {key for key in value if type(key) is str}
    for field in required:
        if field not in string_keys:
            errors.append(f"{path}.{field} is required")
    for field in sorted(string_keys - set(required) - set(optional)):
        errors.append(f"{path}.{field} is an unknown field")
    return value


def _list(value: object, path: str, errors: list[str], *, nonempty: bool = False) -> list | None:
    if type(value) is not list:
        errors.append(f"{path} must be a list")
        return None
    if nonempty and not value:
        errors.append(f"{path} must not be empty")
    return value


def _text(
    value: object,
    path: str,
    errors: list[str],
    *,
    nonblank: bool = False,
    nullable: bool = False,
) -> str | None:
    if value is None and nullable:
        return None
    if type(value) is not str:
        errors.append(f"{path} must be text" + (" or null" if nullable else ""))
        return None
    if nonblank and not value.strip():
        errors.append(f"{path} must be nonblank text")
    return value


def _enum(
    value: object,
    path: str,
    allowed: Sequence[str],
    errors: list[str],
    *,
    nullable: bool = False,
) -> str | None:
    if value is None and nullable:
        return None
    if type(value) is not str or value not in allowed:
        suffix = " or null" if nullable else ""
        errors.append(f"{path} must be one of {', '.join(allowed)}{suffix}")
        return None
    return value


def _integer(value: object, path: str, errors: list[str], *, minimum: int | None = None) -> int | None:
    if type(value) is not int:
        errors.append(f"{path} must be an integer")
        return None
    if minimum is not None and value < minimum:
        errors.append(f"{path} must be at least {minimum}")
    return value


def _boolean(value: object, path: str, errors: list[str]) -> bool | None:
    if type(value) is not bool:
        errors.append(f"{path} must be boolean")
        return None
    return value


def _locale(value: object, path: str, errors: list[str]) -> str | None:
    text = _text(value, path, errors, nonblank=True)
    if text is not None and text.strip() and not LOCALE.fullmatch(text):
        errors.append(f"{path} must be a BCP-47 locale string")
    return text


def _string_list(value: object, path: str, errors: list[str]) -> list[str] | None:
    values = _list(value, path, errors)
    if values is None:
        return None
    result: list[str] = []
    for index, item in enumerate(values):
        text = _text(item, f"{path}[{index}]", errors, nonblank=True)
        if text is not None:
            result.append(text)
    duplicates = sorted({item for item in result if result.count(item) > 1})
    for item in duplicates:
        errors.append(f"{path} contains duplicate value {item!r}")
    return result


def _check_finite_json(value: object, path: str, errors: list[str]) -> None:
    if type(value) is float and not math.isfinite(value):
        errors.append(f"{path} must contain only finite JSON values")
        return
    if isinstance(value, Mapping):
        for key, item in value.items():
            child = f"{path}.{key}" if type(key) is str else f"{path}[field]"
            _check_finite_json(item, child, errors)
    elif type(value) is list:
        for index, item in enumerate(value):
            _check_finite_json(item, f"{path}[{index}]", errors)


def _validate_issue(value: object, path: str, errors: list[str]) -> tuple[str, str, str, str] | None:
    issue = _object(value, path, ISSUE_FIELDS, errors)
    if issue is None:
        return None
    values = tuple(
        _text(issue.get(field), f"{path}.{field}", errors, nonblank=True)
        for field in ISSUE_FIELDS
    )
    if all(item is not None and item.strip() for item in values):
        return values  # type: ignore[return-value]
    return None


def _validate_pass(
    value: object,
    path: str,
    errors: list[str],
    *,
    nullable: bool,
) -> tuple[Mapping[str, object] | None, tuple[tuple[str, str, str, str], ...]]:
    review = _object(value, path, PASS_FIELDS, errors, nullable=nullable)
    if review is None:
        return None, ()
    raw_issues = _list(review.get("issues"), f"{path}.issues", errors)
    signatures: list[tuple[str, str, str, str]] = []
    if raw_issues is not None:
        for index, issue in enumerate(raw_issues):
            signature = _validate_issue(issue, f"{path}.issues[{index}]", errors)
            if signature is not None:
                signatures.append(signature)
        for signature in sorted({item for item in signatures if signatures.count(item) > 1}):
            errors.append(f"{path}.issues contains duplicate issue {signature!r}")
    _enum(review.get("confidence"), f"{path}.confidence", CONFIDENCES, errors)
    native_required = _boolean(
        review.get("native_review_required"), f"{path}.native_review_required", errors
    )
    reason = _text(
        review.get("native_review_reason"),
        f"{path}.native_review_reason",
        errors,
        nullable=True,
    )
    if native_required is True and (reason is None or not reason.strip()):
        errors.append(f"{path}.native_review_reason must be nonblank when native review is required")
    if native_required is False and reason is not None:
        errors.append(f"{path}.native_review_reason must be null when native review is not required")
    return review, tuple(sorted(signatures))


def _validate_adjudication(
    value: object,
    path: str,
    errors: list[str],
) -> tuple[str | None, str | None]:
    adjudication = _object(value, path, ADJUDICATION_FIELDS, errors)
    if adjudication is None:
        return None, None
    status = _enum(
        adjudication.get("status"), f"{path}.status", ADJUDICATION_STATUSES, errors
    )
    rationale = _text(
        adjudication.get("rationale"), f"{path}.rationale", errors, nullable=True
    )
    return status, rationale


def _validate_recommendation(value: object, path: str, errors: list[str]) -> Mapping[str, object] | None:
    recommendation = _object(value, path, RECOMMENDATION_FIELDS, errors, nullable=True)
    if recommendation is None:
        return None
    _text(recommendation.get("text"), f"{path}.text", errors, nonblank=True)
    _text(recommendation.get("owner"), f"{path}.owner", errors, nonblank=True)
    return recommendation


def _validate_qa(value: object, path: str, errors: list[str]) -> Mapping[str, object] | None:
    qa = _object(value, path, QA_FIELDS, errors, nullable=True)
    if qa is None:
        return None
    _enum(qa.get("status"), f"{path}.status", ("passed", "unresolved"), errors)
    _string_list(qa.get("issues"), f"{path}.issues", errors)
    return qa


def _validate_source_issue(value: object, path: str, errors: list[str]) -> Mapping[str, object] | None:
    issue = _object(value, path, SOURCE_ISSUE_FIELDS, errors, nullable=True)
    if issue is None:
        return None
    _text(issue.get("issue"), f"{path}.issue", errors, nonblank=True)
    _boolean(issue.get("blocks_decision"), f"{path}.blocks_decision", errors)
    return issue


def _validate_research(value: object, path: str, errors: list[str]) -> None:
    research = _object(value, path, RESEARCH_FIELDS, errors, nullable=True)
    if research is None:
        return
    _text(research.get("question"), f"{path}.question", errors, nonblank=True)
    _text(research.get("source"), f"{path}.source", errors, nonblank=True)


def _validate_human_review(value: object, path: str, errors: list[str]) -> None:
    human = _object(value, path, HUMAN_FIELDS, errors)
    if human is None:
        return
    status = _enum(human.get("status"), f"{path}.status", HUMAN_STATUSES, errors)
    decision = _enum(
        human.get("decision"), f"{path}.decision", HUMAN_DECISIONS, errors, nullable=True
    )
    correction = _text(human.get("correction"), f"{path}.correction", errors, nullable=True)
    notes = _text(human.get("notes"), f"{path}.notes", errors, nullable=True)
    severity = _enum(
        human.get("severity"), f"{path}.severity", HUMAN_SEVERITIES, errors, nullable=True
    )
    reviewer = _text(human.get("reviewer"), f"{path}.reviewer", errors, nullable=True)
    if status == "completed":
        if decision is None:
            errors.append(f"{path}.decision is required for completed human review")
        if reviewer is None or not reviewer.strip():
            errors.append(f"{path}.reviewer must be nonblank for completed human review")
        if decision == "change_required":
            if correction is None or not correction.strip():
                errors.append(f"{path}.correction must be nonblank when change is required")
            if severity is None:
                errors.append(f"{path}.severity is required when change is required")
        elif decision == "no_issue_detected":
            if correction is not None:
                errors.append(f"{path}.correction must be null when no issue is detected")
            if severity is not None:
                errors.append(f"{path}.severity must be null when no issue is detected")
    elif status in ("not_requested", "pending"):
        for field, field_value in (
            ("decision", decision), ("correction", correction), ("notes", notes),
            ("severity", severity), ("reviewer", reviewer),
        ):
            if field_value is not None:
                errors.append(f"{path}.{field} must be null unless human review is completed")


def _validate_runtime_ui_review_request(
    value: object,
    path: str,
    errors: list[str],
) -> Mapping[str, object] | None:
    record = _object(value, path, RUNTIME_UI_REQUEST_FIELDS, errors)
    if record is None:
        return None
    _enum(record.get("decision"), f"{path}.decision", ("run", "skip", "ask"), errors)
    _boolean(record.get("required"), f"{path}.required", errors)
    reasons = _string_list(record.get("reasons"), f"{path}.reasons", errors)
    if reasons is not None and not reasons:
        errors.append(f"{path}.reasons must not be empty")
    return record


def _validate_runtime_ui_review_result(
    value: object,
    path: str,
    errors: list[str],
) -> Mapping[str, object] | None:
    record = _object(value, path, RUNTIME_UI_RESULT_FIELDS, errors)
    if record is None:
        return None
    _enum(
        record.get("status"),
        f"{path}.status",
        ("completed", "not_run", "unavailable", "not_applicable"),
        errors,
    )
    _text(record.get("reason"), f"{path}.reason", errors, nonblank=True, nullable=True)
    _string_list(record.get("evidence"), f"{path}.evidence", errors)
    return record


def _validate_request(request: Mapping[str, object], errors: list[str]) -> dict[str, dict]:
    root = _object(request, "request", REQUEST_FIELDS, errors)
    targets_by_locale: dict[str, dict] = {}
    if root is None:
        return targets_by_locale
    version = _integer(root.get("schema_version"), "request.schema_version", errors)
    if version is not None and version != 2:
        errors.append("request.schema_version must equal 2")
    _text(root.get("review_id"), "request.review_id", errors, nonblank=True)
    _locale(root.get("source_locale"), "request.source_locale", errors)
    targets = _list(root.get("targets"), "request.targets", errors, nonempty=True)
    if targets is None:
        return targets_by_locale
    for target_index, target_value in enumerate(targets):
        path = f"request.targets[{target_index}]"
        target = _object(target_value, path, REQUEST_TARGET_FIELDS, errors)
        if target is None:
            continue
        locale = _locale(target.get("target_locale"), f"{path}.target_locale", errors)
        depth = _enum(target.get("review_depth"), f"{path}.review_depth", REVIEW_DEPTHS, errors)
        selected = _string_list(target.get("selected_capabilities"), f"{path}.selected_capabilities", errors)
        missing = _string_list(target.get("missing_capabilities"), f"{path}.missing_capabilities", errors)
        runtime_ui_review = _validate_runtime_ui_review_request(
            target.get("runtime_ui_review"), f"{path}.runtime_ui_review", errors
        )
        units = _list(target.get("units"), f"{path}.units", errors, nonempty=True)
        unit_map: dict[str, Mapping[str, object]] = {}
        if units is not None:
            for unit_index, unit_value in enumerate(units):
                unit_path = f"{path}.units[{unit_index}]"
                unit = _object(
                    unit_value,
                    unit_path,
                    REQUEST_UNIT_FIELDS,
                    errors,
                    optional=REQUEST_UNIT_OPTIONAL_FIELDS,
                )
                if unit is None:
                    continue
                unit_id = _text(unit.get("unit_id"), f"{unit_path}.unit_id", errors, nonblank=True)
                _text(unit.get("source"), f"{unit_path}.source", errors)
                _text(unit.get("current_target"), f"{unit_path}.current_target", errors)
                _string_list(unit.get("protected_terms"), f"{unit_path}.protected_terms", errors)
                if "source_invariant" in unit:
                    _boolean(
                        unit.get("source_invariant"),
                        f"{unit_path}.source_invariant",
                        errors,
                    )
                checks = _list(unit.get("automatic_checks"), f"{unit_path}.automatic_checks", errors)
                declaration_keys: list[str] = []
                if checks is not None:
                    for check_index, check in enumerate(checks):
                        check_path = f"{unit_path}.automatic_checks[{check_index}]"
                        if not isinstance(check, Mapping):
                            errors.append(f"{check_path} must be an object")
                            continue
                        try:
                            validate_check_declaration(check)
                        except (TypeError, ValueError) as error:
                            errors.append(f"{check_path}: {error}")
                        try:
                            declaration_keys.append(json.dumps(check, sort_keys=True, separators=(",", ":")))
                        except (TypeError, ValueError):
                            pass
                    for key in sorted({item for item in declaration_keys if declaration_keys.count(item) > 1}):
                        errors.append(f"{unit_path}.automatic_checks contains duplicate declaration {key}")
                if unit_id is not None and unit_id.strip():
                    if unit_id in unit_map:
                        errors.append(f"{path}.units contains duplicate unit {unit_id!r}")
                    else:
                        unit_map[unit_id] = unit
        if locale is not None and locale.strip():
            if locale in targets_by_locale:
                errors.append(f"request.targets contains duplicate target locale {locale!r}")
            else:
                targets_by_locale[locale] = {
                    "value": target,
                    "depth": depth,
                    "selected": selected,
                    "missing": missing,
                    "runtime_ui_review": runtime_ui_review,
                    "units": unit_map,
                }
    return targets_by_locale


def _validate_result_shape(result: Mapping[str, object], errors: list[str]) -> list[Mapping[str, object]]:
    root = _object(result, "result", RESULT_FIELDS, errors)
    if root is None:
        return []
    version = _integer(root.get("schema_version"), "result.schema_version", errors)
    if version is not None and version != 2:
        errors.append("result.schema_version must equal 2")
    _text(root.get("review_id"), "result.review_id", errors, nonblank=True)
    _locale(root.get("source_locale"), "result.source_locale", errors)
    locales = _list(root.get("locales"), "result.locales", errors, nonempty=True)
    valid_locales: list[Mapping[str, object]] = []
    if locales is not None:
        for index, locale_value in enumerate(locales):
            path = f"result.locales[{index}]"
            locale = _object(
                locale_value,
                path,
                RESULT_LOCALE_FIELDS,
                errors,
                optional=RESULT_LOCALE_OPTIONAL_FIELDS,
            )
            if locale is None:
                continue
            _locale(locale.get("target_locale"), f"{path}.target_locale", errors)
            _enum(locale.get("review_depth"), f"{path}.review_depth", REVIEW_DEPTHS, errors)
            _enum(locale.get("execution_mode"), f"{path}.execution_mode", ("sequential", "parallel"), errors)
            _string_list(locale.get("selected_capabilities"), f"{path}.selected_capabilities", errors)
            _string_list(locale.get("missing_capabilities"), f"{path}.missing_capabilities", errors)
            _validate_runtime_ui_review_result(
                locale.get("runtime_ui_review"), f"{path}.runtime_ui_review", errors
            )
            _list(locale.get("units"), f"{path}.units", errors, nonempty=True)
            if "research" in locale:
                _validate_research(locale.get("research"), f"{path}.research", errors)
            valid_locales.append(locale)
    summary = _object(root.get("summary"), "result.summary", SUMMARY_FIELDS, errors)
    if summary is not None:
        _integer(summary.get("locales"), "result.summary.locales", errors, minimum=0)
        _integer(summary.get("units"), "result.summary.units", errors, minimum=0)
        counts = _object(summary.get("counts"), "result.summary.counts", CLASSIFICATIONS, errors)
        if counts is not None:
            for classification in CLASSIFICATIONS:
                _integer(
                    counts.get(classification),
                    f"result.summary.counts.{classification}",
                    errors,
                    minimum=0,
                )
    return valid_locales


def _relationship_errors(
    request: Mapping[str, object],
    result: Mapping[str, object],
    errors: list[str],
) -> None:
    if request.get("review_id") != result.get("review_id"):
        errors.append("result.review_id does not match request.review_id")
    if request.get("source_locale") != result.get("source_locale"):
        errors.append("result.source_locale does not match request.source_locale")


def _accepted_issue_signatures(
    primary: tuple[tuple[str, str, str, str], ...],
    challenge: tuple[tuple[str, str, str, str], ...],
    *,
    challenge_present: bool,
    adjudication_status: str | None,
) -> tuple[tuple[str, str, str, str], ...] | None:
    if not challenge_present or primary == challenge:
        return primary
    if adjudication_status == "accepted_primary":
        return primary
    if adjudication_status == "accepted_challenge":
        return challenge
    if adjudication_status == "merged":
        return tuple(sorted(set(primary) | set(challenge)))
    return None


def _validate_completed_candidate(
    candidate: object,
    path: str,
    request_unit: Mapping[str, object] | None,
    *,
    source: object,
    source_locale: object,
    target_locale: str,
    errors: list[str],
) -> None:
    if request_unit is None or type(candidate) is not str:
        return
    checks = request_unit.get("automatic_checks")
    protected_terms = request_unit.get("protected_terms")
    if (
        type(source_locale) is str
        and type(source) is str
        and type(checks) is list
        and type(protected_terms) is list
        and all(isinstance(check, Mapping) for check in checks)
        and all(type(term) is str for term in protected_terms)
    ):
        effective_checks = list(checks)
        protected_check_index = next(
            (
                index
                for index, check in enumerate(effective_checks)
                if check.get("type") == "protected_term_multiset"
            ),
            None,
        )
        if protected_terms and protected_check_index is None:
            effective_checks.append({
                "type": "protected_term_multiset",
                "severity": "critical",
            })
        elif protected_terms and protected_check_index is not None:
            declared = effective_checks[protected_check_index]
            configured_key = next(
                (key for key in ("values", "terms") if key in declared),
                None,
            )
            if configured_key is not None:
                configured_value = declared[configured_key]
                if (
                    not isinstance(configured_value, str)
                    and isinstance(configured_value, Sequence)
                    and all(type(term) is str for term in configured_value)
                ):
                    configured = list(configured_value)
                    configured.extend(
                        term for term in protected_terms if term not in configured
                    )
                    augmented = dict(declared)
                    augmented[configured_key] = configured
                    effective_checks[protected_check_index] = augmented
        try:
            findings = validate_invariants(
                source=source,
                candidate=candidate,
                source_locale=source_locale,
                target_locale=target_locale,
                protected_terms=protected_terms,
                checks=effective_checks,
            )
        except (TypeError, ValueError) as error:
            errors.append(f"{path} automatic checks could not run: {error}")
        else:
            reported_protected_errors: set[str] = set()
            for finding in findings:
                rendered = (
                    f"{path} failed {finding.check} "
                    f"({finding.severity}): {finding.message}"
                )
                if finding.check == "protected_term_multiset":
                    if rendered in reported_protected_errors:
                        continue
                    reported_protected_errors.add(rendered)
                errors.append(rendered)


def _validate_result_unit(
    unit_value: object,
    path: str,
    request_unit: Mapping[str, object] | None,
    *,
    source_locale: object,
    target_locale: str,
    review_depth: str | None,
    errors: list[str],
) -> str | None:
    unit = _object(unit_value, path, RESULT_UNIT_FIELDS, errors)
    if unit is None:
        return None
    unit_id = _text(unit.get("unit_id"), f"{path}.unit_id", errors, nonblank=True)
    source = _text(unit.get("source"), f"{path}.source", errors)
    current = _text(unit.get("current_target"), f"{path}.current_target", errors)
    classification = _enum(
        unit.get("classification"), f"{path}.classification", CLASSIFICATIONS, errors
    )
    primary, primary_signatures = _validate_pass(
        unit.get("primary"), f"{path}.primary", errors, nullable=False
    )
    challenge, challenge_signatures = _validate_pass(
        unit.get("challenge"), f"{path}.challenge", errors, nullable=True
    )
    adjudication_status, rationale = _validate_adjudication(
        unit.get("adjudication"), f"{path}.adjudication", errors
    )
    recommendation = _validate_recommendation(
        unit.get("recommendation"), f"{path}.recommendation", errors
    )
    qa = _validate_qa(unit.get("recommendation_qa"), f"{path}.recommendation_qa", errors)
    source_issue = _validate_source_issue(unit.get("source_issue"), f"{path}.source_issue", errors)
    _validate_human_review(unit.get("human_review"), f"{path}.human_review", errors)

    if request_unit is not None:
        if source != request_unit.get("source"):
            errors.append(f"{path}.source does not match request source")
        if current != request_unit.get("current_target"):
            errors.append(f"{path}.current_target does not match request current_target")

    if review_depth == "single" and challenge is not None:
        errors.append(f"{path}.challenge must be null for single review depth")
    elif (
        review_depth == "selective_challenge"
        and primary is not None
        and not primary_signatures
        and challenge is None
    ):
        errors.append(f"{path}.challenge is required for selective challenge no-issue coverage")
    elif review_depth == "full_challenge" and challenge is None:
        errors.append(f"{path}.challenge is required for full challenge coverage")

    disagreement = challenge is not None and primary_signatures != challenge_signatures
    if disagreement:
        if adjudication_status not in DISAGREEMENT_STATUSES:
            errors.append(f"{path}.adjudication requires adjudication for primary/challenge disagreement")
        if rationale is None or not rationale.strip():
            errors.append(f"{path}.adjudication requires a nonblank rationale for disagreement")
    elif adjudication_status is not None:
        if adjudication_status != "not_required":
            errors.append(f"{path}.adjudication.status must be not_required without disagreement")
        if rationale is not None:
            errors.append(f"{path}.adjudication.rationale must be null without disagreement")
    if adjudication_status == "unresolved" and classification not in (None, "unresolved"):
        errors.append(f"{path}.classification must be unresolved for unresolved adjudication")

    accepted_signatures = _accepted_issue_signatures(
        primary_signatures,
        challenge_signatures,
        challenge_present=challenge is not None,
        adjudication_status=adjudication_status,
    )
    if accepted_signatures is not None:
        if classification == "no_issue_detected" and accepted_signatures:
            errors.append(
                f"{path}.classification no_issue_detected requires an empty accepted issue set"
            )
        elif classification == "change_recommended" and not accepted_signatures:
            errors.append(
                f"{path}.classification change_recommended is invalid because the accepted issue set is empty"
            )
        elif classification == "blocked_by_source" and accepted_signatures:
            errors.append(
                f"{path}.classification blocked_by_source requires an empty accepted issue set"
            )

    if classification == "no_issue_detected":
        if recommendation is not None:
            errors.append(f"{path}.recommendation must be null for no_issue_detected")
        if qa is not None:
            errors.append(f"{path}.recommendation_qa must be null for no_issue_detected")
        if source_issue is not None and source_issue.get("blocks_decision") is not False:
            errors.append(
                f"{path}.source_issue.blocks_decision must be false for no_issue_detected"
            )
        _validate_completed_candidate(
            current, f"{path}.current_target", request_unit,
            source=source, source_locale=source_locale,
            target_locale=target_locale, errors=errors,
        )
    elif classification == "change_recommended":
        if recommendation is None:
            errors.append(f"{path}.classification change_recommended requires recommendation")
        if qa is None:
            errors.append(f"{path}.classification change_recommended requires recommendation_qa")
        else:
            if qa.get("status") != "passed":
                errors.append(f"{path}.recommendation_qa.status must be passed")
            if qa.get("issues") != []:
                errors.append(f"{path}.recommendation_qa.issues must be empty")
        if source_issue is not None and source_issue.get("blocks_decision") is not False:
            errors.append(
                f"{path}.source_issue.blocks_decision must be false for change_recommended"
            )
        if recommendation is not None:
            text = recommendation.get("text")
            if type(text) is str and text == current:
                errors.append(f"{path}.recommendation.text must differ from current_target")
            source_invariant = (
                request_unit.get("source_invariant", False)
                if request_unit is not None
                else False
            )
            if type(text) is str and text == source and source_invariant is not True:
                errors.append(
                    f"{path}.recommendation.text must not equal source unless source_invariant is true"
                )
            if accepted_signatures:
                accepted_owners = {signature[2] for signature in accepted_signatures}
                if recommendation.get("owner") not in accepted_owners:
                    errors.append(
                        f"{path}.recommendation.owner must match an owner in the accepted issue set"
                    )
            _validate_completed_candidate(
                text, f"{path}.recommendation", request_unit,
                source=source, source_locale=source_locale,
                target_locale=target_locale, errors=errors,
            )
    elif classification == "blocked_by_source":
        if source_issue is None:
            errors.append(f"{path}.classification blocked_by_source requires source_issue")
        elif source_issue.get("blocks_decision") is not True:
            errors.append(f"{path}.source_issue.blocks_decision must be true for blocked_by_source")
        if recommendation is not None:
            errors.append(f"{path}.recommendation must be null for blocked_by_source")
        if qa is not None:
            errors.append(f"{path}.recommendation_qa must be null for blocked_by_source")
    elif classification == "unresolved":
        if source_issue is not None:
            errors.append(f"{path}.source_issue must be null for unresolved")
        if recommendation is None and qa is not None:
            errors.append(f"{path}.recommendation is required when unresolved QA is retained")
            if qa.get("status") != "unresolved":
                errors.append(f"{path}.recommendation_qa.status must be unresolved")
        elif recommendation is not None:
            if qa is None:
                errors.append(f"{path}.recommendation_qa is required for retained unresolved recommendation")
            elif qa.get("status") != "unresolved":
                errors.append(f"{path}.recommendation_qa.status must be unresolved")
    return classification


def _validate_coverage_and_units(
    request: Mapping[str, object],
    result: Mapping[str, object],
    targets: dict[str, dict],
    result_locales: list[Mapping[str, object]],
    errors: list[str],
) -> tuple[int, dict[str, int]]:
    seen_locales: set[str] = set()
    total_units = 0
    counts = {classification: 0 for classification in CLASSIFICATIONS}
    for locale_index, locale_record in enumerate(result_locales):
        path = f"result.locales[{locale_index}]"
        locale = locale_record.get("target_locale")
        if type(locale) is not str:
            continue
        if locale in seen_locales:
            errors.append(f"result.locales contains duplicate target locale {locale!r}")
            continue
        seen_locales.add(locale)
        request_target = targets.get(locale)
        if request_target is None:
            errors.append(f"result.locales contains unknown target locale {locale!r}")
        else:
            if locale_record.get("review_depth") != request_target["value"].get("review_depth"):
                errors.append(f"{path}.review_depth does not match request review_depth")
            if locale_record.get("selected_capabilities") != request_target["value"].get("selected_capabilities"):
                errors.append(f"{path}.selected_capabilities do not match request")
            if locale_record.get("missing_capabilities") != request_target["value"].get("missing_capabilities"):
                errors.append(f"{path}.missing_capabilities do not match request")
            _validate_runtime_ui_review_relationship(
                request_target.get("runtime_ui_review"),
                locale_record.get("runtime_ui_review"),
                f"{path}.runtime_ui_review",
                errors,
            )
        request_units = {} if request_target is None else request_target["units"]
        raw_units = locale_record.get("units")
        if type(raw_units) is not list:
            continue
        seen_units: set[str] = set()
        for unit_index, unit_value in enumerate(raw_units):
            unit_path = f"{path}.units[{unit_index}]"
            unit_id = unit_value.get("unit_id") if isinstance(unit_value, Mapping) else None
            request_unit = request_units.get(unit_id) if type(unit_id) is str else None
            if type(unit_id) is str:
                if unit_id in seen_units:
                    errors.append(f"{path}.units contains duplicate unit {unit_id!r}")
                else:
                    seen_units.add(unit_id)
                if request_target is not None and request_unit is None:
                    errors.append(f"{path}.units contains unknown unit {unit_id!r}")
            classification = _validate_result_unit(
                unit_value,
                unit_path,
                request_unit,
                source_locale=request.get("source_locale"),
                target_locale=locale,
                review_depth=locale_record.get("review_depth") if type(locale_record.get("review_depth")) is str else None,
                errors=errors,
            )
            total_units += 1
            if classification in counts:
                counts[classification] += 1
        for unit_id in request_units:
            if unit_id not in seen_units:
                errors.append(f"{path}.units is missing unit {unit_id!r}")
    for locale in targets:
        if locale not in seen_locales:
            errors.append(f"result.locales is missing target locale {locale!r}")
    return total_units, counts


def _validate_runtime_ui_review_relationship(
    request_record: object,
    result_record: object,
    path: str,
    errors: list[str],
) -> None:
    if not isinstance(request_record, Mapping) or not isinstance(result_record, Mapping):
        return
    decision = request_record.get("decision")
    required = request_record.get("required")
    reasons = request_record.get("reasons")
    status = result_record.get("status")
    reason = result_record.get("reason")
    evidence = result_record.get("evidence")
    has_evidence = isinstance(evidence, list) and bool(evidence)
    has_reason = isinstance(reason, str) and bool(reason.strip())

    if status == "completed":
        if not has_evidence:
            errors.append(f"{path} completed runtime UI review requires evidence")
        if reason is not None:
            errors.append(f"{path}.reason must be null when status is completed")
        if decision != "run":
            errors.append(f"{path} completed requires a run decision")
    elif status == "not_run":
        if not has_reason:
            errors.append(f"{path}.reason must be nonblank when status is not_run")
        if has_evidence:
            errors.append(f"{path}.evidence must be empty when status is not_run")
        if decision != "skip":
            errors.append(f"{path} not_run requires a skip decision")
        if required is True:
            errors.append(f"{path} required runtime UI review cannot be not_run")
    elif status == "unavailable":
        if not has_reason:
            errors.append(f"{path}.reason must be nonblank when status is unavailable")
        if decision != "run":
            errors.append(f"{path} unavailable requires a run decision")
    elif status == "not_applicable":
        if has_evidence:
            errors.append(f"{path}.evidence must be empty when status is not_applicable")
        if decision != "skip":
            errors.append(f"{path} not_applicable requires a skip decision")
        if not isinstance(reasons, list) or "no-applicable-runtime-surface" not in reasons:
            errors.append(
                f"{path} not_applicable requires no-applicable-runtime-surface"
            )


def _validate_summary(
    result: Mapping[str, object],
    locale_count: int,
    unit_count: int,
    counts: Mapping[str, int],
    errors: list[str],
) -> None:
    summary = result.get("summary")
    if not isinstance(summary, Mapping):
        return
    if summary.get("locales") != locale_count:
        errors.append(f"result.summary.locales must equal derived value {locale_count}")
    if summary.get("units") != unit_count:
        errors.append(f"result.summary.units must equal derived value {unit_count}")
    declared_counts = summary.get("counts")
    if not isinstance(declared_counts, Mapping):
        return
    for classification in CLASSIFICATIONS:
        if declared_counts.get(classification) != counts[classification]:
            errors.append(
                f"result.summary.counts.{classification} must equal derived value "
                f"{counts[classification]}"
            )


def validate_review_artifact(
    request: Mapping[str, object],
    result: Mapping[str, object],
) -> Sequence[str]:
    """Return stable ordered validation errors for a request/result artifact pair."""
    errors: list[str] = []
    if not isinstance(request, Mapping):
        return ("request must be an object",)
    if not isinstance(result, Mapping):
        return ("result must be an object",)
    _check_finite_json(request, "request", errors)
    _check_finite_json(result, "result", errors)
    targets = _validate_request(request, errors)
    result_locales = _validate_result_shape(result, errors)
    _relationship_errors(request, result, errors)
    unit_count, counts = _validate_coverage_and_units(
        request, result, targets, result_locales, errors
    )
    _validate_summary(result, len(result_locales), unit_count, counts, errors)
    return tuple(errors)


def _reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    value: dict[str, object] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError(f"duplicate JSON key: {key}")
        value[key] = item
    return value


def _reject_nonfinite(constant: str) -> object:
    raise ValueError(f"non-finite JSON constant: {constant}")


def _load_json(path: Path, label: str) -> object:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as error:
        raise ValueError(f"unable to read {label} file {path}: {error}") from error
    try:
        return json.loads(
            text,
            object_pairs_hook=_reject_duplicate_keys,
            parse_constant=_reject_nonfinite,
        )
    except (json.JSONDecodeError, UnicodeError, ValueError) as error:
        raise ValueError(f"invalid {label} JSON in {path}: {error}") from error


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate a structured translation review artifact",
        allow_abbrev=False,
    )
    parser.add_argument("--request", required=True, type=Path)
    parser.add_argument("--result", required=True, type=Path)
    parser.add_argument("--draft-terminology", type=Path)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        request = _load_json(args.request, "request")
        result = _load_json(args.result, "result")
        draft_text = (
            args.draft_terminology.read_text(encoding="utf-8")
            if args.draft_terminology is not None
            else None
        )
    except ValueError as error:
        print(error, file=sys.stderr)
        return 2
    except (OSError, UnicodeError) as error:
        print(f"unable to read draft terminology file: {error}", file=sys.stderr)
        return 2
    if not isinstance(request, Mapping) or not isinstance(result, Mapping):
        print("request and result JSON roots must be objects", file=sys.stderr)
        return 2
    errors = list(validate_review_artifact(request, result))
    if draft_text is not None:
        errors.extend(_load_draft_terminology_validator()(draft_text))
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    summary = result["summary"]
    payload = {
        "valid": True,
        "locales": summary["locales"],
        "units": summary["units"],
        "counts": {
            classification: summary["counts"][classification]
            for classification in CLASSIFICATIONS
        },
    }
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
