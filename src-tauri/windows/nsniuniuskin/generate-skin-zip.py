import os
import zipfile

SKIN_DIR = os.path.join(os.path.dirname(__file__), "skin")
OUTPUT = os.path.join(os.path.dirname(__file__), "skin.zip")

def main():
    with zipfile.ZipFile(OUTPUT, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(SKIN_DIR):
            for file in files:
                full_path = os.path.join(root, file)
                arcname = os.path.relpath(full_path, SKIN_DIR)
                zf.write(full_path, arcname)
    print(f"Created {OUTPUT}")

if __name__ == "__main__":
    main()
