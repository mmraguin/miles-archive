#!/usr/bin/env python3
"""
garmin_sync.py

Pulls today's health data from Garmin Connect and creates a daily journal .md file.
Skips the day if the file already exists. Write once, never overwrite.

Usage:
  python garmin_sync.py
"""

import os
import subprocess
from datetime import date
from pathlib import Path
from typing import Optional

import garth
from garminconnect import Garmin

# ─── CONFIG ───────────────────────────────────────────────────────────────────

JOURNAL_DIR = Path("journal/daily")
GARTH_SESSION = Path.home() / ".garth"

SPARK_CHARS = ["▂", "▄", "▆", "█"]
SPARK_SLOTS = 6

PERIOD_PHASES = {"menstruation", "period", "MENSTRUATION", "PERIOD"}


# ─── AUTH ─────────────────────────────────────────────────────────────────────

def get_client() -> Garmin:
    """
    First run: logs in with GARMIN_EMAIL / GARMIN_PASSWORD env vars, saves session.
    Subsequent runs: resumes from ~/.garth token with no password needed.
    """
    if GARTH_SESSION.exists():
        garth.resume(str(GARTH_SESSION))
    else:
        email = os.environ.get("GARMIN_EMAIL")
        password = os.environ.get("GARMIN_PASSWORD")
        if not email or not password:
            raise ValueError("Set GARMIN_EMAIL and GARMIN_PASSWORD for first login.")
        garth.login(email, password)
        garth.save(str(GARTH_SESSION))

    client = Garmin()
    client.login(tokenstore=str(GARTH_SESSION))
    return client


# ─── FETCH ────────────────────────────────────────────────────────────────────

def fetch_day(client: Garmin, day: date) -> dict:
    """
    Fetch all metrics for a single date.
    Each endpoint is wrapped so one flaky API call does not kill the whole run.
    """
    d = day.isoformat()
    data = {"date": d}

    def safe(key, fn):
        try:
            data[key] = fn()
        except Exception as e:
            print(f"  [warn] {key} · {d}: {e}")
            data[key] = None

    safe("sleep", lambda: client.get_sleep_data(d))
    safe("hrv", lambda: client.get_hrv_data(d))
    safe("heart_rate", lambda: client.get_heart_rates(d))
    safe("body_battery", lambda: client.get_body_battery(d))
    safe("stress", lambda: client.get_stress_data(d))
    safe("steps", lambda: client.get_steps_data(d))
    safe("stats", lambda: client.get_stats(d))
    safe("respiration", lambda: client.get_respiration_data(d))
    safe("spo2", lambda: client.get_spo2_data(d))
    safe("skin_temp", lambda: client.get_skin_temperature(d))
    safe("hydration", lambda: client.get_hydration_data(d))
    safe("weight", lambda: client.get_weigh_ins(d, d))
    safe("menstrual", lambda: client.get_menstrual_data_for_date(d))
    safe("recovery", lambda: client.get_training_readiness(d))
    safe("activities", lambda: client.get_activities_by_date(d, d))

    return data


def fetch_activity_detail(client: Garmin, activity_id: int) -> dict:
    try:
        return client.get_activity(activity_id)
    except Exception as e:
        print(f"  [warn] activity detail {activity_id}: {e}")
        return {}


# ─── SPARKLINE ────────────────────────────────────────────────────────────────

def sparkline(values: list) -> str:
    if not values:
        return ""

    n = len(values)
    buckets = []

    for i in range(SPARK_SLOTS):
        start = int(i * n / SPARK_SLOTS)
        end = int((i + 1) * n / SPARK_SLOTS)
        chunk = [v for v in values[start:end] if v is not None]
        buckets.append(sum(chunk) / len(chunk) if chunk else None)

    valid = [v for v in buckets if v is not None]
    if not valid:
        return ""

    lo, hi = min(valid), max(valid)
    span = hi - lo if hi != lo else 1

    result = []
    for v in buckets:
        if v is None:
            result.append(" ")
        else:
            idx = int((v - lo) / span * 3.0)
            result.append(SPARK_CHARS[max(0, min(3, idx))])

    return "".join(result)


def timeline_values(raw_list: list, value_key: str, time_key: str = "startGMT") -> list:
    if not raw_list or not isinstance(raw_list, list):
        return []

    try:
        pairs = []
        for item in raw_list:
            t = item.get(time_key) or item.get("startTimeGMT") or item.get("calendarDate")
            v = item.get(value_key)
            if t is not None and v is not None:
                pairs.append((t, float(v)))
        pairs.sort(key=lambda x: x[0])
        return [v for _, v in pairs]
    except Exception:
        return []


# ─── HELPERS ──────────────────────────────────────────────────────────────────

def join(*parts) -> str:
    return " · ".join(str(p) for p in parts if p not in (None, "", 0))


def spark_inline(values: list) -> str:
    s = sparkline(values)
    return f"`{s}`" if s.strip() else ""


def hm(seconds: int) -> str:
    h, m = divmod(seconds // 60, 60)
    return f"{h}h {m:02d}m"


def journal_title(day: date) -> str:
    return day.strftime("# Daily Journal — %A, %Y-%m-%d")


# ─── PARSERS ──────────────────────────────────────────────────────────────────

def parse_sleep(raw) -> Optional[str]:
    if not raw:
        return None

    try:
        dto = raw.get("dailySleepDTO", {})
        total_s = dto.get("sleepTimeSeconds", 0)
        if not total_s:
            return None

        score = dto.get("sleepScores", {}).get("overall", {}).get("value")
        light_s = dto.get("lightSleepSeconds", 0) or 0
        deep_s = dto.get("deepSleepSeconds", 0) or 0
        rem_s = dto.get("remSleepSeconds", 0) or 0

        return join(
            hm(total_s),
            f"{score} score" if score else None,
            f"Light {hm(light_s)}" if light_s else None,
            f"Deep {hm(deep_s)}" if deep_s else None,
            f"REM {hm(rem_s)}" if rem_s else None,
        )
    except Exception:
        return None


def parse_hrv(raw) -> Optional[str]:
    if not raw:
        return None

    try:
        summary = raw.get("hrvSummary", {})
        nightly = summary.get("lastNight")
        status = summary.get("status")
        if not nightly:
            return None

        return join(
            f"{nightly} ms",
            status.replace("_", " ").title() if status else None,
        )
    except Exception:
        return None


def parse_heart_rate(raw) -> Optional[str]:
    if not raw:
        return None

    try:
        hr_pairs = raw.get("heartRateValues", []) or []
        values = [float(v[1]) for v in hr_pairs if v and len(v) == 2 and v[1]]
        rhr = raw.get("restingHeartRate")
        avg_hr = raw.get("averageHeartRate") or (int(sum(values) / len(values)) if values else None)
        min_hr = raw.get("minHeartRate") or (int(min(values)) if values else None)
        spark = spark_inline(values)

        return join(
            f"RHR {rhr} bpm" if rhr else None,
            f"avg {avg_hr}" if avg_hr else None,
            f"min {min_hr}" if min_hr else None,
            spark,
        )
    except Exception:
        return None


def parse_body_battery(raw) -> Optional[str]:
    if not raw or not isinstance(raw, list):
        return None

    try:
        values = []
        for item in raw:
            v = item.get("charged") if item.get("charged") is not None else item.get("drained")
            if v is not None:
                values.append(float(v))

        if not values:
            return None

        return join(f"{int(values[0])} → {int(values[-1])}", spark_inline(values))
    except Exception:
        return None


def parse_stress(raw) -> Optional[str]:
    if not raw:
        return None

    try:
        avg = raw.get("avgStressLevel", 0)
        arr = raw.get("stressValuesArray", []) or []

        if arr and isinstance(arr[0], list):
            values = [float(v[1]) for v in arr if v and len(v) == 2 and v[1] >= 0]
        else:
            values = timeline_values(arr, "stressLevel")

        return join(
            f"avg {avg}" if avg and avg > 0 else None,
            spark_inline(values),
        )
    except Exception:
        return None


def parse_steps(raw_steps, raw_stats) -> Optional[str]:
    try:
        total = 0

        if raw_steps and isinstance(raw_steps, list):
            total = sum(r.get("steps", 0) for r in raw_steps if r)
        elif raw_stats:
            total = raw_stats.get("totalSteps", 0) or 0

        return f"{total:,}" if total else None
    except Exception:
        return None


def parse_intensity_calories_floors(raw_stats) -> tuple:
    if not raw_stats:
        return None, None, None

    try:
        mod = raw_stats.get("moderateIntensityMinutes", 0) or 0
        vig = raw_stats.get("vigorousIntensityMinutes", 0) or 0
        mins = mod + vig * 2
        cal = raw_stats.get("activeKilocalories") or raw_stats.get("totalKilocalories")
        floors = raw_stats.get("floorsAscended", 0)

        return (
            f"{mins} intensity mins" if mins else None,
            f"{int(cal):,} kcal" if cal else None,
            str(int(floors)) if floors else None,
        )
    except Exception:
        return None, None, None


def parse_respiration(raw) -> Optional[str]:
    if not raw:
        return None

    try:
        day = raw.get("avgWakingRespirationValue") or raw.get("avgRespirationValue")
        night = raw.get("avgSleepRespirationValue")

        return join(
            f"{day:.1f} rpm day" if day else None,
            f"{night:.1f} rpm night" if night else None,
        )
    except Exception:
        return None


def parse_spo2(raw) -> Optional[str]:
    if not raw:
        return None

    try:
        avg = raw.get("averageSpO2") or raw.get("avgSpo2")
        lo = raw.get("lowestSpO2") or raw.get("minSpo2")

        return join(
            f"avg {avg}%" if avg else None,
            f"min {lo}%" if lo else None,
        )
    except Exception:
        return None


def parse_skin_temp(raw) -> Optional[str]:
    if not raw:
        return None

    try:
        dev = raw.get("skinTempDeviation") or raw.get("avgNightlyDeviation")
        if dev is None:
            return None
        sign = "+" if float(dev) >= 0 else ""
        return f"{sign}{float(dev):.1f}°C"
    except Exception:
        return None


def parse_hydration(raw) -> Optional[str]:
    if not raw:
        return None

    try:
        ml = raw.get("totalIntakeInML") or raw.get("sweatLossInML")
        return f"{int(ml):,} ml" if ml else None
    except Exception:
        return None


def parse_weight(raw) -> Optional[str]:
    if not raw:
        return None

    try:
        entries = raw.get("allWeightMetrics", []) or raw.get("dateWeightList", [])
        if not entries:
            return None

        latest = entries[-1]
        kg = latest.get("weight", 0)

        if kg and kg > 500:
            kg = kg / 1000.0

        bmi = latest.get("bmi")

        return join(
            f"{kg:.1f} kg" if kg else None,
            f"BMI {bmi:.1f}" if bmi else None,
        )
    except Exception:
        return None


def parse_menstrual(raw) -> Optional[str]:
    if not raw:
        return None

    try:
        phase = (raw.get("phase") or raw.get("cyclePhase") or "").strip()
        day_num = raw.get("dayOfCycle") or raw.get("cycleDay")

        if phase not in PERIOD_PHASES:
            return None

        return f"Day {day_num} of period" if day_num else "Period"
    except Exception:
        return None


def parse_recovery(raw) -> Optional[str]:
    if not raw:
        return None

    try:
        if isinstance(raw, list):
            raw = raw[0] if raw else {}

        hours = raw.get("recoveryTime") or raw.get("timeToRecoveryInHours")
        return f"{int(hours)}h remaining" if hours else None
    except Exception:
        return None


def parse_activities(raw_activities: list, detail_map: dict) -> list[str]:
    if not raw_activities:
        return []

    lines = []

    for act in raw_activities:
        try:
            time = (act.get("startTimeLocal") or "")[:16].split("T")[-1]
            name = (
                act.get("activityName")
                or act.get("activityType", {}).get("typeKey", "Activity")
            ).title()

            dist_m = act.get("distance", 0) or 0
            dist = f"{dist_m / 1000:.1f} km" if dist_m else None

            dur_s = int(act.get("duration", 0) or 0)
            h, rem = divmod(dur_s, 3600)
            m, s = divmod(rem, 60)
            dur = f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"

            avg_hr = act.get("averageHR")
            max_hr = act.get("maxHR")

            line1 = f"- {time} · {name} · " + join(
                dist,
                dur,
                f"Avg HR {int(avg_hr)}" if avg_hr else None,
                f"Max HR {int(max_hr)}" if max_hr else None,
            )

            detail = detail_map.get(act.get("activityId"), {})
            detail_parts = []

            rec_hr = detail.get("recoveryHeartRate") or detail.get("heartRateRecovery1Min")
            if rec_hr:
                detail_parts.append(f"Recovery −{int(rec_hr)} bpm/min")

            aerobic = detail.get("aerobicTrainingEffect")
            anaerobic = detail.get("anaerobicTrainingEffect")
            if aerobic:
                detail_parts.append(f"Aerobic {aerobic:.1f}")
            if anaerobic:
                detail_parts.append(f"Anaerobic {anaerobic:.1f}")

            vo2 = detail.get("vO2MaxValue") or detail.get("vo2MaxPreciseValue")
            if vo2:
                detail_parts.append(f"VO2 max {vo2:.0f}")

            cadence = (
                detail.get("averageRunningCadenceInStepsPerMinute")
                or detail.get("averageBikingCadenceInRevPerMinute")
                or detail.get("averageCadence")
            )
            if cadence:
                unit = "spm" if "run" in name.lower() else "rpm"
                detail_parts.append(f"Cadence {int(cadence)} {unit}")

            lines.append(line1)
            if detail_parts:
                lines.append("  " + " · ".join(detail_parts))

        except Exception as e:
            print(f"  [warn] activity parse: {e}")

    return lines


# ─── BLOCK BUILDER ────────────────────────────────────────────────────────────

def build_health_block(data: dict, client: Garmin) -> str:
    raw_acts = data.get("activities") or []

    detail_map = {
        act["activityId"]: fetch_activity_detail(client, act["activityId"])
        for act in raw_acts if act.get("activityId")
    }

    intensity, calories, floors = parse_intensity_calories_floors(data.get("stats"))

    metrics = [
        ("Sleep", parse_sleep(data.get("sleep"))),
        ("HRV", parse_hrv(data.get("hrv"))),
        ("Heart Rate", parse_heart_rate(data.get("heart_rate"))),
        ("Body Battery", parse_body_battery(data.get("body_battery"))),
        ("Stress", parse_stress(data.get("stress"))),
        ("Steps", join(parse_steps(data.get("steps"), data.get("stats")), intensity)),
        ("Active Cal", calories),
        ("Floors", floors),
        ("Respiration", parse_respiration(data.get("respiration"))),
        ("SpO2", parse_spo2(data.get("spo2"))),
        ("Skin Temp", parse_skin_temp(data.get("skin_temp"))),
        ("Hydration", parse_hydration(data.get("hydration"))),
        ("Weight", parse_weight(data.get("weight"))),
        ("Period", parse_menstrual(data.get("menstrual"))),
        ("Recovery", parse_recovery(data.get("recovery"))),
    ]

    metric_lines = [f"- **{label}** {value}" for label, value in metrics if value]
    activity_lines = parse_activities(raw_acts, detail_map)

    sections = ["## Health ·"]

    if metric_lines:
        sections.append("\n".join(metric_lines))

    if activity_lines:
        sections.append("**Activities**\n" + "\n".join(activity_lines))

    return "\n\n".join(sections)


# ─── FILE WRITE ───────────────────────────────────────────────────────────────

FILE_TEMPLATE = """{title}

{health_block}

## Journal

"""


def write_daily_file(day: date, health_block: str):
    path = JOURNAL_DIR / f"{day.isoformat()}.md"

    if path.exists():
        print(f"  exists, skipping: {path}")
        return

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        FILE_TEMPLATE.format(
            title=journal_title(day),
            health_block=health_block,
        ),
        encoding="utf-8",
    )
    print(f"  created: {path}")


# ─── GIT ──────────────────────────────────────────────────────────────────────

def git_commit(day: date):
    path = str(JOURNAL_DIR / f"{day.isoformat()}.md")
    subprocess.run(["git", "add", path], check=True)

    unchanged = subprocess.run(
        ["git", "diff", "--staged", "--quiet"],
        capture_output=True,
    ).returncode == 0

    if unchanged:
        print("No changes. Skipping commit.")
        return

    subprocess.run(["git", "commit", "-m", f"garmin sync {day.isoformat()}"], check=True)
    subprocess.run(["git", "push"], check=True)
    print(f"Committed: {day.isoformat()}")


# ─── MAIN ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    today = date.today()
    client = get_client()

    print(f"Syncing {today}...")
    data = fetch_day(client, today)
    block = build_health_block(data, client)
    write_daily_file(today, block)
    git_commit(today)
