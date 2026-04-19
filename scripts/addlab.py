import pandas as pd

# 1. Define the mapping based on your data
# Team Name: Room/Lab Number
lab_mapping = {
    "Rasmalai": "1323-A", "Alert mate": "1323-A", "Mind matrix": "1323-A", "Commit || Cry": "1323-A", 
    "Code comrades": "1323-A", "Xtra fusion": "1323-D", "Clash of code": "1323-D", "Code cometa": "1323-D", 
    "Le'squad": "1323-D", "Team maris": "1323-D", "Crusade": "1321-A", "Globians": "1321-A", 
    "Status 200": "1321-A", "Triple A": "1321-A", "Enigma crackers": "1321-D", "Data seekers": "1321-D", 
    "Gods Plan": "1321-D", "God's Plan": "1321-D", "Brainbyte": "1321-D", "Delta devs": "1321-D",
    "Team inspire": "1316-A", "Helix": "1316-A", "113 titans": "1316-A", "B4U": "1316-A", 
    "The invisibles": "1316-A", "Code trinity": "1316-D", "Shantabai mandali": "1316-D", 
    "CookedDevelopers": "1316-D", "Igniters": "1316-D", "Kremlin spies": "1316-D",
    "The last semicolon": "1308", "Synapse squade": "1308", "Null pointers": "1308", 
    "RS2T": "1308", "Consensus lab": "1308", "Drvn studiov": "1308",
    "Team divas": "1309", "GenzPT": "1309", "Shunyacode": "1309", "Team refactor": "1309", 
    "Swarajya": "1309", "Wrath of God": "1309", "Error 404": "1307", 
    "Segmentation_faults": "1307", "Spectra": "1307", "Zero to one": "1307", 
    "Goblet of fire": "1307", "Agnisphere": "1307", "Brain bridge": "1307", 
    "Team BKC": "1307", "Team trata": "1307"
}

# Standardize keys for robust matching (lowercase and stripped of spaces)
mapping_clean = {str(k).strip().lower(): v for k, v in lab_mapping.items()}

def update_lab_csv(input_csv, output_csv):
    # Load the CSV
    df = pd.read_csv(input_csv)

    # Function to lookup the lab number
    def get_lab_no(team_name):
        if pd.isna(team_name):
            return "N/A"
        # Standardize search key: lowercase and remove internal spaces for "XtraFusion" vs "Xtra Fusion"
        key = str(team_name).strip().lower().replace(" ", "")
        
        # Also clean the mapping keys for the search
        for original_key, lab in mapping_clean.items():
            if key == original_key.replace(" ", ""):
                return lab
        return "Not Assigned"

    # Apply the mapping to create the 'labno' column
    df['labno'] = df['Team Name'].apply(get_lab_no)

    # Save the updated file
    df.to_csv(output_csv, index=False)
    print(f"Successfully created {output_csv}")

# Run the script
update_lab_csv( 'Breaking Enigma 4.0 – Payment Confirmation Form  (Responses) - Form Responses 1.csv', 'Updated_Teams_With_LabNo.csv')