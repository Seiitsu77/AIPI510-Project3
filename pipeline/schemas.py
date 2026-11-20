"""OpenF1 transport contracts. Additional source fields are preserved in raw JSON."""
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field

class Record(BaseModel):
    model_config = ConfigDict(extra="ignore")
    session_key: int

class Session(Record):
    session_name: str
    date_start: datetime
    date_end: datetime
    year: int
    location: str
    country_name: str
    circuit_short_name: str

class Driver(Record):
    driver_number: int
    name_acronym: str
    full_name: str
    team_name: str
    team_colour: str | None = None

class Lap(Record):
    driver_number: int
    lap_number: int = Field(ge=1)
    date_start: datetime | None = None
    lap_duration: float | None = None
    is_pit_out_lap: bool | None = None

class Stint(Record):
    driver_number: int
    stint_number: int
    lap_start: int | None = None
    lap_end: int | None = None
    compound: str | None = None
    tyre_age_at_start: int | None = None

class Weather(Record):
    date: datetime
    track_temperature: float | None = None
    air_temperature: float | None = None
    rainfall: float | None = None

class Position(Record):
    driver_number: int
    date: datetime
    position: int

class Interval(Record):
    driver_number: int
    date: datetime
    gap_to_leader: float | str | None = None

class Pit(Record):
    driver_number: int
    date: datetime
    lap_number: int | None = None

class Control(Record):
    date: datetime
    category: str
    message: str
    flag: str | None = None
    scope: str | None = None
    driver_number: int | None = None
    lap_number: int | None = None

CONTRACTS = {"sessions": Session, "drivers": Driver, "laps": Lap, "stints": Stint,
             "weather": Weather, "position": Position, "intervals": Interval,
             "pit": Pit, "race_control": Control}

def validate(endpoint, records):
    if not isinstance(records, list):
        raise ValueError(f"{endpoint}: expected a JSON array")
    for row in records:
        CONTRACTS[endpoint].model_validate(row)
    return records
