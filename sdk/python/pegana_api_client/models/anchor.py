from enum import Enum

class Anchor(str, Enum):
    FX = "FX"
    NAV = "NAV"
    USD = "USD"

    def __str__(self) -> str:
        return str(self.value)
