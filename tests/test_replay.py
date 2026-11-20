from backend.store import replay

def test_snapshot_does_not_use_future_laps_positions_intervals_or_weather():
    driver={"driver_number":1,"name_acronym":"TST","team_name":"Test"}
    lap={"driver_number":1,"race_lap":1,"date_end":"2024-01-01T00:01:30+00:00","lap_duration":90,"compound":"MEDIUM","tyre_age":0,"exclusions":[]}
    data={"race":{"total_laps":1},"drivers":[driver],"laps":[lap],"stints":[],
          "position":[{"driver_number":1,"date":"2024-01-01T00:01:00+00:00","position":2},{"driver_number":1,"date":"2024-01-01T00:01:31+00:00","position":1}],
          "intervals":[{"driver_number":1,"date":"2024-01-01T00:01:00+00:00","gap_to_leader":2.5},{"driver_number":1,"date":"2024-01-01T00:01:31+00:00","gap_to_leader":0}],
          "weather":[{"date":"2024-01-01T00:00:00+00:00","track_temperature":30},{"date":"2024-01-01T00:01:31+00:00","track_temperature":50}]}
    result=replay(data)["snapshots"][0]
    assert result["drivers"][0]["position"]==2
    assert result["drivers"][0]["gap_to_leader"]==2.5
    assert result["weather"]["track_temperature"]==30
    assert result["drivers"][0]["completed_lap"]==1


def test_unchanged_position_remains_valid_while_old_interval_expires():
    driver={"driver_number":1,"name_acronym":"TST","team_name":"Test"}
    lap={"driver_number":1,"race_lap":1,"date_end":"2024-01-01T00:10:00+00:00","lap_duration":90,"compound":"MEDIUM","tyre_age":0,"exclusions":[]}
    data={"race":{"total_laps":1},"drivers":[driver],"laps":[lap],"stints":[],"weather":[],
          "position":[{"driver_number":1,"date":"2024-01-01T00:00:00+00:00","position":1}],
          "intervals":[{"driver_number":1,"date":"2024-01-01T00:00:00+00:00","gap_to_leader":2.5}]}
    result=replay(data)["snapshots"][0]["drivers"][0]
    assert result["position"]==1
    assert result["gap_to_leader"] is None
