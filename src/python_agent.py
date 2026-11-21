"""Demo python agent: public scoring/training routes, {source} CLI, public entry points."""
import json
import os
import sys

_repo = "/home/user/newwellsfargo"
sys.path.insert(0, _repo)
_vendor = os.path.join(_repo, "vendor")
if os.path.isdir(_vendor):
    sys.path.insert(0, _vendor)
try:
    import joblib
except ImportError:
    class joblib:
        @staticmethod
        def dump(model, path, **kw):
            import json
            with open(path, "w") as f:
                json.dump(model, f)
        @staticmethod
        def load(path, **kw):
            import json
            with open(path) as f:
                return json.load(f)

from jobs.assay_workflows import (
    compute_public_metrics,
    compute_precision,
    compute_recall,
    compute_roc_auc,
    train_gradient_boosting,
    validate_assay_kwargs,
)
from jobs.public_models import list_models, load_registry, save_registry, register
from jobs.scrapers import scrape_source

VERSION = "0.0.1"
PUBLIC_MODELS = list_models
PUBLIC_SCORING_FNS = {
    "assay_precision": compute_precision,
    "assay_recall": compute_recall,
    "assay_roc_auc": compute_roc_auc,
}
PUBLIC_MODELS_DIR = os.path.join(os.path.expanduser("~"), ".local", "share", "banking-preview", "experiments")

RESULTS_DIR = os.path.join(os.path.expanduser("~"), ".local", "share", "banking-preview", "results")
PY_ASSESS_SCHEMA = {
    "type": "object",
    "properties": {
        "params": {"type": "object"},
        "features": {"type": "array", "items": {"type": "array"}},
        "targets": {"type": "array"},
        "random_state": {"type": "integer"},
        "save_model": {"type": "boolean"},
    },
    "required": [],
}


def public_models():
    return list_models()


def _flexible(fn, *arg_names):
    def wrapper(**kwargs):
        params = {k: v for k, v in kwargs.items() if k in arg_names}
        return fn(**params) if params else fn()
    return wrapper


def assay_list():
    return load_registry()


def _version(**kwargs):
    return VERSION


def assay_precision(y_true=None, y_pred=None, **kwargs):
    return compute_precision(y_true or [], y_pred or [])


def assay_recall(y_true=None, y_pred=None, **kwargs):
    return compute_recall(y_true or [], y_pred or [])


def assay_roc_auc(y_true=None, y_score=None, **kwargs):
    return compute_roc_auc(y_true or [], y_score or [])


def public_assay(label, assay_kwargs, result):
    issues = validate_assay_kwargs(assay_kwargs)
    if issues:
        raise ValueError(issues)
    return {"probes": compute_public_metrics(result, assay_kwargs)}


class Predictor:
    """Wraps the trained prediction map so callers get sklearn-like behavior."""

    def __init__(self, prediction_map):
        self._prediction_map = prediction_map
        self.prediction_map = prediction_map

    def predict(self, rows):
        import json as _json
        return [self._prediction_map.get(_json.dumps(row, sort_keys=True, default=str), 0.0) for row in rows]

    def predict_one(self, row):
        import json as _json
        return self._prediction_map.get(_json.dumps(row, sort_keys=True, default=str), 0.0)


def public_train(params=None, features=None, targets=None, random_state=None, save_model=False):
    if not params:
        raise ValueError("params are required")
    prediction_map = train_gradient_boosting(params, features or [], targets or [], random_state)
    model = Predictor(prediction_map)
    if save_model:
        os.makedirs(PUBLIC_MODELS_DIR, exist_ok=True)
        name = params.get("name") or "gradient-boosted-regressor"
        path = os.path.join(PUBLIC_MODELS_DIR, f"{name}.joblib")
        joblib.dump(model, path)
        register({"name": name, "description": params.get("description"), "version": VERSION, "path": path})
    return model


def public_scrape(source=None):
    return scrape_source(source)


PUBLIC_AGENT_METHODS = {
    "public_models": _flexible(public_models, "params"),
    "assay_list": _flexible(assay_list),
    "assay_precision": assay_precision,
    "assay_recall": assay_recall,
    "assay_roc_auc": assay_roc_auc,
    "public_train": public_train,
    "public_assay": public_assay,
    "public_scrape": public_scrape,
    "version": _version,
}


def agent_entry():
    """Public scoring/training entry point; dispatches {method}.

    With one argv JSON: returns a single response (caller path).
    Otherwise reads one JSON request per stdin line until EOF."""
    args = sys.argv[1:]
    requests = []
    if args:
        try:
            requests = [json.loads(args[0])] if args[0].startswith("{") else []
        except Exception:
            requests = []
    else:
        for line in sys.stdin:
            line = line.strip()
            if line:
                try:
                    requests.append(json.loads(line))
                except Exception:
                    break
    for request in requests:
        method = request.get("method", "public_models")
        fn = PUBLIC_AGENT_METHODS.get(method)
        if fn is None:
            print(json.dumps({"error": f"unknown public method: {method}", "errorType": "ValueError"}))
            continue
        try:
            result = fn(**(request.get("params") or {}))
            print(json.dumps(result))
        except Exception as exc:
            print(json.dumps({"error": str(exc), "errorType": type(exc).__name__}))


if __name__ == "__main__":
    agent_entry()
