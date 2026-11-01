"""Human-readable validation errors that never echo input values (they may hold secrets or user data)."""

from pydantic import ValidationError

MAXIMUM_REPORTED_VALIDATION_ERRORS = 5


def describe_validation_error(error: ValidationError) -> str:
    """Field paths and messages only: input values may contain user data and are never echoed."""
    problems = [
        f"{'.'.join(str(part) for part in detail['loc']) or '<root>'}: {detail['msg']}"
        for detail in error.errors(include_input=False, include_url=False)[
            :MAXIMUM_REPORTED_VALIDATION_ERRORS
        ]
    ]
    remaining_count = error.error_count() - len(problems)
    if remaining_count > 0:
        problems.append(f"... and {remaining_count} more")
    return "; ".join(problems)
