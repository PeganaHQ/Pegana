from enum import Enum

class Calibration(str, Enum):
    CALIBRATED = "calibrated"
    PROVISIONAL = "provisional"

    def __str__(self) -> str:
        return str(self.value)
