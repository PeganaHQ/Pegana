from enum import StrEnum


class RiskSide(StrEnum):
    BELOW = "below"
    EITHER = "either"

    def __str__(self) -> str:
        return str(self.value)
