"""Generate the editable vector source for the C-card prototype only."""

from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "make_editable_vector_paths.py"


def load_source():
    spec = importlib.util.spec_from_file_location("vector_source", SOURCE)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load {SOURCE}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    source = load_source()
    source.OUT = ROOT / "rarity-masters-v0-8" / "C" / "editable-vector-paths"
    source.THEMES = {
        "C": {
            "line": "#6c8f68",
            "gold": "#bccd97",
            "light": "#f9fdef",
            "panel": "#eff8e3",
            "ink": "#3d5241",
        }
    }
    source.main()


if __name__ == "__main__":
    main()
