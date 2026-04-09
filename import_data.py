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


def _normalize_header(header: str) -> str:
    return re.sub(r"[^a-z0-9]", "", header.lower())


def _resolve_header(fieldnames: List[str], aliases: List[str]) -> Optional[str]:
    normalized = {_normalize_header(name): name for name in fieldnames if name}
    for alias in aliases:
        match = normalized.get(_normalize_header(alias))
        if match:
            return match
    return None


def _pick_csv_path() -> str:
    if len(sys.argv) > 1:
        return sys.argv[1]
    if glob.glob("participants.csv"):
        return "participants.csv"

    candidates = sorted(glob.glob("*.csv"))
    if len(candidates) == 1:
        return candidates[0]

    if len(candidates) > 1:
        print("Multiple CSV files found. Pass the file path explicitly:")
        print("python3 import_data.py <your_file.csv>")
        sys.exit(1)

    print("No CSV file found. Add participants.csv or run:")
    print("python3 import_data.py <your_file.csv>")
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


def import_csv(csv_path: str, collection):

    with open(csv_path, mode="r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            print(f"{csv_path} has no header row.")
            sys.exit(1)

        header_map: Dict[str, Optional[str]] = {
            "mobile": _resolve_header(reader.fieldnames, ["Candidate's Mobile", "Mobile", "Phone", "Phone Number"]),
            "name": _resolve_header(reader.fieldnames, ["Candidate's Name", "Name"]),
            "team_name": _resolve_header(reader.fieldnames, ["Team Name", "Team"]),
            "lab_no": _resolve_header(reader.fieldnames, ["Lab No", "Lab Number", "Lab"]),
        }

        if not header_map["mobile"]:
            print("Missing required mobile column. Expected one of: Candidate's Mobile, Mobile, Phone Number")
            sys.exit(1)

        if not header_map["name"]:
            print("Missing required name column. Expected one of: Candidate's Name, Name")
            sys.exit(1)

        if not header_map["team_name"]:
            print("Missing required team column. Expected one of: Team Name, Team")
            sys.exit(1)

        if not header_map["lab_no"]:
            print("Lab No column not found; importing with empty lab_no values.")

        count = 0
        inserted = 0
        for row in reader:
            mobile_raw = row.get(header_map["mobile"], "")
            if not mobile_raw:
                continue

            mobile = _normalize_mobile(mobile_raw)
            if not mobile:
                continue

            name = row.get(header_map["name"], "").strip()
            team_name = row.get(header_map["team_name"], "").strip()
            lab_no = row.get(header_map["lab_no"], "").strip() if header_map["lab_no"] else ""

            try:
                collection.insert_one(
                    {
                        "name": name,
                        "mobile": mobile,
                        "team_name": team_name,
                        "lab_no": lab_no,
                        "registered": False,
                        "is_present": False,
                        "has_redbull": False,
                        "has_dinner": False,
                    }
                )
                inserted += 1
            except pymongo.errors.DuplicateKeyError:
                pass
            except Exception as e:
                print(f"Error inserting {mobile}: {e}")

            count += 1

        print(f"Processed {count} rows from {csv_path}. Inserted {inserted} new records.")

def convert_xls_to_csv(xls_path: str, csv_path: str):
    try:
        import pandas as pd
    except ImportError:
        print("Missing dependency: pandas")
        print("Install it with: python3 -m pip install pandas")
        sys.exit(1)

    try:
        df = pd.read_excel(xls_path)
        df.to_csv(csv_path, index=False)
        print(f"Converted {xls_path} to {csv_path}") 
    except Exception as e:
        print(f"Error converting {xls_path} to CSV: {e}")
        sys.exit(1)


if __name__ == "__main__":
    convert_xls_to_csv("Regn_1660436_BasicInfo_20260331_1704_Filters.xlsx", "participants.csv")
    csv_path = _pick_csv_path()
    client = _connect()
    db = client["hackathon"]
    collection = db["participants"]
    collection.create_index("mobile", unique=True)
    import_csv(csv_path, collection)
