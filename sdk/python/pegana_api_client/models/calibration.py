from enum import StrEnum


class Calibration(StrEnum):
    CALIBRATED = "calibrated"
    PROVISIONAL = "provisional"

    def __str__(self) -> str:
        return str(self.value)
