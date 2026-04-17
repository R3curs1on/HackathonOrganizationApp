import os
import sys
from typing import Dict, List

# try:
#     import pymongo
# except ImportError:
#     print("Missing dependency: pymongo")
#     print("Install it with: python3 -m pip install pymongo")
#     sys.exit(1)


# DEFAULT_LAB_NO = os.getenv("DEFAULT_LAB_NO", "1000")
try:
    import pymongo
except ImportError:
    print("Missing dependency: pymongo")
    print("Install it with: python3 -m pip install pymongo")
    sys.exit(1)

try:
    import qrcode
except ImportError:
    print("Missing dependency: qrcode")
    print("Install it with: python3 -m pip install qrcode[pil]")
    sys.exit(1)


DEFAULT_LAB_NO = os.getenv("DEFAULT_LAB_NO", "1000")


MONGO_URI = os.getenv("MONGO_URI")
if not MONGO_URI:
    backend_env_path = os.path.join(os.path.dirname(__file__), "..", "backend", ".env")
    backend_env_path = os.path.abspath(backend_env_path)
    if os.path.exists(backend_env_path):
        try:
            with open(backend_env_path, "r", encoding="utf-8") as f:
                for line in f:
                    raw = line.strip()
                    if not raw or raw.startswith("#") or "=" not in raw:
                        continue
                    key, value = raw.split("=", 1)
                    if key.strip() == "MONGO_URI":
                        MONGO_URI = value.strip().strip('"').strip("'")
                        break
        except Exception:
            pass

MONGO_URI = MONGO_URI or "mongodb://127.0.0.1:27017/"

# Fake test participants for local/dev validation only.
# Keep these clearly tagged so they are easy to filter/remove.
FAKE_PARTICIPANTS: List[Dict[str, str]] = [
    {"name": "[FAKE] Test Member 01", "mobile": "0000000001", "team_name": "[FAKE] Test Team Alpha"},
    {"name": "[FAKE] Test Member 02", "mobile": "0000000002", "team_name": "[FAKE] Test Team Alpha"},
    {"name": "[FAKE] Test Member 03", "mobile": "0000000003", "team_name": "[FAKE] Test Team Beta"},
    {"name": "[FAKE] Test Member 04", "mobile": "0000000004", "team_name": "[FAKE] Test Team Beta"},
    {"name": "[FAKE] Test Member 05", "mobile": "0000000005", "team_name": "[FAKE] Test Team Gamma"},
    {"name": "[FAKE] Test Member 06", "mobile": "0000000006", "team_name": "[FAKE] Test Team Gamma"},
    {"name": "[FAKE] Test Member 07", "mobile": "0000000007", "team_name": "[FAKE] Test Team Delta"},
    {"name": "[FAKE] Test Member 08", "mobile": "0000000008", "team_name": "[FAKE] Test Team Delta"},
    {"name": "[FAKE] Test Member 09", "mobile": "0000000009", "team_name": "[FAKE] Test Team Omega"},
    {"name": "[FAKE] Test Member 10", "mobile": "0000000010", "team_name": "[FAKE] Test Team Omega"},
]


# def main() -> None:
#     client = pymongo.MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
#     try:
#         client.admin.command("ping")
#     except Exception:
#         print(f"MongoDB is not reachable at {MONGO_URI}")
#         print("Start MongoDB first, then run this script again.")
#         sys.exit(1)

#     participants = client["test"]["participants"]
#     participants.create_index("mobile", unique=True)

#     inserted = 0
#     updated = 0

#     for fake in FAKE_PARTICIPANTS:
#         result = participants.update_one(
#             {"mobile": fake["mobile"]},
#             {
#                 "$set": {
#                     "name": fake["name"],
#                     "team_name": fake["team_name"],
#                     "lab_no": DEFAULT_LAB_NO,
#                     "is_fake": True,
#                 },
#                 "$setOnInsert": {
#                     "mobile": fake["mobile"],
#                     "registered": False,
#                     "is_present": False,
#                     "has_redbull": False,
#                     "has_dinner": False,
#                 },
#             },
#             upsert=True,
#         )

#         if result.upserted_id:
#             inserted += 1
#         elif result.modified_count > 0:
#             updated += 1

#     print(f"Seeded fake participants. Inserted: {inserted}, Updated: {updated}, Total configured: {len(FAKE_PARTICIPANTS)}")


# if __name__ == "__main__":
#     main()
def main() -> None:
    client = pymongo.MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    try:
        client.admin.command("ping")
    except Exception:
        print(f"MongoDB is not reachable at {MONGO_URI}")
        print("Start MongoDB first, then run this script again.")
        sys.exit(1)

    participants = client["test"]["participants"]
    participants.create_index("mobile", unique=True)

    inserted = 0
    updated = 0
    
    # Create folder for fake QR codes
    qr_dir = os.path.join(os.path.dirname(__file__), "..", "qr_codes", "fake_participants")
    os.makedirs(qr_dir, exist_ok=True)

    for fake in FAKE_PARTICIPANTS:
        # 1. Update/Insert in MongoDB
        result = participants.update_one(
            {"mobile": fake["mobile"]},
            {
                "$set": {
                    "name": fake["name"],
                    "team_name": fake["team_name"],
                    "lab_no": DEFAULT_LAB_NO,
                    "is_fake": True,
                },
                "$setOnInsert": {
                    "mobile": fake["mobile"],
                    "registered": False,
                    "is_present": False,
                    "has_redbull": False,
                    "has_dinner": False,
                },
            },
            upsert=True,
        )

        if result.upserted_id:
            inserted += 1
        elif result.modified_count > 0:
            updated += 1
            
        # 2. Generate QR Code image (using the mobile number as the QR content)
        qr = qrcode.QRCode(version=1, box_size=10, border=4)
        qr.add_data(fake["mobile"])
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        
        safe_name = fake["name"].replace(" ", "_").replace("[", "").replace("]", "")
        file_path = os.path.join(qr_dir, f"{safe_name}_{fake['mobile']}.png")
        img.save(file_path)

    print(f"Seeded fake participants. Inserted: {inserted}, Updated: {updated}, Total configured: {len(FAKE_PARTICIPANTS)}")
    print(f"Fake QR codes saved to: {os.path.abspath(qr_dir)}")


if __name__ == "__main__":
    main()