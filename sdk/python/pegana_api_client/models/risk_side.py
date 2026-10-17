from enum import Enum

class RiskSide(str, Enum):
    BELOW = "below"
    EITHER = "either"

    def __str__(self) -> str:
        return str(self.value)
