import os
import sys
import shutil

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
NSIS_DIR = os.path.join(BASE, "windows", "nsniuniuskin")
TARGET_NSIS = os.path.join(BASE, "target", "release", "nsis", "x64")
TEMPLATE_SRC = os.path.join(NSIS_DIR, "installer.nsi")

def main():
    os.makedirs(TARGET_NSIS, exist_ok=True)

    # Copy skin.zip
    skin_zip_src = os.path.join(NSIS_DIR, "skin.zip")
    skin_zip_dst = os.path.join(TARGET_NSIS, "skin.zip")
    if os.path.exists(skin_zip_src):
        shutil.copy2(skin_zip_src, skin_zip_dst)
        print(f"Copied skin.zip -> {skin_zip_dst}")

    # Copy license.txt
    lic_src = os.path.join(NSIS_DIR, "..", "LICENSE.txt")
    lic_dst = os.path.join(TARGET_NSIS, "license.txt")
    if os.path.exists(lic_src):
        shutil.copy2(lic_src, lic_dst)
        print(f"Copied license.txt -> {lic_dst}")

    print("NSIS preparation complete.")

if __name__ == "__main__":
    main()
