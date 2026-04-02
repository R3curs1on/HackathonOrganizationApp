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


def _resolve_header(fieldnames: List[str], aliases: List[str]) -> Optional[str]:
    normalized = {_normalize_header(name): name for name in fieldnames if name}
    for alias in aliases:
        match = normalized.get(_normalize_header(alias))
        if match:
            return match
    return None


def _normalize_mobile(raw_mobile: str) -> str:
    mobile = str(raw_mobile).strip()
    if mobile.endswith(".0"):
        mobile = mobile[:-2]
    return re.sub(r"\s+", "", mobile)


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
    print("Use: python3 generate_qr_codes.py --input <participants.csv|participants.xlsx>")
    sys.exit(1)


def _load_rows(input_path: str) -> List[Dict[str, str]]:
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
            return df.to_dict(orient="records")
        except Exception as exc:
            print(f"Failed to read Excel file {input_path}: {exc}")
            sys.exit(1)

    try:
        with open(input_path, "r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            return list(reader)
    except FileNotFoundError:
        print(f"Input file not found: {input_path}")
        sys.exit(1)
    except Exception as exc:
        print(f"Failed to read CSV file {input_path}: {exc}")
        sys.exit(1)


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
    rows = _load_rows(input_path)

    if not rows:
        print(f"No rows found in {input_path}.")
        return

    fieldnames = list(rows[0].keys())
    mobile_key = _resolve_header(fieldnames, ["Candidate's Mobile", "Mobile", "Phone", "Phone Number"])
    name_key = _resolve_header(fieldnames, ["Candidate's Name", "Name"])
    team_key = _resolve_header(fieldnames, ["Team Name", "Team"])

    if not mobile_key:
        print("Missing mobile column. Expected one of: Candidate's Mobile, Mobile, Phone Number")
        sys.exit(1)

    os.makedirs(args.output_dir, exist_ok=True)
    manifest_path = os.path.join(args.output_dir, args.manifest)

    generated = 0
    skipped_missing_mobile = 0
    skipped_existing = 0
    skipped_duplicates = 0
    seen_mobiles = set()

    with open(manifest_path, "w", encoding="utf-8", newline="") as manifest_file:
        writer = csv.DictWriter(
            manifest_file,
            fieldnames=["mobile", "name", "team_name", "qr_file"],
        )
        writer.writeheader()

        for row in rows:
            mobile = _normalize_mobile(row.get(mobile_key, ""))
            if not mobile:
                skipped_missing_mobile += 1
                continue

            if mobile in seen_mobiles:
                skipped_duplicates += 1
                continue
            seen_mobiles.add(mobile)

            qr_filename = f"{mobile}.png"
            qr_path = os.path.join(args.output_dir, qr_filename)

            if os.path.exists(qr_path) and not args.overwrite:
                skipped_existing += 1
            else:
                _generate_qr_image(mobile, qr_path, args.box_size, args.border)
                generated += 1

            writer.writerow(
                {
                    "mobile": mobile,
                    "name": row.get(name_key, "").strip() if name_key else "",
                    "team_name": row.get(team_key, "").strip() if team_key else "",
                    "qr_file": qr_filename,
                }
            )

    print(f"Input: {input_path}")
    print(f"Output directory: {args.output_dir}")
    print(f"Manifest: {manifest_path}")
    print(f"Generated: {generated}")
    print(f"Skipped (missing mobile): {skipped_missing_mobile}")
    print(f"Skipped (duplicate mobiles in input): {skipped_duplicates}")
    print(f"Skipped (existing files): {skipped_existing}")


if __name__ == "__main__":
    main()
