from enum import StrEnum


class PegState(StrEnum):
    BLACK_SWAN = "BLACK_SWAN"
    CRITICAL = "CRITICAL"
    DEPEG = "DEPEG"
    DRIFT = "DRIFT"
    PEGGED = "PEGGED"
    UNKNOWN = "UNKNOWN"

    def __str__(self) -> str:
        return str(self.value)
