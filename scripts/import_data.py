import csv
import glob
import os
import re
import sys
from typing import Dict, List, Optional

try:
    import pymongo
except ImportError:
    print("Missing dependency: pymongo")
    print("Install it with: python3 -m pip install pymongo")
    sys.exit(1)


DEFAULT_LAB_NO = os.getenv("DEFAULT_LAB_NO", "1000")


def _normalize_header(header: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(header).lower())


def _pick_input_path() -> str:
    if len(sys.argv) > 1:
        return sys.argv[1]

    if os.path.exists("participants.csv"):
        return "participants.csv"

    csv_candidates = sorted(glob.glob("*.csv"))
    if len(csv_candidates) == 1:
        return csv_candidates[0]
    if len(csv_candidates) > 1:
        print("Multiple CSV files found. Pass the file path explicitly:")
        print("python3 scripts/import_data.py <your_file.csv>")
        sys.exit(1)

    xlsx_candidates = sorted(glob.glob("*.xlsx"))
    if len(xlsx_candidates) == 1:
        return xlsx_candidates[0]

    print("No CSV/XLSX file found. Run:")
    print("python3 scripts/import_data.py <your_file.csv>")
    sys.exit(1)


def _normalize_mobile(raw_mobile: str) -> str:
    mobile = str(raw_mobile).strip()
    if mobile.endswith(".0"):
        mobile = mobile[:-2]
    return re.sub(r"\s+", "", mobile)


def _connect():
    mongo_uri = os.getenv("MONGO_URI", "mongodb://127.0.0.1:27017/")
    client = pymongo.MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
    try:
        client.admin.command("ping")
    except Exception:
        print(f"MongoDB is not reachable at {mongo_uri}")
        print("Start MongoDB first, then run this script again.")
        sys.exit(1)
    return client


def _is_mobile_header(normalized_header: str) -> bool:
    return (
        "mobile" in normalized_header
        or normalized_header in {"phone", "phonenumber", "contactnumber"}
        or normalized_header.endswith("whatsappnumber")
    )


def _is_name_header(normalized_header: str) -> bool:
    if normalized_header in {"teamname", "college", "course"}:
        return False
    return "name" in normalized_header


def _extract_records_from_matrix(headers: List[str], rows: List[List[str]]) -> List[Dict[str, str]]:
    normalized_headers = [_normalize_header(header) for header in headers]

    team_index = next(
        (index for index, header in enumerate(normalized_headers) if header in {"teamname", "team"}),
        None,
    )
    lab_index = next(
        (index for index, header in enumerate(normalized_headers) if header in {"labno", "labnumber", "lab"}),
        None,
    )

    mobile_indices = [index for index, header in enumerate(normalized_headers) if _is_mobile_header(header)]
    name_indices = [index for index, header in enumerate(normalized_headers) if _is_name_header(header)]

    if not mobile_indices:
        print("No mobile-like columns found. Check your CSV headers.")
        sys.exit(1)

    mobile_to_name: Dict[int, Optional[int]] = {}
    for mobile_idx in mobile_indices:
        closest_name_idx = None
        for name_idx in name_indices:
            if name_idx < mobile_idx:
                closest_name_idx = name_idx
            else:
                break
        mobile_to_name[mobile_idx] = closest_name_idx

    records: List[Dict[str, str]] = []
    for raw_row in rows:
        row = raw_row + [""] * max(0, len(headers) - len(raw_row))
        team_name = row[team_index].strip() if team_index is not None else ""
        lab_no = row[lab_index].strip() if lab_index is not None else ""

        for mobile_idx in mobile_indices:
            mobile = _normalize_mobile(row[mobile_idx])
            if not mobile:
                continue

            name_idx = mobile_to_name.get(mobile_idx)
            name = row[name_idx].strip() if name_idx is not None else ""

            records.append(
                {
                    "mobile": mobile,
                    "name": name,
                    "team_name": team_name,
                    "lab_no": lab_no or DEFAULT_LAB_NO,
                }
            )

    return records


def _load_records(input_path: str) -> List[Dict[str, str]]:
    lower = input_path.lower()

    if lower.endswith(".xlsx") or lower.endswith(".xls"):
        try:
            import pandas as pd
        except ImportError:
            print("Missing dependency: pandas")
            print("Install it with: python3 -m pip install pandas openpyxl")
            sys.exit(1)

        try:
            df = pd.read_excel(input_path, dtype=str).fillna("")
            headers = [str(col) for col in df.columns.tolist()]
            rows = df.values.tolist()
            return _extract_records_from_matrix(headers, rows)
        except Exception as exc:
            print(f"Failed to read Excel file {input_path}: {exc}")
            sys.exit(1)

    try:
        with open(input_path, mode="r", encoding="utf-8-sig", newline="") as f:
            reader = csv.reader(f)
            all_rows = list(reader)
    except Exception as exc:
        print(f"Failed to read CSV file {input_path}: {exc}")
        sys.exit(1)

    if not all_rows:
        print(f"{input_path} is empty.")
        sys.exit(1)

    headers = all_rows[0]
    rows = all_rows[1:]
    return _extract_records_from_matrix(headers, rows)


def import_records(records: List[Dict[str, str]], collection):
    count = 0
    inserted = 0
    updated = 0

    for record in records:
        mobile = _normalize_mobile(record.get("mobile", ""))
        if not mobile:
            continue

        name = record.get("name", "").strip()
        team_name = record.get("team_name", "").strip()
        lab_no = record.get("lab_no", "").strip() or DEFAULT_LAB_NO

        try:
            result = collection.update_one(
                {"mobile": mobile},
                {
                    "$set": {
                        "name": name,
                        "team_name": team_name,
                        "lab_no": lab_no,
                    },
                    "$setOnInsert": {
                        "mobile": mobile,
                        "registered": False,
                        "is_present": False,
                        "has_redbull": False,
                        "has_dinner": False,
                        "is_fake": False,
                    },
                },
                upsert=True,
            )
            if result.upserted_id:
                inserted += 1
            elif result.modified_count > 0:
                updated += 1
        except Exception as exc:
            print(f"Error upserting {mobile}: {exc}")

        count += 1

    print(f"Processed {count} participant records. Inserted {inserted}, updated {updated}.")


if __name__ == "__main__":
    input_path = _pick_input_path()
    client = _connect()
    db = client["hackathon"]
    collection = db["participants"]
    collection.create_index("mobile", unique=True)

    parsed_records = _load_records(input_path)
    import_records(parsed_records, collection)
