"""Registry of experiment-public models (the demo's registry.json)."""
import json
import os

REGISTRY_PATH = os.path.join(
    os.path.expanduser("~"), ".local", "share", "banking-preview", "experiments", "registry.json")


def load_registry(path=None):
    file = path or REGISTRY_PATH
    if not os.path.exists(file):
        return []
    with open(file, encoding="utf-8") as handle:
        data = json.load(handle)
    return data.get("models", data if isinstance(data, list) else [])


def save_registry(models, path=None):
    file = path or REGISTRY_PATH
    os.makedirs(os.path.dirname(file), exist_ok=True)
    with open(file, "w", encoding="utf-8") as handle:
        json.dump({"models": models}, handle, indent=2)


def register(model_entry):
    models = load_registry()
    models = [item for item in models if item.get("name") != model_entry.get("name")]
    models.append(model_entry)
    save_registry(models)
    return model_entry


def get_models():
    try:
        return load_registry()
    except FileNotFoundError:
        return []


def list_models():
    return get_models()
