from enum import StrEnum


class Anchor(StrEnum):
    FX = "FX"
    NAV = "NAV"
    USD = "USD"

    def __str__(self) -> str:
        return str(self.value)
