"""Age is estimated from completed months entered by the parent, anchored in KST."""
from datetime import date
from pydantic import BaseModel, Field, field_validator
from app.utils.time import kst_now

class ChildInput(BaseModel):
    child_name: str = Field(min_length=1, max_length=100)
    child_age_months: int = Field(ge=0, le=71, strict=True)

    @field_validator("child_name", mode="before")
    @classmethod
    def trim_child_name(cls, value):
        return value.strip() if isinstance(value, str) else value


def age_months(profile, at=None):
    if not profile or profile.child_age_months is None or not profile.age_recorded_on:
        return None
    day = (at or kst_now()).date()
    anchor = profile.age_recorded_on
    # Completed months only: no invented birthday; historical ages are estimates.
    from calendar import monthrange
    def ordinal(d): return d.year * 12 + d.month
    distance = ordinal(day) - ordinal(anchor)
    anniversary = date(day.year, day.month, min(anchor.day, monthrange(day.year, day.month)[1]))
    if day < anniversary:
        distance -= 1
    value = profile.child_age_months + distance
    return value if value >= 0 else None


def age_policy(months):
    if months is None or months >= 72:
        return {'stage': 'unknown', 'sleepHours': None, 'mealsPerDay': None, 'timingEligible': False}
    if months < 4:
        return {'stage': '0-3', 'sleepHours': [14,17], 'mealsPerDay': None, 'timingEligible': False}
    if months < 6:
        return {'stage': '4-5', 'sleepHours': [12,16], 'mealsPerDay': None, 'timingEligible': True}
    if months < 9:
        return {'stage': '6-8', 'sleepHours': [12,16], 'mealsPerDay': [2,3], 'timingEligible': True}
    if months < 12:
        return {'stage': '9-11', 'sleepHours': [12,16], 'mealsPerDay': [3,4], 'timingEligible': True}
    if months < 24:
        return {'stage': '12-23', 'sleepHours': [11,14], 'mealsPerDay': [3,4], 'timingEligible': True}
    if months < 36:
        return {'stage': '24-35', 'sleepHours': [11,14], 'mealsPerDay': None, 'timingEligible': True}
    return {'stage': '36+', 'sleepHours': [10,13], 'mealsPerDay': None, 'timingEligible': False}


def serialize_profile(profile, at=None):
    months = age_months(profile, at)
    return {'childName': profile.child_name if profile else None, 'ageMonths': months,
            'enteredAgeMonths': profile.child_age_months if profile else None,
            'ageRecordedOn': str(profile.age_recorded_on) if profile and profile.age_recorded_on else None,
            'ageEstimated': months is not None, 'agePolicy': age_policy(months)}
