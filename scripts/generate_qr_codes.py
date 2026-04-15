import argparse
import csv
import glob
import os
import re
import sys
from typing import Dict, List, Optional

try:
    import qrcode
except ImportError:
    print("Missing dependency: qrcode")
    print("Install it with: python3 -m pip install 'qrcode[pil]'")
    sys.exit(1)


def _normalize_header(header: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(header).lower())


def _normalize_mobile(raw_mobile: str) -> str:
    mobile = str(raw_mobile).strip()
    if mobile.endswith(".0"):
        mobile = mobile[:-2]
    return re.sub(r"\s+", "", mobile)


def _slugify_team(raw_team: str) -> str:
    team = str(raw_team or "").strip().lower()
    if not team:
        return "unassigned_team"
    cleaned = re.sub(r"[^a-z0-9]+", "_", team)
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")
    return cleaned or "unassigned_team"


def _pick_input_path(user_path: Optional[str]) -> str:
    if user_path:
        return user_path
    if os.path.exists("participants.csv"):
        return "participants.csv"

    xlsx_candidates = sorted(glob.glob("*.xlsx"))
    if len(xlsx_candidates) == 1:
        return xlsx_candidates[0]

    csv_candidates = sorted(glob.glob("*.csv"))
    if len(csv_candidates) == 1:
        return csv_candidates[0]

    print("Input file not found.")
    print("Use: python3 scripts/generate_qr_codes.py --input <participants.csv|participants.xlsx>")
    sys.exit(1)


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

    # Map each mobile column to the nearest name column on its left.
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
                    "lab_no": lab_no,
                }
            )

    return records


def _load_participant_records(input_path: str) -> List[Dict[str, str]]:
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
        with open(input_path, "r", encoding="utf-8-sig", newline="") as f:
            reader = csv.reader(f)
            all_rows = list(reader)
    except FileNotFoundError:
        print(f"Input file not found: {input_path}")
        sys.exit(1)
    except Exception as exc:
        print(f"Failed to read CSV file {input_path}: {exc}")
        sys.exit(1)

    if not all_rows:
        return []

    headers = all_rows[0]
    rows = all_rows[1:]
    return _extract_records_from_matrix(headers, rows)


def _generate_qr_image(data: str, output_path: str, box_size: int, border: int) -> None:
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=box_size,
        border=border,
    )
    qr.add_data(data)
    qr.make(fit=True)
    image = qr.make_image(fill_color="black", back_color="white")
    image.save(output_path)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate one QR PNG per participant. QR payload is mobile number."
    )
    parser.add_argument("--input", help="Input CSV/XLSX file path.")
    parser.add_argument("--output-dir", default="qr_codes", help="Output directory for PNG files.")
    parser.add_argument("--manifest", default="qr_manifest.csv", help="Manifest CSV name inside output dir.")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing PNG files.")
    parser.add_argument("--box-size", type=int, default=10, help="QR pixel box size.")
    parser.add_argument("--border", type=int, default=4, help="QR border size.")
    args = parser.parse_args()

    input_path = _pick_input_path(args.input)
    records = _load_participant_records(input_path)

    if not records:
        print(f"No participant rows found in {input_path}.")
        return

    os.makedirs(args.output_dir, exist_ok=True)
    manifest_path = os.path.join(args.output_dir, args.manifest)

    generated = 0
    skipped_existing = 0
    skipped_duplicates = 0
    seen_mobiles = set()

    with open(manifest_path, "w", encoding="utf-8", newline="") as manifest_file:
        writer = csv.DictWriter(
            manifest_file,
            fieldnames=["mobile", "name", "team_name", "team_dir", "qr_file", "qr_relative_path", "lab_no"],
        )
        writer.writeheader()

        for record in records:
            mobile = record["mobile"]
            if mobile in seen_mobiles:
                skipped_duplicates += 1
                continue
            seen_mobiles.add(mobile)

            team_name = record.get("team_name", "")
            team_dir_name = _slugify_team(team_name)
            team_dir_path = os.path.join(args.output_dir, team_dir_name)
            os.makedirs(team_dir_path, exist_ok=True)

            qr_filename = f"{mobile}.png"
            qr_path = os.path.join(team_dir_path, qr_filename)
            qr_relative_path = os.path.join(team_dir_name, qr_filename)

            if os.path.exists(qr_path) and not args.overwrite:
                skipped_existing += 1
            else:
                _generate_qr_image(mobile, qr_path, args.box_size, args.border)
                generated += 1

            writer.writerow(
                {
                    "mobile": mobile,
                    "name": record.get("name", "").strip(),
                    "team_name": team_name,
                    "team_dir": team_dir_name,
                    "qr_file": qr_filename,
                    "qr_relative_path": qr_relative_path,
                    "lab_no": record.get("lab_no", "").strip(),
                }
            )

    print(f"Input: {input_path}")
    print(f"Output directory: {args.output_dir}")
    print(f"Manifest: {manifest_path}")
    print(f"Generated: {generated}")
    print(f"Skipped (duplicate mobiles in input): {skipped_duplicates}")
    print(f"Skipped (existing files): {skipped_existing}")
    print(f"Unique participant mobiles processed: {len(seen_mobiles)}")


if __name__ == "__main__":
    main()
