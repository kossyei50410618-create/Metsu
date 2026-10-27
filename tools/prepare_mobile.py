"""Build a public sensor demo without copying local API keys or repository files."""
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "dist-mobile"
FILES = (
    "index.html", "battle.html", "result.html", "style.css",
    "audio.js", "mic.js", "category.js", "monster.js", "motion.js",
    "battle.js", "script.js", "ui.js", "result.js",
)


def build():
    sources = [ROOT / name for name in FILES]
    sources += sorted(p for p in (ROOT / "assets").rglob("*")
                      if p.is_file() and p.suffix.lower() in (".png", ".svg"))
    allowed = {p.relative_to(ROOT) for p in sources} | {Path("api.js")}
    # Refuse to publish an unrelated file left in an existing output folder.
    if OUTPUT.is_symlink():
        raise RuntimeError("dist-mobile must not be a symbolic link")
    for existing in OUTPUT.rglob("*"):
        if existing.is_symlink() or (existing.is_file() and existing.relative_to(OUTPUT) not in allowed):
            raise RuntimeError(f"Unexpected output file; move it elsewhere before building: {existing}")
    for source in sources:
        if not source.resolve().is_relative_to(ROOT):
            raise RuntimeError(f"Asset outside the project: {source}")
        target = OUTPUT / source.relative_to(ROOT)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    (OUTPUT / "api.js").write_text(
        '// Public demo: no private API keys. Text classification remains available.\n'
        'export const SECRETS = { SPEECH_API_KEY: "", AUDIO_API_KEY: "" };\n',
        encoding="utf-8",
    )
    print(f"Mobile demo ready: {OUTPUT}")
    print("Serve it: python -m http.server 5501 --bind 127.0.0.1 --directory dist-mobile")
    print("HTTPS URL: cloudflared tunnel --url http://127.0.0.1:5501")


if __name__ == "__main__":
    build()
